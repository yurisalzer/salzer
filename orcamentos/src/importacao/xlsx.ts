import { SaxesParser, type SaxesTagPlain } from "saxes";
import { ArquivoZip, type EntradaZip } from "./zip";

/**
 * Leitor de XLSX em fluxo (SAX), sem carregar a planilha inteira na memória.
 *
 * Diferente de bibliotecas de planilha, devolve:
 *  - o TEXTO numérico exatamente como gravado no XML (ex.: "253.45"), sem passar por float;
 *  - o TEXTO DA FÓRMULA de cada célula (o SINAPI grava códigos de composição só dentro de
 *    fórmulas HYPERLINK, com valor em cache = 0).
 */

export interface CelulaXlsx {
  coluna: number; // 0 = A
  tipo: string; // s, n, str, b, e, inlineStr, d
  valor: string | null; // já resolvido para texto quando for string compartilhada
  formula: string | null;
}

export interface LinhaXlsx {
  numero: number; // 1-based, como no Excel
  celulas: Map<number, CelulaXlsx>;
}

export function colunaParaIndice(letras: string): number {
  let n = 0;
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indiceParaColuna(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const local = (nome: string) => (nome.includes(":") ? nome.slice(nome.indexOf(":") + 1) : nome);

async function* eventosXml(fluxo: AsyncIterable<Buffer | string>, tratar: (p: SaxesParser) => () => unknown[]): AsyncGenerator<unknown> {
  const parser = new SaxesParser();
  const drenar = tratar(parser);
  const decoder = new TextDecoder("utf-8");
  for await (const parte of fluxo) {
    parser.write(typeof parte === "string" ? parte : decoder.decode(parte, { stream: true }));
    for (const item of drenar()) yield item;
  }
  parser.write(decoder.decode());
  parser.close();
  for (const item of drenar()) yield item;
}

export interface AbaXlsx {
  nome: string;
  caminho: string;
}

export class LeitorXlsx {
  private strings: string[] | null = null;

  private constructor(private readonly zip: ArquivoZip, readonly abas: AbaXlsx[]) {}

  static async abrir(caminho: string): Promise<LeitorXlsx> {
    const zip = await ArquivoZip.abrir(caminho);
    try {
      const wb = zip.encontrar("xl/workbook.xml");
      const rels = zip.encontrar("xl/_rels/workbook.xml.rels");
      if (!wb || !rels) throw new Error("Arquivo não é uma planilha XLSX válida (workbook ausente)");
      const alvos = new Map<string, string>();
      for (const m of (await zip.lerTexto(rels)).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
        const id = /\bId="([^"]+)"/.exec(m[1]!)?.[1];
        const alvo = /\bTarget="([^"]+)"/.exec(m[1]!)?.[1];
        if (id && alvo) alvos.set(id, alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`);
      }
      const abas: AbaXlsx[] = [];
      for (const m of (await zip.lerTexto(wb)).matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
        const nome = /\bname="([^"]+)"/.exec(m[1]!)?.[1];
        const rid = /\br:id="([^"]+)"/.exec(m[1]!)?.[1] ?? /\bid="([^"]+)"/.exec(m[1]!)?.[1];
        if (nome && rid && alvos.has(rid)) abas.push({ nome: decodificarEntidades(nome), caminho: alvos.get(rid)! });
      }
      return new LeitorXlsx(zip, abas);
    } catch (e) {
      zip.fechar();
      throw e;
    }
  }

  temAba(nome: string): boolean {
    return this.abas.some((a) => a.nome === nome);
  }

  private async carregarStrings(): Promise<string[]> {
    if (this.strings) return this.strings;
    const e = this.zip.encontrar("xl/sharedStrings.xml");
    const lista: string[] = [];
    if (e) {
      const fluxo = await this.zip.abrirFluxo(e);
      for await (const s of eventosXml(fluxo, (p) => {
        const fila: string[] = [];
        let atual: string[] | null = null;
        let emT = false;
        let emFonetica = 0;
        p.on("opentag", (t: SaxesTagPlain) => {
          const n = local(t.name);
          if (n === "si") atual = [];
          else if (n === "rPh") emFonetica++;
          else if (n === "t" && emFonetica === 0) emT = true;
        });
        p.on("text", (txt) => {
          if (emT && atual) atual.push(txt);
        });
        p.on("closetag", (t: SaxesTagPlain) => {
          const n = local(t.name);
          if (n === "t") emT = false;
          else if (n === "rPh") emFonetica--;
          else if (n === "si" && atual) {
            fila.push(atual.join(""));
            atual = null;
          }
        });
        return () => fila.splice(0);
      })) lista.push(s as string);
    }
    this.strings = lista;
    return lista;
  }

  /** Percorre as linhas de uma aba em ordem, em fluxo. */
  async *linhas(nomeAba: string): AsyncGenerator<LinhaXlsx> {
    const aba = this.abas.find((a) => a.nome === nomeAba);
    if (!aba) throw new Error(`Aba "${nomeAba}" não encontrada`);
    const entrada: EntradaZip | undefined = this.zip.encontrar(aba.caminho);
    if (!entrada) throw new Error(`Conteúdo da aba "${nomeAba}" não encontrado`);
    const strings = await this.carregarStrings();
    const fluxo = await this.zip.abrirFluxo(entrada);
    let numeroImplicito = 0;
    yield* eventosXml(fluxo, (p) => {
      const fila: LinhaXlsx[] = [];
      let linha: LinhaXlsx | null = null;
      let celula: CelulaXlsx | null = null;
      let colunaImplicita = 0;
      let capturando: "v" | "f" | "t" | null = null;
      let buffer: string[] = [];
      p.on("opentag", (t: SaxesTagPlain) => {
        const n = local(t.name);
        if (n === "row") {
          const r = t.attributes.r as string | undefined;
          numeroImplicito = r ? Number(r) : numeroImplicito + 1;
          linha = { numero: numeroImplicito, celulas: new Map() };
          colunaImplicita = 0;
        } else if (n === "c" && linha) {
          const ref = t.attributes.r as string | undefined;
          const col = ref ? colunaParaIndice(/^[A-Z]+/i.exec(ref)![0]) : colunaImplicita;
          colunaImplicita = col + 1;
          celula = { coluna: col, tipo: (t.attributes.t as string) ?? "n", valor: null, formula: null };
        } else if (celula && (n === "v" || n === "f" || n === "t")) {
          capturando = n as "v" | "f" | "t";
          buffer = [];
        }
      });
      p.on("text", (txt) => {
        if (capturando) buffer.push(txt);
      });
      p.on("closetag", (t: SaxesTagPlain) => {
        const n = local(t.name);
        if (capturando && n === capturando && celula) {
          const texto = buffer.join("");
          if (n === "v") celula.valor = texto;
          else if (n === "f") celula.formula = texto;
          else celula.valor = (celula.valor ?? "") + texto;
          capturando = null;
        } else if (n === "c" && celula && linha) {
          if (celula.tipo === "s" && celula.valor !== null) {
            const idx = Number(celula.valor);
            const s = strings[idx];
            if (s === undefined) throw new Error(`String compartilhada ${idx} inexistente (aba ${nomeAba}, linha ${linha.numero})`);
            celula.valor = s;
          }
          linha.celulas.set(celula.coluna, celula);
          celula = null;
        } else if (n === "row" && linha) {
          fila.push(linha);
          linha = null;
        }
      });
      return () => fila.splice(0);
    }) as AsyncGenerator<LinhaXlsx>;
  }

  fechar(): void {
    this.zip.fechar();
  }
}

function decodificarEntidades(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Texto de uma célula (string, número como texto, ou null se vazia). */
export function textoCelula(l: LinhaXlsx, coluna: number): string | null {
  const c = l.celulas.get(coluna);
  if (!c || c.valor === null) return null;
  return c.valor;
}

/** Normaliza rótulos para comparação: sem acento, minúsculo, espaços simples. */
export function normalizarRotulo(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Converte número de série de data do Excel (sistema 1900) para Date UTC. */
export function dataDeSerialExcel(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
}

import { LeitorXlsx, dataDeSerialExcel, normalizarRotulo, textoCelula, type LinhaXlsx } from "../xlsx";
import { decimalDeTextoOficial } from "@/dominio/decimal";
import { lerCompetencia, mesmaCompetencia, type CodigoRegime } from "@/dominio/referencias";
import type { Adaptador, ArquivoEntrada, ArquivoReconhecido, ContextoImportacao, Destino, Identificacao } from "../tipos";

/**
 * Adaptador SINAPI — "formato xlsx" adotado pela Caixa a partir de 2025
 * (verificado com SINAPI-2026-01-formato-xlsx_Retificacao01.zip).
 * Documentação do layout: docs/LAYOUTS_OFICIAIS.md, seção SINAPI.
 *
 * Nada é lido por coordenada fixa: cabeçalhos e colunas são localizados pelos rótulos,
 * e o arquivo é recusado se algum rótulo obrigatório não for encontrado.
 */
export const LAYOUT_SINAPI = "sinapi-xlsx-2025";

type Papel = "SINAPI_REFERENCIA" | "SINAPI_MAO_DE_OBRA" | "SINAPI_MANUTENCOES" | "SINAPI_FAMILIAS";

const ABAS_REFERENCIA = {
  SEM_DESONERACAO: { insumos: "ISD", composicoes: "CSD", titulo: "sem desoneracao" },
  COM_DESONERACAO: { insumos: "ICD", composicoes: "CCD", titulo: "com desoneracao" },
  SEM_ENCARGOS: { insumos: "ISE", composicoes: "CSE", titulo: "sem encargos sociais" },
} as const satisfies Partial<Record<CodigoRegime, unknown>>;

type RegimeSinapi = keyof typeof ABAS_REFERENCIA;
const REGIMES_SINAPI = Object.keys(ABAS_REFERENCIA) as RegimeSinapi[];

const ABAS_MAO_DE_OBRA: Record<string, RegimeSinapi> = { "SEM Desoneração": "SEM_DESONERACAO", "COM Desoneração": "COM_DESONERACAO" };

/** Extrai o código de "HYPERLINK(...,104658)" — o SINAPI grava o código só na fórmula. */
export function codigoDaFormulaHyperlink(formula: string | null | undefined): string | null {
  if (!formula) return null;
  const m = /^\s*=?\s*HYPERLINK\s*\(.*,\s*(\d+)\s*\)\s*$/is.exec(formula);
  return m ? m[1]! : null;
}

/** Código numérico do SINAPI: aceita "45333" (texto do XML) e recusa decimais/negativos. */
function codigoNumerico(texto: string | null): string | null {
  if (texto === null) return null;
  const t = texto.trim();
  if (/^\d+$/.test(t)) return t;
  if (/^\d+\.0+$/.test(t)) return t.split(".")[0]!;
  return null;
}

interface Cabecalho {
  linha: number;
  celulas: LinhaXlsx;
  colunas: Map<string, number>; // rótulo normalizado → coluna
  linhasAnteriores: LinhaXlsx[];
}

/** Lê as primeiras linhas até achar a linha de cabeçalho que contém todos os rótulos exigidos. */
async function* comCabecalho(
  linhas: AsyncGenerator<LinhaXlsx>,
  exigidos: string[],
  limite = 40,
): AsyncGenerator<{ cabecalho: Cabecalho } | { linha: LinhaXlsx }> {
  const anteriores: LinhaXlsx[] = [];
  let cab: Cabecalho | null = null;
  for await (const l of linhas) {
    if (!cab) {
      const rotulos = new Map<string, number>();
      for (const c of l.celulas.values()) {
        if (c.valor !== null && rotulos.get(normalizarRotulo(c.valor)) === undefined) rotulos.set(normalizarRotulo(c.valor), c.coluna);
      }
      if (exigidos.every((e) => rotulos.has(e))) {
        cab = { linha: l.numero, celulas: l, colunas: rotulos, linhasAnteriores: anteriores };
        yield { cabecalho: cab };
        continue;
      }
      anteriores.push(l);
      if (anteriores.length > limite) throw new Error(`Cabeçalho não encontrado (rótulos esperados: ${exigidos.join(", ")})`);
      continue;
    }
    yield { linha: l };
  }
  if (!cab) throw new Error(`Cabeçalho não encontrado (rótulos esperados: ${exigidos.join(", ")})`);
}

/** Procura "Mês de Referência:" e "Data de emissão:" nas linhas de título. */
function lerTitulo(linhas: LinhaXlsx[]): { titulo: string; competencia: Date | null; emissao: Date | null } {
  let titulo = "";
  let competencia: Date | null = null;
  let emissao: Date | null = null;
  for (const l of linhas) {
    const cels = [...l.celulas.values()].sort((a, b) => a.coluna - b.coluna);
    cels.forEach((c, i) => {
      const n = normalizarRotulo(c.valor);
      if (n.startsWith("relatorio")) titulo = c.valor ?? "";
      const prox = cels[i + 1]?.valor ?? null;
      if (n === "mes de referencia:" && prox) competencia = lerCompetencia(prox);
      if (n === "data de emissao:" && prox) {
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(prox.trim());
        if (m) emissao = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
      }
    });
  }
  return { titulo, competencia, emissao };
}

/** Coluna de uma UF: procura a sigla nas linhas acima do cabeçalho ou no próprio cabeçalho. */
function colunaUf(cab: Cabecalho, uf: string): number | null {
  const alvo = normalizarRotulo(uf);
  if (cab.colunas.has(alvo)) return cab.colunas.get(alvo)!;
  for (const l of [...cab.linhasAnteriores].reverse()) {
    for (const c of l.celulas.values()) if (normalizarRotulo(c.valor) === alvo) return c.coluna;
  }
  return null;
}

function papelPorAbas(nomes: string[]): Papel | null {
  const s = new Set(nomes);
  if (["ISD", "ICD", "ISE", "CSD", "CCD", "CSE", "Analítico"].every((a) => s.has(a))) return "SINAPI_REFERENCIA";
  if (Object.keys(ABAS_MAO_DE_OBRA).every((a) => s.has(a))) return "SINAPI_MAO_DE_OBRA";
  if (s.has("Manutenções")) return "SINAPI_MANUTENCOES";
  if (s.has("Coeficientes")) return "SINAPI_FAMILIAS";
  return null;
}

export const adaptadorSinapiXlsx2025: Adaptador = {
  id: LAYOUT_SINAPI,
  fonte: "SINAPI",
  descricao: "SINAPI — planilhas XLSX (Referência, Mão de obra, Manutenções)",

  async identificar(arquivos: ArquivoEntrada[]): Promise<Identificacao> {
    const reconhecidos: ArquivoReconhecido[] = [];
    const ignorados: Identificacao["ignorados"] = [];
    const sugestoes: Identificacao["sugestoes"] = { regimes: [...REGIMES_SINAPI] };
    const porPapel = new Map<Papel, ArquivoEntrada>();
    for (const a of arquivos) {
      const ret = /retifica[cç][aã]o[\s_-]*0*(\d+)/i.exec(a.caminhoNoPacote);
      if (ret) sugestoes.rotuloRevisao = `Retificação ${ret[1]!.padStart(2, "0")}`;
      const m = /(\d{4})[_-](\d{2})/.exec(a.nome);
      if (m && !sugestoes.competencia) sugestoes.competencia = lerCompetencia(`${m[2]}/${m[1]}`) ?? undefined;
      if (a.assinatura !== "XLSX") {
        ignorados.push({ arquivo: a, motivo: `Não é XLSX (${a.assinatura}); não usado pelo adaptador SINAPI` });
        continue;
      }
      const x = await LeitorXlsx.abrir(a.caminhoDisco);
      const papel = papelPorAbas(x.abas.map((ab) => ab.nome));
      x.fechar();
      if (!papel) {
        ignorados.push({ arquivo: a, motivo: "Abas não correspondem a nenhuma planilha SINAPI conhecida" });
        continue;
      }
      if (papel === "SINAPI_FAMILIAS") {
        ignorados.push({ arquivo: a, motivo: "Relatório de famílias e coeficientes: registrado (SHA-256), não utilizado nos cálculos" });
        continue;
      }
      if (porPapel.has(papel)) throw new Error(`Há mais de uma planilha do tipo ${papel}: ${porPapel.get(papel)!.nome} e ${a.nome}.`);
      porPapel.set(papel, a);
      reconhecidos.push({ arquivo: a, papel, layout: LAYOUT_SINAPI });
    }
    const faltando = porPapel.has("SINAPI_REFERENCIA") ? [] : ["SINAPI_Referência_AAAA_MM.xlsx (planilha principal)"];
    return { reconhecidos, faltando, ignorados, sugestoes };
  },

  async ler(ctx: ContextoImportacao, ident: Identificacao, destino: Destino): Promise<void> {
    const regimes = ctx.regimes.filter((r): r is RegimeSinapi => r in ABAS_REFERENCIA);
    if (regimes.length === 0) throw new Error("Selecione ao menos um regime do SINAPI.");

    const numero = (arquivo: string, aba: string, linha: number, campo: string, texto: string | null, codigo: string | null): string | null => {
      try {
        const d = decimalDeTextoOficial(texto);
        return d === null ? null : d.toString();
      } catch {
        destino.verificacao({ regra: "NUMERO_INVALIDO", severidade: "ERRO", arquivo: `${arquivo} [${aba}]`, linha, codigo, mensagem: `Valor não numérico em ${campo}: "${texto}"` });
        return null;
      }
    };

    const ref = ident.reconhecidos.find((r) => r.papel === "SINAPI_REFERENCIA")!.arquivo;
    const conferirTitulo = (arquivo: string, aba: string, cab: Cabecalho, esperado?: string) => {
      const t = lerTitulo(cab.linhasAnteriores);
      if (!t.competencia) {
        destino.verificacao({ regra: "COMPETENCIA_NAO_ENCONTRADA", severidade: "ERRO", arquivo: `${arquivo} [${aba}]`, mensagem: "\"Mês de Referência\" não encontrado no título da aba." });
      } else if (!mesmaCompetencia(t.competencia, ctx.competencia)) {
        destino.verificacao({ regra: "COMPETENCIA_DIVERGENTE", severidade: "ERRO", arquivo: `${arquivo} [${aba}]`, mensagem: `A planilha é de ${t.competencia.toISOString().slice(0, 7)}, diferente da competência selecionada.` });
      }
      if (esperado && !normalizarRotulo(t.titulo).includes(esperado)) {
        destino.verificacao({ regra: "REGIME_TITULO", severidade: "ERRO", arquivo: `${arquivo} [${aba}]`, mensagem: `O título "${t.titulo}" não confirma o regime esperado (${esperado}).` });
      }
      // A data de emissão da revisão é a da planilha principal (os auxiliares têm datas próprias).
      if (t.emissao && arquivo === ref.nome) destino.metadado("data_emissao", t.emissao.toISOString().slice(0, 10));
      return t;
    };

    const x = await LeitorXlsx.abrir(ref.caminhoDisco);
    let totalLinhas = 0;
    try {
      for (const regime of regimes) {
        const abas = ABAS_REFERENCIA[regime];

        // Insumos
        {
          let c: { cls: number; cod: number; desc: number; un: number; orig: number; uf: number } | null = null;
          for await (const ev of comCabecalho(x.linhas(abas.insumos), ["codigo do insumo", "descricao do insumo", "unidade"])) {
            if ("cabecalho" in ev) {
              conferirTitulo(ref.nome, abas.insumos, ev.cabecalho, abas.titulo);
              const uf = colunaUf(ev.cabecalho, ctx.uf);
              const col = ev.cabecalho.colunas;
              if (uf === null || !col.has("origem de preco") || !col.has("classificacao")) {
                throw new Error(`Aba ${abas.insumos}: coluna da UF ${ctx.uf}, "Origem de Preço" ou "Classificação" não encontrada.`);
              }
              c = { cls: col.get("classificacao")!, cod: col.get("codigo do insumo")!, desc: col.get("descricao do insumo")!, un: col.get("unidade")!, orig: col.get("origem de preco")!, uf };
              continue;
            }
            const l = ev.linha;
            const bruto = textoCelula(l, c!.cod);
            if (bruto === null) continue; // linhas vazias de rodapé
            const codigo = codigoNumerico(bruto);
            if (!codigo) {
              destino.verificacao({ regra: "SINAPI_CODIGO_INVALIDO", severidade: "ERRO", arquivo: `${ref.nome} [${abas.insumos}]`, linha: l.numero, mensagem: `Código de insumo inválido: "${bruto}"` });
              continue;
            }
            totalLinhas++;
            const precoTexto = textoCelula(l, c!.uf);
            const preco = numero(ref.nome, abas.insumos, l.numero, ctx.uf, precoTexto, codigo);
            await destino.item({ arquivo: `${ref.nome} [${abas.insumos}]`, linha: l.numero, tipo: "INSUMO", codigo, descricao: textoCelula(l, c!.desc), unidade: textoCelula(l, c!.un), classe: textoCelula(l, c!.cls) });
            await destino.preco({
              arquivo: `${ref.nome} [${abas.insumos}]`, linha: l.numero, regime, tipo: "INSUMO", codigo,
              precoTexto, preco, situacao: preco === null ? "AUSENTE" : "INFORMADO", origemPreco: textoCelula(l, c!.orig),
            });
          }
        }

        // Composições (custo sintético)
        {
          let c: { grupo: number; cod: number; desc: number; un: number; custo: number; as: number } | null = null;
          for await (const ev of comCabecalho(x.linhas(abas.composicoes), ["codigo da composicao", "descricao", "unidade"])) {
            if ("cabecalho" in ev) {
              conferirTitulo(ref.nome, abas.composicoes, ev.cabecalho, abas.titulo);
              const uf = colunaUf(ev.cabecalho, ctx.uf);
              if (uf === null) throw new Error(`Aba ${abas.composicoes}: coluna da UF ${ctx.uf} não encontrada.`);
              // Confere o par (Custo, %AS) da UF no próprio cabeçalho
              const col = ev.cabecalho.colunas;
              const r1 = normalizarRotulo(textoCelula(ev.cabecalho.celulas, uf));
              const r2 = normalizarRotulo(textoCelula(ev.cabecalho.celulas, uf + 1));
              if (!r1.startsWith("custo") || r2 !== "%as") {
                throw new Error(`Aba ${abas.composicoes}: esperado "Custo (R$)" e "%AS" sob ${ctx.uf}, encontrado "${r1}" e "${r2}".`);
              }
              c = { grupo: col.get("grupo") ?? -1, cod: col.get("codigo da composicao")!, desc: col.get("descricao")!, un: col.get("unidade")!, custo: uf, as: uf + 1 };
              continue;
            }
            const l = ev.linha;
            const celCod = l.celulas.get(c!.cod);
            if (!celCod) continue;
            const daFormula = codigoDaFormulaHyperlink(celCod.formula);
            const doValor = celCod.valor !== null && celCod.valor !== "0" ? codigoNumerico(celCod.valor) : null;
            const codigo = daFormula ?? doValor;
            if (!codigo) {
              destino.verificacao({ regra: "SINAPI_CODIGO_INVALIDO", severidade: "ERRO", arquivo: `${ref.nome} [${abas.composicoes}]`, linha: l.numero, mensagem: `Código de composição não encontrado (fórmula: ${celCod.formula ?? "—"}, valor: ${celCod.valor ?? "—"})` });
              continue;
            }
            if (daFormula && doValor && daFormula !== doValor) {
              destino.verificacao({ regra: "SINAPI_CODIGO_DIVERGENTE", severidade: "ERRO", arquivo: `${ref.nome} [${abas.composicoes}]`, linha: l.numero, codigo, mensagem: `Código da fórmula (${daFormula}) difere do valor da célula (${doValor}).` });
            }
            totalLinhas++;
            const custoTexto = textoCelula(l, c!.custo);
            const custo = numero(ref.nome, abas.composicoes, l.numero, ctx.uf, custoTexto, codigo);
            // Planilha oficial: "Custo zerado (hífen) indica que pelo menos um dos itens da composição não tem custo/preço."
            const semCusto = custo === null || custo === "0";
            await destino.item({ arquivo: `${ref.nome} [${abas.composicoes}]`, linha: l.numero, tipo: "COMPOSICAO", codigo, descricao: textoCelula(l, c!.desc), unidade: textoCelula(l, c!.un), grupo: c!.grupo >= 0 ? textoCelula(l, c!.grupo) : null });
            await destino.preco({
              arquivo: `${ref.nome} [${abas.composicoes}]`, linha: l.numero, regime, tipo: "COMPOSICAO", codigo,
              precoTexto: custoTexto, preco: semCusto ? null : custo, situacao: semCusto ? "SEM_CUSTO" : "INFORMADO",
              percentualAs: numero(ref.nome, abas.composicoes, l.numero, "%AS", textoCelula(l, c!.as), codigo),
            });
          }
        }
      }

      // Analítico (coeficientes) — independe do regime
      {
        let c: { grupo: number; comp: number; tipo: number; item: number; desc: number; un: number; coef: number; sit: number } | null = null;
        let pai: string | null = null;
        let ordem = 0;
        const aba = "Analítico";
        for await (const ev of comCabecalho(x.linhas(aba), ["codigo da composicao", "tipo item", "codigo do item", "coeficiente"])) {
          if ("cabecalho" in ev) {
            conferirTitulo(ref.nome, aba, ev.cabecalho);
            const col = ev.cabecalho.colunas;
            c = { grupo: col.get("grupo") ?? -1, comp: col.get("codigo da composicao")!, tipo: col.get("tipo item")!, item: col.get("codigo do item")!, desc: col.get("descricao")!, un: col.get("unidade")!, coef: col.get("coeficiente")!, sit: col.get("situacao") ?? -1 };
            continue;
          }
          const l = ev.linha;
          const celComp = l.celulas.get(c!.comp);
          if (!celComp) continue;
          const codComp = codigoDaFormulaHyperlink(celComp.formula) ?? codigoNumerico(celComp.valor);
          if (!codComp) {
            destino.verificacao({ regra: "SINAPI_CODIGO_INVALIDO", severidade: "ERRO", arquivo: `${ref.nome} [${aba}]`, linha: l.numero, mensagem: `Código de composição inválido: "${celComp.valor}"` });
            continue;
          }
          totalLinhas++;
          const tipo = normalizarRotulo(textoCelula(l, c!.tipo));
          const situacao = c!.sit >= 0 ? textoCelula(l, c!.sit) : null;
          const arquivo = `${ref.nome} [${aba}]`;
          if (tipo === "") {
            pai = codComp;
            ordem = 0;
            await destino.composicao({ arquivo, linha: l.numero, codigo: codComp, situacao });
            await destino.item({ arquivo, linha: l.numero, tipo: "COMPOSICAO", codigo: codComp, descricao: textoCelula(l, c!.desc), unidade: textoCelula(l, c!.un), grupo: c!.grupo >= 0 ? textoCelula(l, c!.grupo) : null });
            continue;
          }
          if (tipo !== "insumo" && tipo !== "composicao") {
            destino.verificacao({ regra: "SINAPI_TIPO_ITEM", severidade: "ERRO", arquivo, linha: l.numero, codigo: codComp, mensagem: `Tipo de item desconhecido: "${textoCelula(l, c!.tipo)}"` });
            continue;
          }
          if (pai !== codComp) {
            destino.verificacao({ regra: "SINAPI_ANALITICO_ORDEM", severidade: "ERRO", arquivo, linha: l.numero, codigo: codComp, mensagem: "Item de composição sem a linha de cabeçalho da composição imediatamente antes." });
            continue;
          }
          const codItem = codigoNumerico(textoCelula(l, c!.item));
          if (!codItem) {
            destino.verificacao({ regra: "SINAPI_CODIGO_INVALIDO", severidade: "ERRO", arquivo, linha: l.numero, codigo: codComp, mensagem: `Código do item inválido: "${textoCelula(l, c!.item)}"` });
            continue;
          }
          const tipoItem = tipo === "insumo" ? "INSUMO" : "COMPOSICAO";
          const coefTexto = textoCelula(l, c!.coef);
          const coef = numero(ref.nome, aba, l.numero, "Coeficiente", coefTexto, codComp);
          if (coef === null) destino.verificacao({ regra: "COEFICIENTE_AUSENTE", severidade: "ERRO", arquivo, linha: l.numero, codigo: codComp, mensagem: `Item ${codItem} sem coeficiente.` });
          await destino.componente({ arquivo, linha: l.numero, codigoPai: codComp, ordem: ++ordem, tipoItem, codigoItem: codItem, coeficiente: coef, coeficienteTexto: coefTexto, situacaoOrigem: situacao });
          await destino.item({ arquivo, linha: l.numero, tipo: tipoItem, codigo: codItem, descricao: textoCelula(l, c!.desc), unidade: textoCelula(l, c!.un) });
        }
      }
    } finally {
      x.fechar();
    }
    destino.metadado("linhas_referencia", totalLinhas);

    // Percentual de mão de obra (opcional)
    const mo = ident.reconhecidos.find((r) => r.papel === "SINAPI_MAO_DE_OBRA")?.arquivo;
    if (mo) {
      const xm = await LeitorXlsx.abrir(mo.caminhoDisco);
      try {
        for (const [aba, regime] of Object.entries(ABAS_MAO_DE_OBRA)) {
          if (!regimes.includes(regime)) continue;
          let cod = -1, uf = -1;
          for await (const ev of comCabecalho(xm.linhas(aba), ["codigo da composicao", "descricao"])) {
            if ("cabecalho" in ev) {
              conferirTitulo(mo.nome, aba, ev.cabecalho, regime === "SEM_DESONERACAO" ? "sem desoneracao" : "com desoneracao");
              cod = ev.cabecalho.colunas.get("codigo da composicao")!;
              const u = colunaUf(ev.cabecalho, ctx.uf);
              if (u === null) throw new Error(`${mo.nome} [${aba}]: coluna ${ctx.uf} não encontrada.`);
              uf = u;
              continue;
            }
            const cel = ev.linha.celulas.get(cod);
            const codigo = codigoDaFormulaHyperlink(cel?.formula) ?? codigoNumerico(cel?.valor ?? null);
            if (!codigo) continue;
            await destino.atributo({
              arquivo: `${mo.nome} [${aba}]`, linha: ev.linha.numero, regime, tipo: "COMPOSICAO", codigo, atributo: "percentual_mao_obra",
              valor: numero(mo.nome, aba, ev.linha.numero, "% mão de obra", textoCelula(ev.linha, uf), codigo),
            });
          }
        }
      } finally {
        xm.fechar();
      }
    }

    // Manutenções do mês (o relatório traz o histórico; guardamos só a competência importada)
    const man = ident.reconhecidos.find((r) => r.papel === "SINAPI_MANUTENCOES")?.arquivo;
    if (man) {
      const xm = await LeitorXlsx.abrir(man.caminhoDisco);
      try {
        let c: Record<string, number> = {};
        let doMes = 0;
        for await (const ev of comCabecalho(xm.linhas("Manutenções"), ["referencia", "tipo", "codigo", "descricao", "manutencao"])) {
          if ("cabecalho" in ev) {
            conferirTitulo(man.nome, "Manutenções", ev.cabecalho);
            c = Object.fromEntries(ev.cabecalho.colunas);
            continue;
          }
          const l = ev.linha;
          const refTexto = textoCelula(l, c.referencia!);
          if (refTexto === null) continue;
          const serial = Number(refTexto);
          const data = Number.isFinite(serial) && serial > 30000 ? dataDeSerialExcel(serial) : lerCompetencia(refTexto);
          if (!data || !mesmaCompetencia(data, ctx.competencia)) continue;
          doMes++;
          await destino.manutencao({
            linha: l.numero, referencia: data, tipo: textoCelula(l, c.tipo!), codigo: textoCelula(l, c.codigo!),
            descricao: textoCelula(l, c.descricao!), manutencao: textoCelula(l, c.manutencao!),
          });
        }
        destino.metadado("manutencoes_do_mes", doMes);
      } finally {
        xm.fechar();
      }
    }
  },
};

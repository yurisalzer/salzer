import { open, stat } from "node:fs/promises";
import iconv from "iconv-lite";

/**
 * Leitor de arquivos DBF (dBASE III/IV, FoxPro) em fluxo.
 *
 * Por que um leitor próprio: as bibliotecas comuns convertem campos numéricos para `number`
 * (ponto flutuante). Aqui cada campo é devolvido como TEXTO ORIGINAL do arquivo, que depois
 * vira Decimal sem perda. Os registros são lidos em blocos, sem carregar o arquivo na memória.
 */

export interface CampoDbf {
  nome: string;
  tipo: string;
  tamanho: number;
  decimais: number;
  deslocamento: number;
}

export interface CabecalhoDbf {
  versao: number;
  dataAtualizacao: Date | null;
  registros: number;
  tamanhoCabecalho: number;
  tamanhoRegistro: number;
  idioma: number;
  campos: CampoDbf[];
  tamanhoArquivo: number;
}

export interface RegistroDbf {
  /** Número do registro no arquivo, a partir de 1 */
  numero: number;
  apagado: boolean;
  /** Texto bruto de cada campo, decodificado, SEM aparar espaços */
  valores: Record<string, string>;
}

const VERSOES_CONHECIDAS = new Set([0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x43, 0x63, 0x83, 0x8b, 0x8e, 0xcb, 0xf5, 0xfb]);
const TIPOS_CONHECIDOS = new Set(["C", "N", "F", "D", "L", "M", "I", "B", "Y", "T", "@", "+", "O", "G", "P", "0"]);

export class ErroDbf extends Error {}

/** Interpreta os bytes iniciais; lança ErroDbf se a estrutura não for um DBF consistente. */
export function interpretarCabecalhoDbf(buf: Buffer, tamanhoArquivo: number): CabecalhoDbf {
  if (buf.length < 33) throw new ErroDbf("Arquivo pequeno demais para ser DBF");
  const versao = buf[0]!;
  if (!VERSOES_CONHECIDAS.has(versao)) throw new ErroDbf(`Versão DBF desconhecida: 0x${versao.toString(16)}`);
  const ano = buf[1]!, mes = buf[2]!, dia = buf[3]!;
  const registros = buf.readUInt32LE(4);
  const tamanhoCabecalho = buf.readUInt16LE(8);
  const tamanhoRegistro = buf.readUInt16LE(10);
  const idioma = buf[29]!;
  if (tamanhoCabecalho < 33 || tamanhoRegistro < 2) throw new ErroDbf("Cabeçalho DBF inválido");
  if (buf.length < tamanhoCabecalho) throw new ErroDbf("Cabeçalho DBF truncado");

  const campos: CampoDbf[] = [];
  let pos = 32;
  let deslocamento = 1; // byte 0 de cada registro = marca de exclusão
  while (pos < tamanhoCabecalho && buf[pos] !== 0x0d) {
    if (pos + 32 > buf.length) throw new ErroDbf("Descritor de campo truncado");
    const nome = buf.subarray(pos, pos + 11).toString("latin1").split("\0")[0]!.trim();
    const tipo = String.fromCharCode(buf[pos + 11]!);
    const tamanho = buf[pos + 16]!;
    const decimais = buf[pos + 17]!;
    if (!nome || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(nome)) throw new ErroDbf(`Nome de campo inválido no DBF: "${nome}"`);
    if (!TIPOS_CONHECIDOS.has(tipo)) throw new ErroDbf(`Tipo de campo DBF desconhecido: ${tipo}`);
    campos.push({ nome: nome.toUpperCase(), tipo, tamanho, decimais, deslocamento });
    deslocamento += tamanho;
    pos += 32;
  }
  if (buf[pos] !== 0x0d) throw new ErroDbf("Terminador do cabeçalho DBF não encontrado");
  if (campos.length === 0) throw new ErroDbf("DBF sem campos");
  if (deslocamento !== tamanhoRegistro) {
    throw new ErroDbf(`Tamanho de registro inconsistente (cabeçalho ${tamanhoRegistro}, campos ${deslocamento})`);
  }
  const esperado = tamanhoCabecalho + registros * tamanhoRegistro;
  if (tamanhoArquivo < esperado) {
    throw new ErroDbf(`Arquivo DBF truncado: esperado ao menos ${esperado} bytes, encontrado ${tamanhoArquivo}`);
  }
  // Alguns DBF terminam com 0x1A (EOF), outros não; mais de alguns bytes sobrando é suspeito.
  if (tamanhoArquivo > esperado + 512) {
    throw new ErroDbf(`DBF com ${tamanhoArquivo - esperado} bytes além do esperado`);
  }
  const dataAtualizacao = mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 ? new Date(Date.UTC(1900 + ano, mes - 1, dia)) : null;
  return { versao, dataAtualizacao, registros, tamanhoCabecalho, tamanhoRegistro, idioma, campos, tamanhoArquivo };
}

export async function lerCabecalhoDbf(caminho: string): Promise<CabecalhoDbf> {
  const info = await stat(caminho);
  const fh = await open(caminho, "r");
  try {
    // 32 bytes fixos + até 255 campos × 32 + terminador + área do Visual FoxPro
    const tamanho = Math.min(info.size, 32 + 255 * 32 + 1 + 263);
    const buf = Buffer.alloc(tamanho);
    await fh.read(buf, 0, tamanho, 0);
    return interpretarCabecalhoDbf(buf, info.size);
  } finally {
    await fh.close();
  }
}

/** Codificações aceitas; o byte de idioma do DBF orienta quando presente. */
export function codificacaoPorIdioma(idioma: number): string | null {
  switch (idioma) {
    case 0x01: return "cp437";
    case 0x02: return "cp850";
    case 0x03: return "cp1252";
    case 0x57: return "cp1252";
    default: return null;
  }
}

export async function* lerRegistrosDbf(
  caminho: string,
  opcoes: { codificacao: string; registrosPorBloco?: number },
): AsyncGenerator<RegistroDbf> {
  const cab = await lerCabecalhoDbf(caminho);
  if (!iconv.encodingExists(opcoes.codificacao)) throw new ErroDbf(`Codificação não suportada: ${opcoes.codificacao}`);
  const porBloco = opcoes.registrosPorBloco ?? 2000;
  const fh = await open(caminho, "r");
  try {
    const buf = Buffer.alloc(porBloco * cab.tamanhoRegistro);
    let numero = 0;
    while (numero < cab.registros) {
      const n = Math.min(porBloco, cab.registros - numero);
      const bytes = n * cab.tamanhoRegistro;
      const { bytesRead } = await fh.read(buf, 0, bytes, cab.tamanhoCabecalho + numero * cab.tamanhoRegistro);
      if (bytesRead < bytes) throw new ErroDbf(`Leitura incompleta no registro ${numero + 1}`);
      for (let i = 0; i < n; i++) {
        const ini = i * cab.tamanhoRegistro;
        const marca = buf[ini]!;
        if (marca !== 0x20 && marca !== 0x2a) throw new ErroDbf(`Marca de registro inválida (0x${marca.toString(16)}) no registro ${numero + i + 1}`);
        const valores: Record<string, string> = {};
        for (const c of cab.campos) {
          valores[c.nome] = iconv.decode(buf.subarray(ini + c.deslocamento, ini + c.deslocamento + c.tamanho), opcoes.codificacao);
        }
        yield { numero: numero + i + 1, apagado: marca === 0x2a, valores };
      }
      numero += n;
    }
  } finally {
    await fh.close();
  }
}

/**
 * Indica se o texto decodificado tem caracteres de controle (sinal de codificação errada
 * ou de arquivo corrompido).
 */
export function temCaracteresDeControle(texto: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(texto);
}

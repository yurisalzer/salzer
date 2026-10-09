import { open, stat } from "node:fs/promises";
import { interpretarCabecalhoDbf, ErroDbf } from "./dbf";
import { ArquivoZip } from "./zip";

/**
 * Identificação do tipo REAL do arquivo pelos bytes iniciais e pela estrutura —
 * nunca pela extensão (na EMOP, arquivos ".xls" contêm DBF).
 */
export type Assinatura = "DBF" | "XLSX" | "DOCX" | "ZIP" | "RAR" | "XLS_LEGADO" | "PDF" | "DESCONHECIDA";

export async function detectarAssinatura(caminho: string): Promise<{ assinatura: Assinatura; detalhe?: string }> {
  const info = await stat(caminho);
  const fh = await open(caminho, "r");
  const buf = Buffer.alloc(Math.min(info.size, 32 + 255 * 32 + 1 + 263));
  try {
    await fh.read(buf, 0, buf.length, 0);
  } finally {
    await fh.close();
  }
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06]))) {
    try {
      const zip = await ArquivoZip.abrir(caminho);
      try {
        if (zip.encontrar("xl/workbook.xml")) return { assinatura: "XLSX" };
        if (zip.encontrar("word/document.xml")) return { assinatura: "DOCX" };
        return { assinatura: "ZIP" };
      } finally {
        zip.fechar();
      }
    } catch (e) {
      return { assinatura: "DESCONHECIDA", detalhe: `ZIP corrompido: ${(e as Error).message}` };
    }
  }
  if (buf.subarray(0, 6).toString("latin1") === "Rar!\x1a\x07") return { assinatura: "RAR" };
  if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return { assinatura: "XLS_LEGADO" };
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { assinatura: "PDF" };
  try {
    interpretarCabecalhoDbf(buf, info.size);
    return { assinatura: "DBF" };
  } catch (e) {
    if (e instanceof ErroDbf) return { assinatura: "DESCONHECIDA", detalhe: e.message };
    throw e;
  }
}

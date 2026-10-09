import yauzl from "yauzl";
import type { Readable } from "node:stream";

/** Acesso de leitura em fluxo a um arquivo ZIP (inclui XLSX), com limites contra "zip bomb". */
export const LIMITE_DESCOMPACTADO_POR_ENTRADA = 1024 * 1024 * 1024; // 1 GiB
export const LIMITE_TAXA_COMPRESSAO = 200;

export interface EntradaZip {
  nome: string;
  tamanhoCompactado: number;
  tamanhoDescompactado: number;
  diretorio: boolean;
  entrada: yauzl.Entry;
}

export class ArquivoZip {
  private constructor(private readonly zip: yauzl.ZipFile, readonly entradas: EntradaZip[]) {}

  static abrir(caminho: string): Promise<ArquivoZip> {
    return new Promise((resolve, reject) => {
      yauzl.open(caminho, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
        if (err || !zip) return reject(err ?? new Error("Falha ao abrir ZIP"));
        const entradas: EntradaZip[] = [];
        zip.on("entry", (e: yauzl.Entry) => {
          entradas.push({
            nome: e.fileName,
            tamanhoCompactado: e.compressedSize,
            tamanhoDescompactado: e.uncompressedSize,
            diretorio: e.fileName.endsWith("/"),
            entrada: e,
          });
          zip.readEntry();
        });
        zip.on("end", () => resolve(new ArquivoZip(zip, entradas)));
        zip.on("error", reject);
        zip.readEntry();
      });
    });
  }

  encontrar(nome: string): EntradaZip | undefined {
    return this.entradas.find((e) => e.nome === nome) ?? this.entradas.find((e) => e.nome.toLowerCase() === nome.toLowerCase());
  }

  abrirFluxo(e: EntradaZip): Promise<Readable> {
    if (e.tamanhoDescompactado > LIMITE_DESCOMPACTADO_POR_ENTRADA) {
      return Promise.reject(new Error(`Entrada "${e.nome}" grande demais (${e.tamanhoDescompactado} bytes)`));
    }
    if (e.tamanhoCompactado > 0 && e.tamanhoDescompactado / e.tamanhoCompactado > LIMITE_TAXA_COMPRESSAO && e.tamanhoDescompactado > 50 * 1024 * 1024) {
      return Promise.reject(new Error(`Entrada "${e.nome}" com taxa de compressão suspeita`));
    }
    return new Promise((resolve, reject) => {
      this.zip.openReadStream(e.entrada, (err, stream) => (err || !stream ? reject(err ?? new Error("Falha ao ler entrada")) : resolve(stream)));
    });
  }

  async lerTexto(e: EntradaZip): Promise<string> {
    const s = await this.abrirFluxo(e);
    const partes: Buffer[] = [];
    for await (const p of s) partes.push(p as Buffer);
    return Buffer.concat(partes).toString("utf8");
  }

  fechar(): void {
    this.zip.close();
  }
}

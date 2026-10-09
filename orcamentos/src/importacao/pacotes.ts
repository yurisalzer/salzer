import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createExtractorFromFile } from "node-unrar-js";
import { detectarAssinatura, type Assinatura } from "./assinatura";
import { ArquivoZip } from "./zip";

/** Extensões de dados extraídas de pacotes; os demais conteúdos (PDF, DOCX…) só são listados. */
const EXTENSOES_DADOS = new Set([".dbf", ".xls", ".xlsx"]);
const LIMITE_ARQUIVOS_PACOTE = 500;

export interface ArquivoPreparado {
  nome: string;
  caminhoNoPacote: string;
  caminhoDisco: string | null; // null = não extraído (apenas listado)
  tamanho: number;
  sha256: string | null;
  assinatura: Assinatura | "NAO_EXTRAIDO";
  pacoteSha256: string | null;
}

export async function sha256Arquivo(caminho: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(caminho), h);
  return h.digest("hex");
}

export async function criarDiretorioTemporario(): Promise<string> {
  const base = process.env.UPLOAD_TMP_DIR || path.join(os.tmpdir(), "orcamentos-upload");
  await mkdir(base, { recursive: true });
  return mkdtemp(path.join(base, "lote-"));
}

export async function removerDiretorio(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Nome seguro em disco (sem diretórios, sem caracteres especiais), único dentro do lote. */
function nomeSeguro(indice: number, original: string): string {
  const base = path.basename(original).normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-80);
  return `${String(indice).padStart(4, "0")}_${base}`;
}

/**
 * Recebe arquivos enviados (já gravados em `dir`) e devolve a lista de arquivos de dados,
 * expandindo ZIP (não-XLSX) e RAR. Calcula SHA-256 e a assinatura real de cada um.
 */
export async function prepararArquivos(dir: string, enviados: Array<{ nomeOriginal: string; caminho: string }>): Promise<ArquivoPreparado[]> {
  const saida: ArquivoPreparado[] = [];
  let contador = 0;
  for (const e of enviados) {
    const info = await stat(e.caminho);
    const sha = await sha256Arquivo(e.caminho);
    const { assinatura } = await detectarAssinatura(e.caminho);
    saida.push({ nome: path.basename(e.nomeOriginal), caminhoNoPacote: e.nomeOriginal, caminhoDisco: e.caminho, tamanho: info.size, sha256: sha, assinatura, pacoteSha256: null });
    if (assinatura === "ZIP") {
      const zip = await ArquivoZip.abrir(e.caminho);
      try {
        const entradas = zip.entradas.filter((x) => !x.diretorio);
        if (entradas.length > LIMITE_ARQUIVOS_PACOTE) throw new Error(`Pacote com arquivos demais (${entradas.length})`);
        for (const ent of entradas) {
          const nome = path.posix.basename(ent.nome);
          const caminhoNoPacote = `${e.nomeOriginal}/${ent.nome}`;
          if (!EXTENSOES_DADOS.has(path.extname(nome).toLowerCase())) {
            saida.push({ nome, caminhoNoPacote, caminhoDisco: null, tamanho: ent.tamanhoDescompactado, sha256: null, assinatura: "NAO_EXTRAIDO", pacoteSha256: sha });
            continue;
          }
          const destino = path.join(dir, nomeSeguro(++contador, nome));
          await pipeline(await zip.abrirFluxo(ent), createWriteStream(destino));
          saida.push(await descrever(destino, nome, caminhoNoPacote, sha));
        }
      } finally {
        zip.fechar();
      }
    } else if (assinatura === "RAR") {
      const subdir = path.join(dir, `rar-${++contador}`);
      await mkdir(subdir);
      const mapa = new Map<string, string>();
      const extrator = await createExtractorFromFile({
        filepath: e.caminho,
        targetPath: subdir,
        // Grava com nome seguro (impede "../" e caminhos absolutos dentro do RAR)
        filenameTransform: (original: string) => {
          const seguro = nomeSeguro(++contador, original);
          mapa.set(original, seguro);
          return seguro;
        },
      });
      const lista = [...extrator.getFileList().fileHeaders];
      if (lista.length > LIMITE_ARQUIVOS_PACOTE) throw new Error(`Pacote com arquivos demais (${lista.length})`);
      for (const h of lista) {
        if (h.flags.directory) continue;
        if (!EXTENSOES_DADOS.has(path.extname(h.name).toLowerCase())) {
          saida.push({ nome: path.basename(h.name), caminhoNoPacote: `${e.nomeOriginal}/${h.name}`, caminhoDisco: null, tamanho: h.unpSize, sha256: null, assinatura: "NAO_EXTRAIDO", pacoteSha256: sha });
        }
      }
      const extraidos = extrator.extract({ files: (h) => !h.flags.directory && EXTENSOES_DADOS.has(path.extname(h.name).toLowerCase()) });
      for (const f of extraidos.files) {
        const original = f.fileHeader.name;
        const seguro = mapa.get(original);
        if (!seguro) throw new Error(`Falha ao localizar arquivo extraído: ${original}`);
        saida.push(await descrever(path.join(subdir, seguro), path.basename(original), `${e.nomeOriginal}/${original}`, sha));
      }
    }
  }
  return saida;
}

async function descrever(caminho: string, nome: string, caminhoNoPacote: string, pacoteSha256: string): Promise<ArquivoPreparado> {
  const info = await stat(caminho);
  const { assinatura } = await detectarAssinatura(caminho);
  return { nome, caminhoNoPacote, caminhoDisco: caminho, tamanho: info.size, sha256: await sha256Arquivo(caminho), assinatura, pacoteSha256 };
}

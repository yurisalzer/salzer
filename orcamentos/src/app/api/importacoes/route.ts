import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { headers } from "next/headers";
import { autorizarApi, respostaDeErro, RespostaErro } from "@/servidor/api";
import { criarDiretorioTemporario, removerDiretorio } from "@/importacao/pacotes";
import { analisarImportacao } from "@/importacao/servico";
import { lerCompetencia, type CodigoRegime } from "@/dominio/referencias";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const REGIMES_VALIDOS = new Set(["SEM_DESONERACAO", "COM_DESONERACAO", "SEM_ENCARGOS"]);
const UFS = new Set(["RJ"]); // fase inicial: somente Rio de Janeiro

/** Passos 4–7 do assistente: recebe os arquivos em fluxo e devolve o lote analisado. */
export async function POST(req: Request) {
  let dir: string | null = null;
  try {
    const u = await autorizarApi("importacao.executar", "POST");
    const limiteMb = Number(process.env.UPLOAD_MAX_MB ?? "200");
    const tipo = req.headers.get("content-type") ?? "";
    if (!tipo.startsWith("multipart/form-data") || !req.body) throw new RespostaErro(400, "Envio inválido");
    dir = await criarDiretorioTemporario();
    const campos: Record<string, string> = {};
    const enviados: Array<{ nomeOriginal: string; caminho: string }> = [];
    const gravacoes: Promise<void>[] = [];
    let excedeu = false;

    await new Promise<void>((resolve, reject) => {
      const bb = Busboy({ headers: { "content-type": tipo }, limits: { fileSize: limiteMb * 1024 * 1024, files: 20, fields: 20, fieldSize: 4000 } });
      bb.on("field", (nome, valor) => {
        campos[nome] = valor;
      });
      bb.on("file", (_campo, fluxo, info) => {
        const nome = path.basename(info.filename || "arquivo").slice(0, 200);
        const destino = path.join(dir!, `envio-${enviados.length}`);
        enviados.push({ nomeOriginal: nome, caminho: destino });
        fluxo.on("limit", () => {
          excedeu = true;
        });
        gravacoes.push(pipeline(fluxo, createWriteStream(destino)));
      });
      bb.on("error", reject);
      bb.on("close", () => resolve());
      Readable.fromWeb(req.body as never).pipe(bb);
    });
    await Promise.all(gravacoes);
    if (excedeu) throw new RespostaErro(413, `Arquivo maior que o limite de ${limiteMb} MB`);
    if (enviados.length === 0) throw new RespostaErro(400, "Nenhum arquivo enviado");

    const fonte = campos.fonte;
    if (fonte !== "EMOP" && fonte !== "SINAPI") throw new RespostaErro(400, "Fonte inválida");
    const competencia = lerCompetencia(campos.competencia ?? "");
    if (!competencia || competencia < new Date(Date.UTC(2026, 0, 1))) throw new RespostaErro(400, "Competência inválida (a partir de jan/2026)");
    const uf = (campos.uf ?? "RJ").toUpperCase();
    if (!UFS.has(uf)) throw new RespostaErro(400, "Nesta fase somente a UF RJ é suportada");
    const regimes = (campos.regimes ?? "").split(",").filter((r) => REGIMES_VALIDOS.has(r)) as CodigoRegime[];
    if (regimes.length === 0) throw new RespostaErro(400, "Selecione ao menos um regime");
    const h = await headers();

    const r = await analisarImportacao({
      fonte, uf, competencia, regimes, rotuloRevisao: campos.rotulo?.slice(0, 100) || null, usuarioId: u.id, dir, enviados,
      justificativaDuplicidade: campos.justificativa?.slice(0, 1000) || null,
      podeAutorizarDuplicidade: u.permissoes.has("importacao.autorizar_duplicidade"),
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
    dir = null; // analisarImportacao remove o diretório
    return Response.json(r);
  } catch (e) {
    if (dir) await removerDiretorio(dir).catch(() => undefined);
    return respostaDeErro(e);
  }
}

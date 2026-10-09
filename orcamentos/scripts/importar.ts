/**
 * Importação pelo terminal — usa exatamente o mesmo fluxo e validações da tela web.
 *
 *   npm run importar -- --fonte EMOP --competencia 01/2026 EMOP_012026.rar
 *   npm run importar -- --fonte SINAPI --competencia 01/2026 --rotulo "Retificação 01" SINAPI-2026-01.zip --confirmar --publicar
 *
 * Opções: --uf RJ  --regimes SEM_DESONERACAO,COM_DESONERACAO,SEM_ENCARGOS  --email (usuário responsável)
 *         --confirmar (grava a revisão)  --publicar (disponibiliza para orçamentos)
 *         --justificativa "texto" (reimportar arquivo já importado; exige permissão do usuário --email)
 */
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/servidor/db";
import { lerCompetencia, type CodigoRegime } from "../src/dominio/referencias";
import { criarDiretorioTemporario } from "../src/importacao/pacotes";
import { analisarImportacao, confirmarImportacao, publicarRevisaoBase } from "../src/importacao/servico";

function opcao(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (nome: string) => process.argv.includes(`--${nome}`);

async function main() {
  const fonte = (opcao("fonte") ?? "").toUpperCase();
  if (fonte !== "EMOP" && fonte !== "SINAPI") throw new Error("Use --fonte EMOP ou --fonte SINAPI");
  const competencia = lerCompetencia(opcao("competencia") ?? "");
  if (!competencia) throw new Error("Use --competencia MM/AAAA");
  const regimes = (opcao("regimes") ?? (fonte === "EMOP" ? "SEM_DESONERACAO,COM_DESONERACAO" : "SEM_DESONERACAO,COM_DESONERACAO,SEM_ENCARGOS")).split(",") as CodigoRegime[];
  const comValor = new Set(["fonte", "competencia", "uf", "regimes", "rotulo", "email", "justificativa"].map((o) => `--${o}`));
  const arquivos = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && !comValor.has(arr[i - 1] ?? ""));
  if (arquivos.length === 0) throw new Error("Informe os arquivos a importar");

  const email = opcao("email");
  const usuario = email ? await prisma.usuarios.findUnique({ where: { email } }) : null;
  const podeAutorizar = usuario
    ? (await prisma.usuarios_papeis.count({
        where: { usuario_id: usuario.id, papeis: { papeis_permissoes: { some: { permissoes: { codigo: "importacao.autorizar_duplicidade" } } } } },
      })) > 0
    : false;
  const dir = await criarDiretorioTemporario();
  const enviados = [];
  for (const [i, a] of arquivos.entries()) {
    const destino = path.join(dir, `envio-${i}${path.extname(a)}`);
    await copyFile(a, destino);
    enviados.push({ nomeOriginal: path.basename(a), caminho: destino });
  }
  const t0 = Date.now();
  const r = await analisarImportacao({
    fonte, uf: opcao("uf") ?? "RJ", competencia, regimes, rotuloRevisao: opcao("rotulo"), usuarioId: usuario?.id ?? null, dir, enviados,
    justificativaDuplicidade: opcao("justificativa"), podeAutorizarDuplicidade: podeAutorizar,
  });
  const lote = await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r.loteId } });
  console.log(`Lote ${r.loteId}: ${r.status} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (lote.erro) console.log("Erro:", lote.erro);
  console.log("Contagens:", lote.contagens);
  const verif = await prisma.verificacoes_importacao.findMany({ where: { lote_id: r.loteId }, orderBy: [{ severidade: "asc" }, { criado_em: "asc" }] });
  const porRegra = new Map<string, { sev: string; n: number; ex: string }>();
  for (const v of verif) {
    const k = `${v.severidade} ${v.regra}`;
    const e = porRegra.get(k);
    if (e) e.n++;
    else porRegra.set(k, { sev: v.severidade, n: 1, ex: v.mensagem });
  }
  for (const [k, e] of porRegra) console.log(`  ${k} (${e.n}): ${e.ex}`);
  if (r.status !== "ANALISADO" || r.erros > 0) {
    process.exitCode = 2;
    return;
  }
  if (flag("confirmar")) {
    const t1 = Date.now();
    const { revisaoBaseId } = await confirmarImportacao(r.loteId, usuario?.id ?? null);
    console.log(`Revisão gravada (${revisaoBaseId}) em ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    if (flag("publicar")) {
      await publicarRevisaoBase(revisaoBaseId, usuario?.id ?? null);
      console.log("Revisão PUBLICADA.");
    }
  }
}

main()
  .catch((e) => {
    console.error("Erro:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

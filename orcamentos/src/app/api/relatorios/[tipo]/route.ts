import { autorizarApi, respostaDeErro, RespostaErro } from "@/servidor/api";
import { auditar } from "@/servidor/auditoria";
import { prisma } from "@/servidor/db";
import { montarRelatorio, TIPOS_RELATORIO, type TipoRelatorio } from "@/relatorios/montadores";
import { gerarPdf } from "@/relatorios/pdf";
import { gerarXlsx } from "@/relatorios/xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID = /^[0-9a-f-]{36}$/;

export async function GET(req: Request, ctx: { params: Promise<{ tipo: string }> }) {
  try {
    const u = await autorizarApi("relatorios.exportar");
    const { tipo } = await ctx.params;
    if (!(tipo in TIPOS_RELATORIO)) throw new RespostaErro(404, "Relatório desconhecido");
    const url = new URL(req.url);
    const revisao = url.searchParams.get("revisao") ?? "";
    const com = url.searchParams.get("com");
    const formato = url.searchParams.get("formato") === "xlsx" ? "xlsx" : "pdf";
    if (!UUID.test(revisao) || (com && !UUID.test(com))) throw new RespostaErro(400, "Revisão inválida");
    if (!(await prisma.revisoes_orcamento.findUnique({ where: { id: revisao } }))) throw new RespostaErro(404, "Revisão não encontrada");
    const r = await montarRelatorio(tipo as TipoRelatorio, revisao, com);
    const corpo = formato === "pdf" ? await gerarPdf(r) : await gerarXlsx(r);
    await auditar({ usuarioId: u.id, acao: "RELATORIO_EXPORTADO", entidade: "revisoes_orcamento", entidadeId: revisao, dados: { tipo, formato } });
    return new Response(new Uint8Array(corpo), {
      headers: {
        "content-type": formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${r.arquivo}-${revisao.slice(0, 8)}.${formato}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return respostaDeErro(e);
  }
}

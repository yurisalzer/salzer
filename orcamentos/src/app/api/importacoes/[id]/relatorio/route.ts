import { autorizarApi, respostaDeErro } from "@/servidor/api";
import { prisma } from "@/servidor/db";

export const dynamic = "force-dynamic";

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Passo 10: relatório de inconsistências em CSV (abre direto no Excel em português). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await autorizarApi("bases.consultar");
    const { id } = await ctx.params;
    const lote = await prisma.lotes_importacao.findUniqueOrThrow({ where: { id }, include: { fontes: true } });
    const v = await prisma.verificacoes_importacao.findMany({ where: { lote_id: id }, orderBy: [{ severidade: "asc" }, { regra: "asc" }, { criado_em: "asc" }] });
    const linhas = [
      ["Fonte", "Competência", "Lote", "Importador"].map(csv).join(";"),
      [lote.fontes.sigla, lote.competencia.toISOString().slice(0, 7), lote.id, `${lote.adaptador ?? ""} v${lote.importador_versao}`].map(csv).join(";"),
      "",
      ["Severidade", "Regra", "Mensagem", "Arquivo", "Linha", "Código"].join(";"),
      ...v.map((x) => [x.severidade, x.regra, x.mensagem, x.arquivo, x.linha, x.codigo].map(csv).join(";")),
    ];
    return new Response("﻿" + linhas.join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="importacao-${lote.fontes.sigla}-${lote.competencia.toISOString().slice(0, 7)}-${id.slice(0, 8)}.csv"`,
      },
    });
  } catch (e) {
    return respostaDeErro(e);
  }
}

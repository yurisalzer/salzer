import { notFound } from "next/navigation";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { EditorComposicao } from "../../editor";
import { basesVigentes } from "../../bases";

export default async function EditarComposicao({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario("composicoes.editar");
  const { id } = await params;
  const item = await prisma.itens_referencia.findUnique({
    where: { id },
    include: { fontes: true, composicoes: { orderBy: { versao: "desc" }, take: 1, include: { composicao_itens: { orderBy: { ordem: "asc" }, include: { itens_referencia: { include: { fontes: true } } } } } } },
  });
  if (!item || item.fontes.sigla !== "PROPRIA") notFound();
  const b = await basesVigentes();
  const comp = item.composicoes[0];
  return (
    <div className="space-y-4">
      <h1 className="titulo-pagina">Editar composição própria {item.codigo}</h1>
      <p className="text-sm text-slate-500">Salvar cria a versão {(comp?.versao ?? 0) + 1}; versões anteriores (e orçamentos que as usam) não mudam.</p>
      <EditorComposicao
        revisoes={b.ids}
        rotulosRevisoes={b.rotulo}
        inicial={{
          itemId: item.id, codigo: item.codigo, descricao: item.descricao, unidade: item.unidade,
          componentes: (comp?.composicao_itens ?? []).map((c) => ({
            chave: `${c.composicao_id}-${c.ordem}`, itemId: c.item_id,
            rotulo: c.itens_referencia ? `${c.itens_referencia.fontes.sigla} ${c.itens_referencia.codigo} — ${c.itens_referencia.descricao}` : "",
            unidade: c.itens_referencia?.unidade ?? "", revisaoBaseId: c.revisao_base_id, regime: c.regime_codigo, coeficiente: c.coeficiente.toString(),
            custoInformado: c.custo_unitario_informado?.toString() ?? null, descricaoInformada: c.descricao_informada, unidadeInformada: c.unidade_informada,
          })),
        }}
      />
    </div>
  );
}

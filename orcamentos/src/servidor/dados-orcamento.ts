import { prisma, type Tx } from "./db";
import { D, Decimal, ZERO, type ModoArredondamento } from "@/dominio/decimal";
import { calcularItem, numerarEtapas, ordenarEtapasEmProfundidade } from "@/dominio/orcamento";
import { formatarCompetencia } from "@/dominio/formato";
import { NOMES_REGIME, type CodigoRegime } from "@/dominio/referencias";

export interface ItemCarregado {
  id: string;
  numero: string; // "1.2.3"
  ordem: number;
  etapaId: string;
  tipo: string;
  fonte: string;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: Decimal;
  custoUnitario: Decimal | null;
  bdiPercentual: Decimal;
  bdiAplicadoId: string | null;
  precoUnitario: Decimal | null;
  total: Decimal | null;
  custoTotal: Decimal | null;
  situacaoPreco: string;
  referencia: string; // "SINAPI jan/2026 Retificação 01 · Sem desoneração"
  itemReferenciaId: string | null;
  revisaoBaseId: string | null;
  regime: string | null;
  composicaoId: string | null;
  observacao: string | null;
}

export interface EtapaCarregada {
  id: string;
  paiId: string | null;
  numero: string;
  nivel: number;
  titulo: string;
  itens: ItemCarregado[];
  /** Subtotais incluindo subetapas */
  total: Decimal;
  custo: Decimal;
}

export async function carregarRevisao(revisaoId: string, db: Tx = prisma) {
  const rev = await db.revisoes_orcamento.findUniqueOrThrow({
    where: { id: revisaoId },
    include: {
      orcamentos: { include: { obras: true } },
      bdis_aplicados: { orderBy: { criado_em: "asc" } },
      revisoes_orcamento_bases: { include: { fontes: true, revisoes_base: { include: { bases_referencia: true } } } },
      fechador: true,
      criador: true,
    },
  });
  const modo = rev.modo_arredondamento as ModoArredondamento;
  const etapasDb = await db.etapas.findMany({ where: { revisao_id: revisaoId } });
  const numeros = numerarEtapas(etapasDb);
  const itensDb = await db.itens_orcamento.findMany({ where: { revisao_id: revisaoId }, orderBy: { ordem: "asc" } });
  const etapas: EtapaCarregada[] = ordenarEtapasEmProfundidade(etapasDb).map((e) => ({
    id: e.id, paiId: e.pai_id, numero: numeros.get(e.id)!, nivel: numeros.get(e.id)!.split(".").length, titulo: e.titulo, itens: [], total: ZERO, custo: ZERO,
  }));
  const porId = new Map(etapas.map((e) => [e.id, e]));
  for (const i of itensDb) {
    const e = porId.get(i.etapa_id)!;
    const custoTotal = calcularItem({ custoUnitario: i.custo_unitario, quantidade: i.quantidade, bdiPercentual: i.bdi_percentual, modo }).custoTotal;
    const ref = i.fonte_sigla === "PROPRIA"
      ? "Próprio"
      : `${i.fonte_sigla} ${i.competencia ? formatarCompetencia(i.competencia) : ""} ${i.rotulo_revisao_base ?? ""} · ${NOMES_REGIME[i.regime_codigo as CodigoRegime] ?? ""}`;
    e.itens.push({
      id: i.id, numero: `${e.numero}.${i.ordem}`, ordem: i.ordem, etapaId: i.etapa_id, tipo: i.tipo, fonte: i.fonte_sigla, codigo: i.codigo,
      descricao: i.descricao, unidade: i.unidade, quantidade: D(i.quantidade), custoUnitario: i.custo_unitario !== null ? D(i.custo_unitario) : null,
      bdiPercentual: D(i.bdi_percentual), bdiAplicadoId: i.bdi_aplicado_id, precoUnitario: i.preco_unitario !== null ? D(i.preco_unitario) : null,
      total: i.total !== null ? D(i.total) : null, custoTotal, situacaoPreco: i.situacao_preco, referencia: ref.trim(),
      itemReferenciaId: i.item_referencia_id, revisaoBaseId: i.revisao_base_id, regime: i.regime_codigo, composicaoId: i.composicao_id, observacao: i.observacao,
    });
  }
  // Subtotais acumulados das folhas para as etapas-mãe
  for (const e of [...etapas].reverse()) {
    for (const i of e.itens) {
      e.total = e.total.plus(i.total ?? ZERO);
      e.custo = e.custo.plus(i.custoTotal ?? ZERO);
    }
    if (e.paiId) {
      const pai = porId.get(e.paiId)!;
      pai.total = pai.total.plus(e.total);
      pai.custo = pai.custo.plus(e.custo);
    }
  }
  const raiz = etapas.filter((e) => !e.paiId);
  const total = raiz.reduce((s, e) => s.plus(e.total), ZERO);
  const custo = raiz.reduce((s, e) => s.plus(e.custo), ZERO);
  const itens = etapas.flatMap((e) => e.itens);
  const bdiPadrao = rev.bdis_aplicados.find((b) => b.id === rev.bdi_padrao_id) ?? null;
  const bases = rev.revisoes_orcamento_bases.map((b) => ({
    fonte: b.fontes.sigla, fonteId: b.fonte_id, revisaoBaseId: b.revisao_base_id, regime: b.regime_codigo,
    competencia: b.revisoes_base.bases_referencia.competencia, rotulo: b.revisoes_base.rotulo, status: b.revisoes_base.status,
    descricao: `${b.fontes.sigla} ${formatarCompetencia(b.revisoes_base.bases_referencia.competencia)} (${b.revisoes_base.rotulo}) · ${NOMES_REGIME[b.regime_codigo as CodigoRegime]}`,
  }));
  const cronograma = await db.cronograma.findMany({ where: { revisao_id: revisaoId } });
  return {
    rev, obra: rev.orcamentos.obras, orcamento: rev.orcamentos, modo, etapas, itens, bases, bdiPadrao, bdis: rev.bdis_aplicados,
    totais: { custo, bdi: total.minus(custo), total, semPreco: itens.filter((i) => i.total === null).length },
    cronograma,
  };
}

export type RevisaoCarregada = Awaited<ReturnType<typeof carregarRevisao>>;

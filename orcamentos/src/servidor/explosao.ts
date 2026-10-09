import type { Tx } from "./db";
import { D, Decimal } from "@/dominio/decimal";
import { ErroDeNegocio } from "@/importacao/servico";

/**
 * Explosão de um serviço até os insumos (para curva ABC de insumos, orçamento analítico e
 * fechamento). Coeficiente acumulado = produto dos coeficientes no caminho; nas composições
 * EMOP, a quantidade inclui as perdas: q × (1 + %/100).
 *
 * Observação: a soma (coeficiente × preço) dos insumos pode diferir em centavos do custo
 * publicado, porque as fontes truncam cada linha. Os relatórios mostram essa diferença.
 */
export interface InsumoExplodido {
  nivel: number;
  tipoItem: "INSUMO" | "COMPOSICAO_SEM_ANALITICO";
  fonte: string;
  itemId: string | null;
  codigo: string;
  descricao: string;
  unidade: string;
  coeficiente: Decimal; // por unidade do serviço
  custoUnitario: Decimal | null;
  revisaoBaseId: string | null;
  regime: string | null;
}

const PROFUNDIDADE_MAXIMA = 12;

interface Contexto {
  db: Tx;
  cachePublicada: Map<string, string | null>; // revisao|item → composicao_id
}

async function composicaoPublicada(ctx: Contexto, revisaoBaseId: string, itemId: string): Promise<string | null> {
  const k = `${revisaoBaseId}|${itemId}`;
  if (!ctx.cachePublicada.has(k)) {
    const p = await ctx.db.composicoes_publicadas.findUnique({ where: { revisao_base_id_item_id: { revisao_base_id: revisaoBaseId, item_id: itemId } } });
    ctx.cachePublicada.set(k, p?.composicao_id ?? null);
  }
  return ctx.cachePublicada.get(k)!;
}

async function preco(ctx: Contexto, itemId: string, revisaoBaseId: string, regime: string): Promise<{ preco: Decimal | null; descricao: string; unidade: string } | null> {
  const p = await ctx.db.precos_referencia.findUnique({
    where: { item_id_revisao_base_id_regime_codigo: { item_id: itemId, revisao_base_id: revisaoBaseId, regime_codigo: regime } },
    include: { descricoes_item: true },
  });
  if (!p) return null;
  return { preco: p.preco !== null ? D(p.preco) : null, descricao: p.descricoes_item.descricao, unidade: p.descricoes_item.unidade };
}

async function explodirComposicao(ctx: Contexto, composicaoId: string, fator: Decimal, nivel: number, padrao: { revisaoBaseId: string | null; regime: string | null }, saida: InsumoExplodido[]): Promise<void> {
  if (nivel > PROFUNDIDADE_MAXIMA) throw new ErroDeNegocio("Composição com aninhamento excessivo (possível referência circular).");
  const linhas = await ctx.db.composicao_itens.findMany({
    where: { composicao_id: composicaoId },
    orderBy: { ordem: "asc" },
    include: { itens_referencia: { include: { fontes: true } } },
  });
  for (const l of linhas) {
    const coef = fator.times(D(l.coeficiente)).times(D(l.percentual_perda ?? 0).div(100).plus(1));
    const item = l.itens_referencia;
    if (!item) {
      // Insumo próprio informado (cotação)
      saida.push({ nivel, tipoItem: "INSUMO", fonte: "PROPRIA", itemId: null, codigo: "COTAÇÃO", descricao: l.descricao_informada ?? "", unidade: l.unidade_informada ?? "", coeficiente: coef, custoUnitario: l.custo_unitario_informado !== null ? D(l.custo_unitario_informado) : null, revisaoBaseId: null, regime: null });
      continue;
    }
    const fonte = item.fontes.sigla;
    if (fonte === "PROPRIA") {
      const sub = await ctx.db.composicoes.findFirst({ where: { item_id: item.id }, orderBy: { versao: "desc" } });
      if (sub) await explodirComposicao(ctx, sub.id, coef, nivel + 1, padrao, saida);
      continue;
    }
    const revisaoBaseId = l.revisao_base_id ?? padrao.revisaoBaseId;
    const regime = l.regime_codigo ?? padrao.regime;
    if (!revisaoBaseId || !regime) continue;
    // Subcomposição (SINAPI) ou elementar reutilizado (EMOP REUT → composição vinculada)
    let alvo: string | null = null;
    if (item.tipo === "COMPOSICAO") alvo = item.id;
    else if (item.codigo_composicao_vinculada) {
      const v = await ctx.db.itens_referencia.findUnique({ where: { fonte_id_tipo_codigo: { fonte_id: item.fonte_id, tipo: "COMPOSICAO", codigo: item.codigo_composicao_vinculada } } });
      alvo = v?.id ?? null;
    }
    const compId = alvo ? await composicaoPublicada(ctx, revisaoBaseId, alvo) : null;
    if (compId) {
      await explodirComposicao(ctx, compId, coef, nivel + 1, { revisaoBaseId, regime }, saida);
      continue;
    }
    const p = await preco(ctx, item.id, revisaoBaseId, regime);
    saida.push({
      nivel, tipoItem: item.tipo === "INSUMO" ? "INSUMO" : "COMPOSICAO_SEM_ANALITICO", fonte, itemId: item.id, codigo: item.codigo,
      descricao: p?.descricao ?? item.descricao, unidade: p?.unidade ?? item.unidade, coeficiente: coef, custoUnitario: p?.preco ?? null, revisaoBaseId, regime,
    });
  }
}

/** Explode um item de orçamento (por unidade do serviço). */
export async function explodirItemOrcamento(
  db: Tx,
  item: { tipo: string; item_referencia_id: string | null; revisao_base_id: string | null; regime_codigo: string | null; composicao_id: string | null; fonte_sigla: string; codigo: string; descricao: string; unidade: string; custo_unitario: { toString(): string } | null },
  cache?: Map<string, string | null>,
): Promise<InsumoExplodido[]> {
  const ctx: Contexto = { db, cachePublicada: cache ?? new Map() };
  const saida: InsumoExplodido[] = [];
  const um = new Decimal(1);
  if (item.tipo === "PROPRIO") {
    if (item.composicao_id) await explodirComposicao(ctx, item.composicao_id, um, 1, { revisaoBaseId: null, regime: null }, saida);
    else saida.push({ nivel: 1, tipoItem: "COMPOSICAO_SEM_ANALITICO", fonte: "PROPRIA", itemId: null, codigo: item.codigo, descricao: item.descricao, unidade: item.unidade, coeficiente: um, custoUnitario: item.custo_unitario !== null ? D(item.custo_unitario) : null, revisaoBaseId: null, regime: null });
    return saida;
  }
  if (!item.item_referencia_id || !item.revisao_base_id || !item.regime_codigo) return saida;
  const ref = await db.itens_referencia.findUniqueOrThrow({ where: { id: item.item_referencia_id } });
  let alvo: string | null = ref.tipo === "COMPOSICAO" ? ref.id : null;
  if (!alvo && ref.codigo_composicao_vinculada) {
    const v = await db.itens_referencia.findUnique({ where: { fonte_id_tipo_codigo: { fonte_id: ref.fonte_id, tipo: "COMPOSICAO", codigo: ref.codigo_composicao_vinculada } } });
    alvo = v?.id ?? null;
  }
  const compId = alvo ? await composicaoPublicada(ctx, item.revisao_base_id, alvo) : null;
  if (compId) {
    await explodirComposicao(ctx, compId, um, 1, { revisaoBaseId: item.revisao_base_id, regime: item.regime_codigo }, saida);
  } else {
    saida.push({
      nivel: 1, tipoItem: ref.tipo === "INSUMO" ? "INSUMO" : "COMPOSICAO_SEM_ANALITICO", fonte: item.fonte_sigla, itemId: ref.id, codigo: item.codigo,
      descricao: item.descricao, unidade: item.unidade, coeficiente: um, custoUnitario: item.custo_unitario !== null ? D(item.custo_unitario) : null,
      revisaoBaseId: item.revisao_base_id, regime: item.regime_codigo,
    });
  }
  return saida;
}

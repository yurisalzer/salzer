import { prisma, type Tx } from "./db";
import { D, Decimal, ZERO, truncar } from "@/dominio/decimal";

export interface RevisaoPublicada {
  id: string;
  fonte: string;
  fonteId: string;
  uf: string;
  competencia: Date;
  numero: number;
  rotulo: string;
  status: string;
  regimes: string[];
}

/** Revisões disponíveis para orçamentos (publicadas), mais recentes primeiro. */
export async function revisoesPublicadas(db: Tx = prisma, incluirSubstituidas = false): Promise<RevisaoPublicada[]> {
  const r = await db.revisoes_base.findMany({
    where: { status: incluirSubstituidas ? { in: ["PUBLICADA", "SUBSTITUIDA"] } : "PUBLICADA" },
    include: { bases_referencia: { include: { fontes: true } } },
    orderBy: [{ bases_referencia: { competencia: "desc" } }, { numero: "desc" }],
  });
  return r.map((x) => ({
    id: x.id, fonte: x.bases_referencia.fontes.sigla, fonteId: x.bases_referencia.fonte_id, uf: x.bases_referencia.uf,
    competencia: x.bases_referencia.competencia, numero: x.numero, rotulo: x.rotulo, status: x.status, regimes: x.regimes,
  }));
}

export interface ItemBusca {
  id: string;
  fonte: string;
  tipo: string;
  codigo: string;
  descricao: string;
  unidade: string;
  classe: string | null;
  regime_item: string | null;
  revisao_base_id: string | null;
  regime_codigo: string | null;
  preco: string | null;
  situacao: string | null;
  tem_composicao: boolean;
}

export interface FiltroBusca {
  texto: string;
  /** Revisões em que procurar (uma por fonte). Itens próprios entram se `incluirProprios`. */
  revisoes: string[];
  regime: string;
  tipo?: "INSUMO" | "COMPOSICAO";
  incluirProprios?: boolean;
  limite?: number;
  deslocamento?: number;
}

/** Normaliza o termo para comparação de códigos (sem pontos/hífens/espaços). */
function pareceCodigo(t: string): boolean {
  return /^[\d.\-]+[A-Za-z]?$/.test(t.trim()) && /\d/.test(t);
}

/**
 * Busca por código (prefixo; também sem pontuação) ou por palavras da descrição
 * (todas as palavras, sem acento, em qualquer ordem). Retorna o preço na revisão/regime pedidos.
 */
export async function buscarItens(f: FiltroBusca, db: Tx = prisma): Promise<ItemBusca[]> {
  const texto = f.texto.trim().slice(0, 100);
  const params: unknown[] = [f.revisoes, f.regime];
  const cond: string[] = [];
  if (texto) {
    if (pareceCodigo(texto)) {
      params.push(texto, texto.replace(/[.\-\s]/g, ""));
      cond.push(`(i.codigo LIKE $${params.length - 1} || '%' OR replace(replace(i.codigo, '.', ''), '-', '') LIKE $${params.length} || '%')`);
    } else {
      const palavras = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter((p) => p.length > 0).slice(0, 8);
      for (const p of palavras) {
        params.push(`%${p.replace(/[%_\\]/g, "\\$&")}%`);
        cond.push(`f_normalizar_busca(i.descricao) LIKE $${params.length}`);
      }
    }
  }
  if (f.tipo) {
    params.push(f.tipo);
    cond.push(`i.tipo = $${params.length}`);
  }
  const where = cond.length ? `AND ${cond.join(" AND ")}` : "";
  params.push(Math.min(f.limite ?? 50, 200), f.deslocamento ?? 0);
  const lim = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const proprios = f.incluirProprios
    ? `UNION ALL
       SELECT i.id, fo.sigla AS fonte, i.tipo, i.codigo, i.descricao, i.unidade, i.classe, i.regime_codigo AS regime_item,
              NULL::uuid AS revisao_base_id, NULL AS regime_codigo, NULL AS preco, NULL AS situacao,
              EXISTS (SELECT 1 FROM composicoes c WHERE c.item_id = i.id) AS tem_composicao
         FROM itens_referencia i JOIN fontes fo ON fo.id = i.fonte_id
        WHERE fo.sigla = 'PROPRIA' ${where}`
    : "";
  const sql = `
    SELECT * FROM (
      SELECT i.id, fo.sigla AS fonte, i.tipo, i.codigo, i.descricao, i.unidade, i.classe, i.regime_codigo AS regime_item,
             p.revisao_base_id, p.regime_codigo, p.preco::text AS preco, p.situacao,
             EXISTS (SELECT 1 FROM composicoes_publicadas cp WHERE cp.revisao_base_id = p.revisao_base_id AND cp.item_id = i.id) AS tem_composicao
        FROM precos_referencia p
        JOIN itens_referencia i ON i.id = p.item_id
        JOIN fontes fo ON fo.id = i.fonte_id
       WHERE p.revisao_base_id = ANY($1::uuid[]) AND p.regime_codigo = $2 ${where}
      ${proprios}
    ) r
    ORDER BY r.fonte, r.codigo
    ${lim}`;
  return db.$queryRawUnsafe<ItemBusca[]>(sql, ...params);
}

export interface LinhaHistorico {
  revisao_base_id: string;
  fonte: string;
  competencia: Date;
  numero: number;
  rotulo: string;
  status: string;
  regime_codigo: string;
  preco: string | null;
  situacao: string;
  descricao: string;
  unidade: string;
  percentual_mao_obra: string | null;
}

export async function historicoPrecos(itemId: string, db: Tx = prisma): Promise<LinhaHistorico[]> {
  return db.$queryRawUnsafe<LinhaHistorico[]>(
    `SELECT p.revisao_base_id, fo.sigla fonte, b.competencia, r.numero, r.rotulo, r.status, p.regime_codigo, p.preco::text preco, p.situacao,
            d.descricao, d.unidade, p.percentual_mao_obra::text percentual_mao_obra
       FROM precos_referencia p
       JOIN revisoes_base r ON r.id = p.revisao_base_id
       JOIN bases_referencia b ON b.id = r.base_id
       JOIN fontes fo ON fo.id = b.fonte_id
       JOIN descricoes_item d ON d.id = p.descricao_id
      WHERE p.item_id = $1::uuid AND r.status IN ('PUBLICADA', 'SUBSTITUIDA')
      ORDER BY b.competencia, r.numero, p.regime_codigo`,
    itemId,
  );
}

export interface LinhaAnalitica {
  ordem: number;
  sequencia: string | null;
  tipo_item: string;
  item_id: string | null;
  codigo: string;
  descricao: string;
  unidade: string;
  coeficiente: string;
  percentual_perda: string | null;
  preco: string | null;
  situacao: string | null;
  /** Valor da linha pela regra da fonte (null se faltar preço) */
  valor: string | null;
  tem_composicao: boolean;
  codigo_composicao_vinculada: string | null;
}

export interface ComposicaoAnalitica {
  composicaoId: string;
  versao: number;
  origem: string;
  situacao: string | null;
  linhas: LinhaAnalitica[];
  /** Soma pela regra da fonte; null se algum componente não tiver preço */
  totalCalculado: string | null;
  regra: string;
}

/** Valor de uma linha de composição pela regra de cada fonte (documentada em docs/REGRAS_DE_CALCULO.md). */
export function valorLinha(fonte: string, coeficiente: Decimal, preco: Decimal, percentualPerda: Decimal | null): Decimal {
  if (fonte === "EMOP") return truncar(coeficiente.times(preco).times(D(percentualPerda ?? 0).div(100).plus(1)), 4);
  return truncar(coeficiente.times(preco), 2);
}

export function totalComposicao(fonte: string, valores: Decimal[]): Decimal {
  const soma = valores.reduce((s, v) => s.plus(v), ZERO);
  return fonte === "EMOP" ? truncar(soma, 2) : soma;
}

export const REGRA_FONTE: Record<string, string> = {
  EMOP: "Σ TRUNC(quantidade × preço × (1 + perdas%); 4), truncado em 2 casas",
  SINAPI: "Σ TRUNC(coeficiente × custo unitário; 2)",
  PROPRIA: "Σ TRUNC(coeficiente × custo unitário; 2)",
};

/** Composição analítica publicada de um item numa revisão, com os preços da mesma revisão/regime. */
export async function composicaoAnalitica(itemId: string, revisaoBaseId: string, regime: string, db: Tx = prisma): Promise<ComposicaoAnalitica | null> {
  const pub = await db.composicoes_publicadas.findUnique({
    where: { revisao_base_id_item_id: { revisao_base_id: revisaoBaseId, item_id: itemId } },
    include: { composicoes: true, itens_referencia: { include: { fontes: true } } },
  });
  if (!pub) return null;
  const fonte = pub.itens_referencia.fontes.sigla;
  const linhas = await db.$queryRawUnsafe<Array<Omit<LinhaAnalitica, "valor">>>(
    `SELECT ci.ordem, ci.sequencia, ci.tipo_item, ci.item_id, ci.codigo_original codigo, coalesce(d.descricao, i.descricao) descricao,
            coalesce(d.unidade, i.unidade) unidade, ci.coeficiente::text coeficiente, ci.percentual_perda::text percentual_perda,
            p.preco::text preco, p.situacao, i.codigo_composicao_vinculada,
            EXISTS (SELECT 1 FROM composicoes_publicadas x WHERE x.revisao_base_id = $2::uuid AND x.item_id = ci.item_id) AS tem_composicao
       FROM composicao_itens ci
       JOIN itens_referencia i ON i.id = ci.item_id
       LEFT JOIN precos_referencia p ON p.item_id = ci.item_id AND p.revisao_base_id = $2::uuid AND p.regime_codigo = $3
       LEFT JOIN descricoes_item d ON d.id = p.descricao_id
      WHERE ci.composicao_id = $1::uuid
      ORDER BY ci.ordem`,
    pub.composicao_id, revisaoBaseId, regime,
  );
  let completo = true;
  const valores: Decimal[] = [];
  const saida = linhas.map((l) => {
    if (l.preco === null) {
      completo = false;
      return { ...l, valor: null };
    }
    const v = valorLinha(fonte, D(l.coeficiente), D(l.preco), l.percentual_perda !== null ? D(l.percentual_perda) : null);
    valores.push(v);
    return { ...l, valor: v.toString() };
  });
  return {
    composicaoId: pub.composicao_id, versao: pub.composicoes.versao, origem: pub.composicoes.origem, situacao: pub.situacao,
    linhas: saida, totalCalculado: completo ? totalComposicao(fonte, valores).toString() : null, regra: REGRA_FONTE[fonte] ?? "",
  };
}

/** Composições (publicadas na revisão) que usam este item como componente. */
export async function ondeEUsado(itemId: string, revisaoBaseId: string, db: Tx = prisma) {
  return db.$queryRawUnsafe<Array<{ id: string; codigo: string; descricao: string; unidade: string; coeficiente: string }>>(
    `SELECT i.id, i.codigo, i.descricao, i.unidade, ci.coeficiente::text coeficiente
       FROM composicao_itens ci
       JOIN composicoes_publicadas cp ON cp.composicao_id = ci.composicao_id AND cp.revisao_base_id = $2::uuid
       JOIN itens_referencia i ON i.id = cp.item_id
      WHERE ci.item_id = $1::uuid
      ORDER BY i.codigo LIMIT 100`,
    itemId, revisaoBaseId,
  );
}

/** Preço de um item numa revisão/regime (para orçamentos). */
export async function precoDoItem(itemId: string, revisaoBaseId: string, regime: string, db: Tx = prisma) {
  return db.precos_referencia.findUnique({
    where: { item_id_revisao_base_id_regime_codigo: { item_id: itemId, revisao_base_id: revisaoBaseId, regime_codigo: regime } },
    include: { descricoes_item: true, revisoes_base: { include: { bases_referencia: { include: { fontes: true } } } }, itens_referencia: true },
  });
}

export { Decimal };

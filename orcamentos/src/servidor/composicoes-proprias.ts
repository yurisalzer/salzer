import { createHash } from "node:crypto";
import { prisma, type Tx } from "./db";
import { auditar } from "./auditoria";
import { D, Decimal, ZERO, truncar } from "@/dominio/decimal";
import { encontrarCiclo } from "@/dominio/ciclos";
import { ErroDeNegocio } from "@/importacao/servico";

/**
 * Composições próprias: item da fonte PROPRIA + versões imutáveis em `composicoes` (origem PROPRIA).
 * Regra de custo (mesma do SINAPI): Σ TRUNC(coeficiente × custo unitário; 2).
 * Componentes oficiais apontam para a revisão/regime de onde vem o preço.
 */
export interface ComponenteProprio {
  itemId?: string | null;
  revisaoBaseId?: string | null;
  regime?: string | null;
  coeficiente: string;
  custoInformado?: string | null;
  descricaoInformada?: string | null;
  unidadeInformada?: string | null;
}

export interface DadosComposicaoPropria {
  itemId?: string | null;
  codigo: string;
  descricao: string;
  unidade: string;
  observacao?: string | null;
  componentes: ComponenteProprio[];
}

async function fontePropria(db: Tx) {
  return db.fontes.findUniqueOrThrow({ where: { sigla: "PROPRIA" } });
}

/** Mapa item → itens próprios usados pela versão mais recente de cada composição própria. */
async function grafoProprias(db: Tx): Promise<Map<string, string[]>> {
  const linhas = await db.$queryRawUnsafe<Array<{ pai: string; filho: string | null }>>(
    `SELECT c.item_id pai, ci.item_id filho
       FROM composicoes c
       JOIN (SELECT item_id, max(versao) v FROM composicoes WHERE origem = 'PROPRIA' GROUP BY item_id) u ON u.item_id = c.item_id AND u.v = c.versao
       LEFT JOIN composicao_itens ci ON ci.composicao_id = c.id
      WHERE c.origem = 'PROPRIA'`,
  );
  const g = new Map<string, string[]>();
  for (const l of linhas) {
    const lista = g.get(l.pai) ?? [];
    if (l.filho) lista.push(l.filho);
    g.set(l.pai, lista);
  }
  return g;
}

export async function salvarComposicaoPropria(dados: DadosComposicaoPropria, usuarioId: string | null): Promise<{ itemId: string; composicaoId: string; novaVersao: boolean }> {
  const codigo = dados.codigo.trim();
  const descricao = dados.descricao.trim();
  const unidade = dados.unidade.trim();
  if (!codigo || !descricao || !unidade) throw new ErroDeNegocio("Informe código, descrição e unidade.");
  if (codigo.length > 30) throw new ErroDeNegocio("Código muito longo (máx. 30 caracteres).");
  if (dados.componentes.length === 0) throw new ErroDeNegocio("Inclua ao menos um componente.");

  return prisma.$transaction(async (tx) => {
    const fonte = await fontePropria(tx);
    const normalizados = [];
    for (const [i, c] of dados.componentes.entries()) {
      const coef = D(c.coeficiente);
      if (!coef.isFinite() || coef.lte(0)) throw new ErroDeNegocio(`Componente ${i + 1}: coeficiente deve ser maior que zero.`);
      if (c.itemId) {
        const item = await tx.itens_referencia.findUnique({ where: { id: c.itemId }, include: { fontes: true } });
        if (!item) throw new ErroDeNegocio(`Componente ${i + 1}: item inexistente.`);
        if (item.fontes.sigla === "PROPRIA") {
          if (item.tipo !== "COMPOSICAO" && c.custoInformado == null) throw new ErroDeNegocio(`Componente ${i + 1}: item próprio sem custo.`);
          normalizados.push({ tipo_item: item.tipo, item_id: item.id, codigo_original: item.codigo, coeficiente: coef.toString(), revisao_base_id: null, regime_codigo: null, custo_unitario_informado: null, descricao_informada: null, unidade_informada: null });
        } else {
          if (!c.revisaoBaseId || !c.regime) throw new ErroDeNegocio(`Componente ${i + 1} (${item.codigo}): informe a base e o regime do preço.`);
          const p = await tx.precos_referencia.findUnique({
            where: { item_id_revisao_base_id_regime_codigo: { item_id: item.id, revisao_base_id: c.revisaoBaseId, regime_codigo: c.regime } },
            include: { revisoes_base: true },
          });
          if (!p) throw new ErroDeNegocio(`Componente ${i + 1} (${item.codigo}): item não existe na base/regime escolhidos.`);
          if (!["PUBLICADA", "SUBSTITUIDA"].includes(p.revisoes_base.status)) throw new ErroDeNegocio(`Componente ${i + 1}: base não publicada.`);
          if (p.situacao !== "INFORMADO") throw new ErroDeNegocio(`Componente ${i + 1} (${item.codigo}): a fonte não publicou preço para este item nessa base (${p.situacao}).`);
          normalizados.push({ tipo_item: item.tipo, item_id: item.id, codigo_original: item.codigo, coeficiente: coef.toString(), revisao_base_id: c.revisaoBaseId, regime_codigo: c.regime, custo_unitario_informado: null, descricao_informada: null, unidade_informada: null });
        }
      } else {
        if (c.custoInformado == null || !c.descricaoInformada?.trim() || !c.unidadeInformada?.trim()) {
          throw new ErroDeNegocio(`Componente ${i + 1}: insumo próprio exige descrição, unidade e custo.`);
        }
        const custo = D(c.custoInformado);
        if (custo.isNegative()) throw new ErroDeNegocio(`Componente ${i + 1}: custo negativo.`);
        normalizados.push({ tipo_item: "INSUMO", item_id: null, codigo_original: "INFORMADO", coeficiente: coef.toString(), revisao_base_id: null, regime_codigo: null, custo_unitario_informado: custo.toString(), descricao_informada: c.descricaoInformada.trim(), unidade_informada: c.unidadeInformada.trim() });
      }
    }

    // Item da composição própria
    let item;
    if (dados.itemId) {
      item = await tx.itens_referencia.findUniqueOrThrow({ where: { id: dados.itemId } });
      if (item.fonte_id !== fonte.id) throw new ErroDeNegocio("Composições oficiais não podem ser alteradas. Use \"Copiar como própria\".");
      item = await tx.itens_referencia.update({ where: { id: item.id }, data: { codigo, descricao, unidade, atualizado_em: new Date() } });
    } else {
      const existe = await tx.itens_referencia.findUnique({ where: { fonte_id_tipo_codigo: { fonte_id: fonte.id, tipo: "COMPOSICAO", codigo } } });
      if (existe) throw new ErroDeNegocio(`Já existe composição própria com o código ${codigo}.`);
      item = await tx.itens_referencia.create({ data: { fonte_id: fonte.id, tipo: "COMPOSICAO", codigo, descricao, unidade, classe: "COMPOSICAO_PROPRIA", criado_por: usuarioId } });
    }

    // Referência circular (A usa B que usa A)
    const grafo = await grafoProprias(tx);
    grafo.set(item.id, normalizados.map((n) => n.item_id).filter((x): x is string => !!x));
    const ciclo = encontrarCiclo(item.id, (n) => grafo.get(n) ?? []);
    if (ciclo) {
      const codigos = await tx.itens_referencia.findMany({ where: { id: { in: ciclo } }, select: { id: true, codigo: true } });
      const nome = new Map(codigos.map((c) => [c.id, c.codigo]));
      throw new ErroDeNegocio(`Referência circular: ${ciclo.map((x) => nome.get(x) ?? x).join(" → ")}`);
    }

    const hash = createHash("sha256").update(JSON.stringify({ descricao, unidade, normalizados })).digest("hex");
    const atual = await tx.composicoes.findFirst({ where: { item_id: item.id }, orderBy: { versao: "desc" } });
    if (atual?.hash_conteudo === hash) return { itemId: item.id, composicaoId: atual.id, novaVersao: false };
    const comp = await tx.composicoes.create({
      data: {
        item_id: item.id, origem: "PROPRIA", hash_conteudo: hash, versao: (atual?.versao ?? 0) + 1, observacao: dados.observacao?.trim() || null, criada_por: usuarioId,
        composicao_itens: { create: normalizados.map((n, i) => ({ ...n, ordem: i + 1 })) },
      },
    });
    await auditar({ usuarioId, acao: "COMPOSICAO_PROPRIA_SALVA", entidade: "composicoes", entidadeId: comp.id, dados: { codigo, versao: comp.versao } }, tx);
    return { itemId: item.id, composicaoId: comp.id, novaVersao: true };
  });
}

export interface LinhaCustoPropria {
  ordem: number;
  tipo_item: string;
  item_id: string | null;
  fonte: string;
  codigo: string;
  descricao: string;
  unidade: string;
  coeficiente: Decimal;
  custoUnitario: Decimal | null;
  valor: Decimal | null;
  revisao_base_id: string | null;
  regime_codigo: string | null;
  origemPreco: string;
}

export interface CustoPropria {
  composicaoId: string;
  versao: number;
  custo: Decimal | null;
  linhas: LinhaCustoPropria[];
}

/** Custo de uma versão de composição própria (recursivo para subcomposições próprias). */
export async function custoComposicaoPropria(composicaoId: string, db: Tx = prisma, visitados: Set<string> = new Set()): Promise<CustoPropria> {
  if (visitados.has(composicaoId)) throw new ErroDeNegocio("Referência circular detectada no cálculo.");
  visitados.add(composicaoId);
  const comp = await db.composicoes.findUniqueOrThrow({
    where: { id: composicaoId },
    include: { composicao_itens: { orderBy: { ordem: "asc" }, include: { itens_referencia: { include: { fontes: true } } } } },
  });
  const linhas: LinhaCustoPropria[] = [];
  let total: Decimal | null = ZERO;
  for (const ci of comp.composicao_itens) {
    let custo: Decimal | null = null;
    let origem = "";
    if (ci.custo_unitario_informado !== null) {
      custo = D(ci.custo_unitario_informado);
      origem = "Informado pelo orçamentista";
    } else if (ci.itens_referencia?.fontes.sigla === "PROPRIA") {
      const sub = await db.composicoes.findFirst({ where: { item_id: ci.item_id! }, orderBy: { versao: "desc" } });
      if (sub) {
        custo = (await custoComposicaoPropria(sub.id, db, new Set(visitados))).custo;
        origem = `Composição própria v${sub.versao}`;
      }
    } else if (ci.item_id && ci.revisao_base_id && ci.regime_codigo) {
      const p = await db.precos_referencia.findUnique({
        where: { item_id_revisao_base_id_regime_codigo: { item_id: ci.item_id, revisao_base_id: ci.revisao_base_id, regime_codigo: ci.regime_codigo } },
        include: { revisoes_base: { include: { bases_referencia: true } } },
      });
      custo = p?.preco != null ? D(p.preco) : null;
      origem = p ? `${ci.itens_referencia!.fontes.sigla} ${p.revisoes_base.bases_referencia.competencia.toISOString().slice(0, 7)} ${p.revisoes_base.rotulo}` : "sem preço";
    }
    const coef = D(ci.coeficiente);
    const valor = custo === null ? null : truncar(coef.times(custo), 2);
    if (valor === null) total = null;
    else if (total !== null) total = total.plus(valor);
    linhas.push({
      ordem: ci.ordem, tipo_item: ci.tipo_item, item_id: ci.item_id, fonte: ci.itens_referencia?.fontes.sigla ?? "PROPRIA",
      codigo: ci.itens_referencia?.codigo ?? "—", descricao: ci.descricao_informada ?? ci.itens_referencia?.descricao ?? "",
      unidade: ci.unidade_informada ?? ci.itens_referencia?.unidade ?? "", coeficiente: coef, custoUnitario: custo, valor,
      revisao_base_id: ci.revisao_base_id, regime_codigo: ci.regime_codigo, origemPreco: origem,
    });
  }
  return { composicaoId, versao: comp.versao, custo: total, linhas };
}

/**
 * Cria composição própria copiando os componentes de uma composição oficial (mesma base/regime).
 * O resultado é identificado como PRÓPRIA em todas as telas e relatórios.
 */
export async function copiarComoPropria(itemOficialId: string, revisaoBaseId: string, regime: string, codigo: string, usuarioId: string | null) {
  const pub = await prisma.composicoes_publicadas.findUnique({
    where: { revisao_base_id_item_id: { revisao_base_id: revisaoBaseId, item_id: itemOficialId } },
    include: { itens_referencia: true, composicoes: { include: { composicao_itens: { orderBy: { ordem: "asc" } } } } },
  });
  if (!pub) throw new ErroDeNegocio("A fonte não publicou composição analítica para este item nesta base.");
  const componentes: ComponenteProprio[] = [];
  for (const ci of pub.composicoes.composicao_itens) {
    // Perdas da EMOP são incorporadas ao coeficiente (q × (1 + %/100)), explicitamente.
    const coef = D(ci.coeficiente).times(D(ci.percentual_perda ?? 0).div(100).plus(1));
    componentes.push({ itemId: ci.item_id, revisaoBaseId, regime, coeficiente: coef.toString() });
  }
  return salvarComposicaoPropria(
    {
      codigo, descricao: pub.itens_referencia.descricao, unidade: pub.itens_referencia.unidade, componentes,
      observacao: `Copiada da composição oficial ${pub.itens_referencia.codigo} (revisão ${revisaoBaseId}, ${regime}).`,
    },
    usuarioId,
  );
}

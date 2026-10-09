import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { auditar } from "./auditoria";
import { custoComposicaoPropria } from "./composicoes-proprias";
import { explodirItemOrcamento } from "./explosao";
import { calcularBdi, NOMES_PARCELA, type CodigoParcela } from "@/dominio/bdi";
import { D, Decimal, arredondar, type ModoArredondamento } from "@/dominio/decimal";
import { calcularItem, numerarEtapas, totalizar } from "@/dominio/orcamento";
import { ErroDeNegocio } from "@/importacao/servico";

export class ErroConcorrencia extends ErroDeNegocio {
  constructor() {
    super("Este orçamento foi alterado por outra pessoa (ou em outra aba) desde que você o abriu. Recarregue a página e repita a operação.");
  }
}

type RevisaoOrc = Prisma.revisoes_orcamentoGetPayload<object>;

/**
 * Executa uma alteração numa revisão ABERTA com controle de concorrência otimista:
 * trava a linha (FOR UPDATE), confere a versão vista pelo usuário e incrementa a versão.
 */
export async function alterarRevisao<T>(
  revisaoId: string,
  versaoEsperada: number | null,
  usuarioId: string | null,
  acao: string,
  fn: (tx: Tx, rev: RevisaoOrc) => Promise<T>,
  dadosAuditoria: Prisma.InputJsonValue = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const travada = await tx.$queryRawUnsafe<Array<{ versao: number; status: string }>>(`SELECT versao, status FROM revisoes_orcamento WHERE id = $1::uuid FOR UPDATE`, revisaoId);
    if (!travada[0]) throw new ErroDeNegocio("Revisão de orçamento não encontrada.");
    if (travada[0].status !== "ABERTA") throw new ErroDeNegocio("Esta revisão está FECHADA e não pode ser alterada. Crie uma nova revisão.");
    if (versaoEsperada !== null && travada[0].versao !== versaoEsperada) throw new ErroConcorrencia();
    const rev = await tx.revisoes_orcamento.findUniqueOrThrow({ where: { id: revisaoId } });
    const r = await fn(tx, rev);
    await tx.revisoes_orcamento.update({ where: { id: revisaoId }, data: { versao: { increment: 1 }, atualizado_em: new Date() } });
    await auditar({ usuarioId, acao, entidade: "revisoes_orcamento", entidadeId: revisaoId, dados: dadosAuditoria }, tx);
    return r;
  }, { timeout: 120_000 });
}

// ---------------------------------------------------------------------------------------------
// Obras e orçamentos
// ---------------------------------------------------------------------------------------------

export interface DadosObra {
  nome: string;
  cliente?: string | null;
  municipio?: string | null;
  uf?: string;
  endereco?: string | null;
  descricao?: string | null;
}

export async function criarObra(d: DadosObra, usuarioId: string | null) {
  if (!d.nome.trim()) throw new ErroDeNegocio("Informe o nome da obra.");
  const o = await prisma.obras.create({
    data: { nome: d.nome.trim(), cliente: d.cliente?.trim() || null, municipio: d.municipio?.trim() || null, uf: d.uf ?? "RJ", endereco: d.endereco?.trim() || null, descricao: d.descricao?.trim() || null, criado_por: usuarioId },
  });
  await auditar({ usuarioId, acao: "OBRA_CRIADA", entidade: "obras", entidadeId: o.id, dados: { nome: o.nome } });
  return o;
}

export interface BasePadrao {
  fonteSigla: "EMOP" | "SINAPI";
  revisaoBaseId: string;
  regime: string;
}

export interface DadosOrcamento {
  obraId: string;
  codigo?: string | null;
  nome: string;
  descricao?: string | null;
  bases: BasePadrao[];
  bdi: EntradaBdi;
  modoArredondamento?: ModoArredondamento;
  prazoMeses?: number | null;
}

export type EntradaBdi = { perfilId: string } | { nome: string; percentual: string };

async function conferirBase(tx: Tx, b: BasePadrao): Promise<string> {
  const rev = await tx.revisoes_base.findUnique({ where: { id: b.revisaoBaseId }, include: { bases_referencia: { include: { fontes: true } } } });
  if (!rev || rev.bases_referencia.fontes.sigla !== b.fonteSigla) throw new ErroDeNegocio(`Base ${b.fonteSigla} inválida.`);
  if (rev.status !== "PUBLICADA") throw new ErroDeNegocio(`A base ${b.fonteSigla} escolhida não está publicada.`);
  if (!rev.regimes.includes(b.regime)) throw new ErroDeNegocio(`A base ${b.fonteSigla} não tem o regime ${b.regime}.`);
  return rev.bases_referencia.fonte_id;
}

/** Copia um perfil de BDI (ou percentual informado) para a revisão — o valor fica congelado. */
async function criarBdiAplicado(tx: Tx, revisaoId: string, e: EntradaBdi) {
  if ("perfilId" in e) {
    const perfil = await tx.perfis_bdi.findUniqueOrThrow({ where: { id: e.perfilId }, include: { parcelas_bdi: { orderBy: { ordem: "asc" } } } });
    const parcelas = perfil.parcelas_bdi.map((p) => ({ codigo: p.codigo as CodigoParcela, nome: p.nome, percentual: p.percentual.toString() }));
    const calc = parcelas.length ? calcularBdi(parcelas) : null;
    const adotado = perfil.percentual_adotado ?? calc?.percentual2casas ?? null;
    if (adotado === null) throw new ErroDeNegocio("O perfil de BDI não tem parcelas nem percentual adotado.");
    return tx.bdi_aplicados.create({
      data: {
        revisao_id: revisaoId, perfil_origem_id: perfil.id, nome: perfil.nome, parcelas,
        percentual_calculado: calc ? calc.percentual.toDecimalPlaces(6).toString() : null, percentual_adotado: D(adotado).toString(),
      },
    });
  }
  const pct = D(e.percentual);
  if (pct.isNegative() || pct.gte(100)) throw new ErroDeNegocio("BDI deve estar entre 0% e 100%.");
  return tx.bdi_aplicados.create({ data: { revisao_id: revisaoId, nome: e.nome.trim() || `BDI ${pct.toString()}%`, parcelas: [], percentual_adotado: pct.toString() } });
}

export async function criarOrcamento(d: DadosOrcamento, usuarioId: string | null) {
  if (!d.nome.trim()) throw new ErroDeNegocio("Informe o nome do orçamento.");
  if (d.bases.length === 0) throw new ErroDeNegocio("Escolha ao menos uma base de referência (EMOP ou SINAPI).");
  return prisma.$transaction(async (tx) => {
    const orc = await tx.orcamentos.create({ data: { obra_id: d.obraId, codigo: d.codigo?.trim() || null, nome: d.nome.trim(), descricao: d.descricao?.trim() || null, criado_por: usuarioId } });
    const rev = await tx.revisoes_orcamento.create({
      data: { orcamento_id: orc.id, numero: 1, descricao: "Revisão inicial", modo_arredondamento: d.modoArredondamento ?? "TRUNCAR", prazo_meses: d.prazoMeses ?? null, criado_por: usuarioId },
    });
    for (const b of d.bases) {
      const fonteId = await conferirBase(tx, b);
      await tx.revisoes_orcamento_bases.create({ data: { revisao_id: rev.id, fonte_id: fonteId, revisao_base_id: b.revisaoBaseId, regime_codigo: b.regime } });
    }
    const bdi = await criarBdiAplicado(tx, rev.id, d.bdi);
    await tx.revisoes_orcamento.update({ where: { id: rev.id }, data: { bdi_padrao_id: bdi.id } });
    await auditar({ usuarioId, acao: "ORCAMENTO_CRIADO", entidade: "orcamentos", entidadeId: orc.id, dados: { nome: orc.nome } }, tx);
    return { orcamentoId: orc.id, revisaoId: rev.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------------------------

export async function adicionarEtapa(revisaoId: string, versao: number | null, titulo: string, paiId: string | null, usuarioId: string | null) {
  if (!titulo.trim()) throw new ErroDeNegocio("Informe o título da etapa.");
  return alterarRevisao(revisaoId, versao, usuarioId, "ETAPA_ADICIONADA", async (tx) => {
    if (paiId) {
      const pai = await tx.etapas.findUnique({ where: { id: paiId } });
      if (!pai || pai.revisao_id !== revisaoId) throw new ErroDeNegocio("Etapa-mãe inválida.");
    }
    const max = await tx.etapas.aggregate({ where: { revisao_id: revisaoId, pai_id: paiId }, _max: { ordem: true } });
    return tx.etapas.create({ data: { revisao_id: revisaoId, pai_id: paiId, titulo: titulo.trim(), ordem: (max._max.ordem ?? 0) + 1 } });
  }, { titulo });
}

export async function renomearEtapa(revisaoId: string, versao: number | null, etapaId: string, titulo: string, usuarioId: string | null) {
  if (!titulo.trim()) throw new ErroDeNegocio("Informe o título da etapa.");
  return alterarRevisao(revisaoId, versao, usuarioId, "ETAPA_RENOMEADA", async (tx) => {
    const e = await tx.etapas.findUnique({ where: { id: etapaId } });
    if (!e || e.revisao_id !== revisaoId) throw new ErroDeNegocio("Etapa inválida.");
    await tx.etapas.update({ where: { id: etapaId }, data: { titulo: titulo.trim() } });
  }, { etapaId, titulo });
}

export async function excluirEtapa(revisaoId: string, versao: number | null, etapaId: string, usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "ETAPA_EXCLUIDA", async (tx) => {
    const e = await tx.etapas.findUnique({ where: { id: etapaId } });
    if (!e || e.revisao_id !== revisaoId) throw new ErroDeNegocio("Etapa inválida.");
    await tx.etapas.delete({ where: { id: etapaId } }); // subetapas, itens e cronograma em cascata
    await renumerar(tx, "etapas", revisaoId, e.pai_id);
  }, { etapaId });
}

async function renumerar(tx: Tx, tabela: "etapas" | "itens", revisaoId: string, grupoId: string | null) {
  if (tabela === "etapas") {
    const lista = await tx.etapas.findMany({ where: { revisao_id: revisaoId, pai_id: grupoId }, orderBy: { ordem: "asc" } });
    for (const [i, e] of lista.entries()) if (e.ordem !== i + 1) await tx.etapas.update({ where: { id: e.id }, data: { ordem: i + 1 } });
  } else {
    const lista = await tx.itens_orcamento.findMany({ where: { revisao_id: revisaoId, etapa_id: grupoId! }, orderBy: { ordem: "asc" } });
    for (const [i, e] of lista.entries()) if (e.ordem !== i + 1) await tx.itens_orcamento.update({ where: { id: e.id }, data: { ordem: i + 1 } });
  }
}

export async function moverEtapa(revisaoId: string, versao: number | null, etapaId: string, direcao: "acima" | "abaixo", usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "ETAPA_MOVIDA", async (tx) => {
    const e = await tx.etapas.findUniqueOrThrow({ where: { id: etapaId } });
    const vizinha = await tx.etapas.findFirst({
      where: { revisao_id: revisaoId, pai_id: e.pai_id, ordem: direcao === "acima" ? { lt: e.ordem } : { gt: e.ordem } },
      orderBy: { ordem: direcao === "acima" ? "desc" : "asc" },
    });
    if (!vizinha) return;
    await tx.etapas.update({ where: { id: e.id }, data: { ordem: vizinha.ordem } });
    await tx.etapas.update({ where: { id: vizinha.id }, data: { ordem: e.ordem } });
  }, { etapaId, direcao });
}

// ---------------------------------------------------------------------------------------------
// Itens
// ---------------------------------------------------------------------------------------------

async function percentualBdiDoItem(tx: Tx, rev: RevisaoOrc, bdiAplicadoId: string | null): Promise<Decimal> {
  const id = bdiAplicadoId ?? rev.bdi_padrao_id;
  if (!id) return new Decimal(0);
  const b = await tx.bdi_aplicados.findUnique({ where: { id } });
  if (!b || b.revisao_id !== rev.id) throw new ErroDeNegocio("BDI inválido para esta revisão.");
  return D(b.percentual_adotado);
}

function valoresCalculados(custo: Decimal | null, quantidade: Decimal, bdi: Decimal, modo: ModoArredondamento) {
  const r = calcularItem({ custoUnitario: custo, quantidade, bdiPercentual: bdi, modo });
  return { bdi_percentual: bdi.toString(), preco_unitario: r.precoUnitario?.toString() ?? null, total: r.total?.toString() ?? null };
}

async function proximaOrdem(tx: Tx, etapaId: string) {
  const max = await tx.itens_orcamento.aggregate({ where: { etapa_id: etapaId }, _max: { ordem: true } });
  return (max._max.ordem ?? 0) + 1;
}

async function conferirEtapa(tx: Tx, revisaoId: string, etapaId: string) {
  const e = await tx.etapas.findUnique({ where: { id: etapaId } });
  if (!e || e.revisao_id !== revisaoId) throw new ErroDeNegocio("Etapa inválida.");
}

function quantidadeValida(q: string): Decimal {
  const d = D(q);
  if (!d.isFinite() || d.isNegative()) throw new ErroDeNegocio("Quantidade inválida.");
  if (d.decimalPlaces() > 6) throw new ErroDeNegocio("Quantidade com mais de 6 casas decimais.");
  return d;
}

export interface NovoItemReferencia {
  etapaId: string;
  itemReferenciaId: string;
  /** Opcional: base/regime específicos do item; padrão = base da revisão para a fonte */
  revisaoBaseId?: string | null;
  regime?: string | null;
  quantidade: string;
  bdiAplicadoId?: string | null;
}

/** Adiciona serviço/insumo EMOP ou SINAPI, gravando o instantâneo do preço da base usada. */
export async function adicionarItemReferencia(revisaoId: string, versao: number | null, n: NovoItemReferencia, usuarioId: string | null) {
  const qtd = quantidadeValida(n.quantidade);
  return alterarRevisao(revisaoId, versao, usuarioId, "ITEM_ADICIONADO", async (tx, rev) => {
    await conferirEtapa(tx, revisaoId, n.etapaId);
    const item = await tx.itens_referencia.findUniqueOrThrow({ where: { id: n.itemReferenciaId }, include: { fontes: true } });
    if (item.fontes.sigla === "PROPRIA") throw new ErroDeNegocio("Use 'composição própria' para itens próprios.");
    let revisaoBaseId = n.revisaoBaseId ?? null;
    let regime = n.regime ?? null;
    if (!revisaoBaseId || !regime) {
      const padrao = await tx.revisoes_orcamento_bases.findUnique({ where: { revisao_id_fonte_id: { revisao_id: revisaoId, fonte_id: item.fonte_id } } });
      if (!padrao) throw new ErroDeNegocio(`O orçamento não tem base ${item.fontes.sigla} definida. Informe a base no item.`);
      revisaoBaseId ??= padrao.revisao_base_id;
      regime ??= padrao.regime_codigo;
    }
    const p = await tx.precos_referencia.findUnique({
      where: { item_id_revisao_base_id_regime_codigo: { item_id: item.id, revisao_base_id: revisaoBaseId, regime_codigo: regime } },
      include: { descricoes_item: true, revisoes_base: { include: { bases_referencia: true } } },
    });
    if (!p) throw new ErroDeNegocio(`${item.codigo} não consta da base/regime escolhidos (ex.: código com desoneração em orçamento sem desoneração).`);
    if (p.revisoes_base.status !== "PUBLICADA") throw new ErroDeNegocio("Novos itens só podem usar bases publicadas (vigentes).");
    const custo = p.preco !== null ? D(p.preco) : null;
    const bdi = await percentualBdiDoItem(tx, rev, n.bdiAplicadoId ?? null);
    const pub = await tx.composicoes_publicadas.findUnique({ where: { revisao_base_id_item_id: { revisao_base_id: revisaoBaseId, item_id: item.id } } });
    return tx.itens_orcamento.create({
      data: {
        revisao_id: revisaoId, etapa_id: n.etapaId, ordem: await proximaOrdem(tx, n.etapaId), tipo: "REFERENCIA",
        item_referencia_id: item.id, revisao_base_id: revisaoBaseId, regime_codigo: regime, composicao_id: pub?.composicao_id ?? null,
        fonte_sigla: item.fontes.sigla, competencia: p.revisoes_base.bases_referencia.competencia, rotulo_revisao_base: p.revisoes_base.rotulo,
        codigo: item.codigo, descricao: p.descricoes_item.descricao, unidade: p.descricoes_item.unidade,
        custo_unitario: custo?.toString() ?? null, situacao_preco: p.situacao, quantidade: qtd.toString(), bdi_aplicado_id: n.bdiAplicadoId ?? null,
        ...valoresCalculados(custo, qtd, bdi, rev.modo_arredondamento as ModoArredondamento),
      },
    });
  }, { item: n.itemReferenciaId, quantidade: n.quantidade });
}

export interface NovoItemProprio {
  etapaId: string;
  /** Composição própria (item PROPRIA) — custo calculado da versão vigente */
  composicaoItemId?: string | null;
  /** Ou serviço próprio avulso, com custo informado */
  codigo?: string | null;
  descricao?: string | null;
  unidade?: string | null;
  custoUnitario?: string | null;
  quantidade: string;
  bdiAplicadoId?: string | null;
  observacao?: string | null;
}

export async function adicionarItemProprio(revisaoId: string, versao: number | null, n: NovoItemProprio, usuarioId: string | null) {
  const qtd = quantidadeValida(n.quantidade);
  return alterarRevisao(revisaoId, versao, usuarioId, "ITEM_PROPRIO_ADICIONADO", async (tx, rev) => {
    await conferirEtapa(tx, revisaoId, n.etapaId);
    const bdi = await percentualBdiDoItem(tx, rev, n.bdiAplicadoId ?? null);
    let dados: { codigo: string; descricao: string; unidade: string; custo: Decimal | null; composicao_id: string | null; item_referencia_id: string | null; observacao: string | null };
    if (n.composicaoItemId) {
      const item = await tx.itens_referencia.findUniqueOrThrow({ where: { id: n.composicaoItemId }, include: { fontes: true } });
      if (item.fontes.sigla !== "PROPRIA") throw new ErroDeNegocio("Item não é composição própria.");
      const comp = await tx.composicoes.findFirst({ where: { item_id: item.id }, orderBy: { versao: "desc" } });
      if (!comp) throw new ErroDeNegocio("Composição própria sem versão.");
      const c = await custoComposicaoPropria(comp.id, tx);
      dados = { codigo: item.codigo, descricao: item.descricao, unidade: item.unidade, custo: c.custo, composicao_id: comp.id, item_referencia_id: item.id, observacao: `Composição própria v${comp.versao}` };
    } else {
      if (!n.descricao?.trim() || !n.unidade?.trim() || n.custoUnitario == null) throw new ErroDeNegocio("Serviço próprio exige descrição, unidade e custo unitário.");
      const custo = D(n.custoUnitario);
      if (custo.isNegative() || custo.decimalPlaces() > 6) throw new ErroDeNegocio("Custo unitário inválido.");
      dados = { codigo: n.codigo?.trim() || "PRÓPRIO", descricao: n.descricao.trim(), unidade: n.unidade.trim(), custo, composicao_id: null, item_referencia_id: null, observacao: n.observacao?.trim() || null };
    }
    return tx.itens_orcamento.create({
      data: {
        revisao_id: revisaoId, etapa_id: n.etapaId, ordem: await proximaOrdem(tx, n.etapaId), tipo: "PROPRIO",
        item_referencia_id: dados.item_referencia_id, composicao_id: dados.composicao_id, fonte_sigla: "PROPRIA",
        codigo: dados.codigo, descricao: dados.descricao, unidade: dados.unidade, custo_unitario: dados.custo?.toString() ?? null,
        situacao_preco: dados.custo === null ? "SEM_PRECO" : "INFORMADO", quantidade: qtd.toString(), bdi_aplicado_id: n.bdiAplicadoId ?? null,
        observacao: dados.observacao, ...valoresCalculados(dados.custo, qtd, bdi, rev.modo_arredondamento as ModoArredondamento),
      },
    });
  }, { proprio: n.composicaoItemId ?? n.descricao ?? null });
}

export interface AlteracaoItem {
  quantidade?: string;
  /** undefined = não altera; null = usar BDI padrão (global) */
  bdiAplicadoId?: string | null;
  observacao?: string | null;
  /** Somente serviço próprio avulso */
  custoUnitario?: string;
}

export async function alterarItem(revisaoId: string, versao: number | null, itemId: string, a: AlteracaoItem, usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "ITEM_ALTERADO", async (tx, rev) => {
    const it = await tx.itens_orcamento.findUnique({ where: { id: itemId } });
    if (!it || it.revisao_id !== revisaoId) throw new ErroDeNegocio("Item inválido.");
    const qtd = a.quantidade !== undefined ? quantidadeValida(a.quantidade) : D(it.quantidade);
    const bdiId = a.bdiAplicadoId !== undefined ? a.bdiAplicadoId : it.bdi_aplicado_id;
    let custo = it.custo_unitario !== null ? D(it.custo_unitario) : null;
    if (a.custoUnitario !== undefined) {
      if (it.tipo !== "PROPRIO" || it.composicao_id) throw new ErroDeNegocio("O custo de itens EMOP/SINAPI vem da base de referência e não pode ser editado.");
      custo = D(a.custoUnitario);
      if (custo.isNegative()) throw new ErroDeNegocio("Custo negativo.");
    }
    const bdi = await percentualBdiDoItem(tx, rev, bdiId);
    return tx.itens_orcamento.update({
      where: { id: itemId },
      data: {
        quantidade: qtd.toString(), bdi_aplicado_id: bdiId, custo_unitario: custo?.toString() ?? null,
        situacao_preco: custo === null ? it.situacao_preco : it.tipo === "PROPRIO" ? "INFORMADO" : it.situacao_preco,
        observacao: a.observacao !== undefined ? a.observacao : it.observacao, atualizado_em: new Date(),
        ...valoresCalculados(custo, qtd, bdi, rev.modo_arredondamento as ModoArredondamento),
      },
    });
  }, { itemId, ...a } as Prisma.InputJsonValue);
}

export async function excluirItem(revisaoId: string, versao: number | null, itemId: string, usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "ITEM_EXCLUIDO", async (tx) => {
    const it = await tx.itens_orcamento.findUnique({ where: { id: itemId } });
    if (!it || it.revisao_id !== revisaoId) throw new ErroDeNegocio("Item inválido.");
    await tx.itens_orcamento.delete({ where: { id: itemId } });
    await renumerar(tx, "itens", revisaoId, it.etapa_id);
  }, { itemId });
}

export async function moverItem(revisaoId: string, versao: number | null, itemId: string, direcao: "acima" | "abaixo", usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "ITEM_MOVIDO", async (tx) => {
    const it = await tx.itens_orcamento.findUniqueOrThrow({ where: { id: itemId } });
    const viz = await tx.itens_orcamento.findFirst({
      where: { etapa_id: it.etapa_id, ordem: direcao === "acima" ? { lt: it.ordem } : { gt: it.ordem } },
      orderBy: { ordem: direcao === "acima" ? "desc" : "asc" },
    });
    if (!viz) return;
    await tx.itens_orcamento.update({ where: { id: it.id }, data: { ordem: viz.ordem } });
    await tx.itens_orcamento.update({ where: { id: viz.id }, data: { ordem: it.ordem } });
  }, { itemId, direcao });
}

// ---------------------------------------------------------------------------------------------
// BDI e parâmetros da revisão
// ---------------------------------------------------------------------------------------------

/** Recalcula preço unitário e total de todos os itens (após trocar BDI ou arredondamento). */
async function recalcularItens(tx: Tx, rev: RevisaoOrc) {
  const bdis = new Map((await tx.bdi_aplicados.findMany({ where: { revisao_id: rev.id } })).map((b) => [b.id, D(b.percentual_adotado)]));
  const padrao = rev.bdi_padrao_id ? bdis.get(rev.bdi_padrao_id) ?? new Decimal(0) : new Decimal(0);
  const itens = await tx.itens_orcamento.findMany({ where: { revisao_id: rev.id } });
  for (const it of itens) {
    const bdi = it.bdi_aplicado_id ? bdis.get(it.bdi_aplicado_id)! : padrao;
    const v = valoresCalculados(it.custo_unitario !== null ? D(it.custo_unitario) : null, D(it.quantidade), bdi, rev.modo_arredondamento as ModoArredondamento);
    if (v.bdi_percentual !== it.bdi_percentual.toString() || v.preco_unitario !== (it.preco_unitario?.toString() ?? null) || v.total !== (it.total?.toString() ?? null)) {
      await tx.itens_orcamento.update({ where: { id: it.id }, data: v });
    }
  }
}

/** Define o BDI global (padrão) da revisão a partir de um perfil ou percentual. */
export async function definirBdiPadrao(revisaoId: string, versao: number | null, e: EntradaBdi, usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "BDI_PADRAO_DEFINIDO", async (tx, rev) => {
    const b = await criarBdiAplicado(tx, revisaoId, e);
    const atualizada = await tx.revisoes_orcamento.update({ where: { id: revisaoId }, data: { bdi_padrao_id: b.id } });
    await recalcularItens(tx, atualizada);
    void rev;
    return b;
  }, e as Prisma.InputJsonValue);
}

/** Cria um BDI adicional (para aplicar individualmente a itens, ex.: fornecimento de equipamentos). */
export async function adicionarBdiDiferenciado(revisaoId: string, versao: number | null, e: EntradaBdi, usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "BDI_DIFERENCIADO_CRIADO", (tx) => criarBdiAplicado(tx, revisaoId, e), e as Prisma.InputJsonValue);
}

export async function definirParametros(revisaoId: string, versao: number | null, p: { modo?: ModoArredondamento; prazoMeses?: number | null; descricao?: string | null }, usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "PARAMETROS_ALTERADOS", async (tx) => {
    if (p.prazoMeses !== undefined && p.prazoMeses !== null && (p.prazoMeses < 1 || p.prazoMeses > 120)) throw new ErroDeNegocio("Prazo deve estar entre 1 e 120 meses.");
    const r = await tx.revisoes_orcamento.update({
      where: { id: revisaoId },
      data: { ...(p.modo ? { modo_arredondamento: p.modo } : {}), ...(p.prazoMeses !== undefined ? { prazo_meses: p.prazoMeses } : {}), ...(p.descricao !== undefined ? { descricao: p.descricao } : {}) },
    });
    if (p.modo) await recalcularItens(tx, r);
  }, p as Prisma.InputJsonValue);
}

// ---------------------------------------------------------------------------------------------
// Cronograma físico-financeiro
// ---------------------------------------------------------------------------------------------

/** Distribuição mensal (%) de uma etapa de 1º nível. A soma deve ser ≤ 100% (= 100% para fechar). */
export async function definirCronogramaEtapa(revisaoId: string, versao: number | null, etapaId: string, percentuais: string[], usuarioId: string | null) {
  return alterarRevisao(revisaoId, versao, usuarioId, "CRONOGRAMA_ALTERADO", async (tx, rev) => {
    const e = await tx.etapas.findUnique({ where: { id: etapaId } });
    if (!e || e.revisao_id !== revisaoId || e.pai_id !== null) throw new ErroDeNegocio("O cronograma é definido por etapa de 1º nível.");
    if (!rev.prazo_meses) throw new ErroDeNegocio("Defina antes o prazo da obra em meses.");
    if (percentuais.length > rev.prazo_meses) throw new ErroDeNegocio("Mais meses que o prazo da obra.");
    const valores = percentuais.map((x) => (x.trim() === "" ? new Decimal(0) : D(x)));
    if (valores.some((v) => v.isNegative())) throw new ErroDeNegocio("Percentual negativo.");
    const soma = valores.reduce((s, v) => s.plus(v), new Decimal(0));
    if (soma.gt(100)) throw new ErroDeNegocio(`A soma dos percentuais (${soma.toString()}%) passa de 100%.`);
    await tx.cronograma.deleteMany({ where: { etapa_id: etapaId } });
    const dados = valores.map((v, i) => ({ revisao_id: revisaoId, etapa_id: etapaId, mes: i + 1, percentual: v.toString() })).filter((x) => !D(x.percentual).isZero());
    if (dados.length) await tx.cronograma.createMany({ data: dados });
  }, { etapaId, percentuais });
}

// ---------------------------------------------------------------------------------------------
// Revisões: nova revisão, duplicação, atualização de competência e fechamento
// ---------------------------------------------------------------------------------------------

/** Copia uma revisão (aberta ou fechada) para outra revisão nova, preservando a original. */
async function copiarRevisao(tx: Tx, origemId: string, destino: { orcamentoId: string; numero: number; descricao: string; usuarioId: string | null }) {
  const o = await tx.revisoes_orcamento.findUniqueOrThrow({ where: { id: origemId } });
  const nova = await tx.revisoes_orcamento.create({
    data: {
      orcamento_id: destino.orcamentoId, numero: destino.numero, descricao: destino.descricao, modo_arredondamento: o.modo_arredondamento,
      prazo_meses: o.prazo_meses, revisao_origem_id: o.id, criado_por: destino.usuarioId,
    },
  });
  const bases = await tx.revisoes_orcamento_bases.findMany({ where: { revisao_id: origemId } });
  for (const b of bases) await tx.revisoes_orcamento_bases.create({ data: { revisao_id: nova.id, fonte_id: b.fonte_id, revisao_base_id: b.revisao_base_id, regime_codigo: b.regime_codigo } });
  const mapaBdi = new Map<string, string>();
  for (const b of await tx.bdi_aplicados.findMany({ where: { revisao_id: origemId } })) {
    const c = await tx.bdi_aplicados.create({ data: { revisao_id: nova.id, perfil_origem_id: b.perfil_origem_id, nome: b.nome, parcelas: b.parcelas as Prisma.InputJsonValue, percentual_calculado: b.percentual_calculado, percentual_adotado: b.percentual_adotado } });
    mapaBdi.set(b.id, c.id);
  }
  if (o.bdi_padrao_id) await tx.revisoes_orcamento.update({ where: { id: nova.id }, data: { bdi_padrao_id: mapaBdi.get(o.bdi_padrao_id) } });
  const etapas = await tx.etapas.findMany({ where: { revisao_id: origemId } });
  const mapaEtapa = new Map<string, string>();
  const pendentes = [...etapas];
  while (pendentes.length) {
    const i = pendentes.findIndex((e) => e.pai_id === null || mapaEtapa.has(e.pai_id));
    const e = pendentes.splice(i, 1)[0]!;
    const c = await tx.etapas.create({ data: { revisao_id: nova.id, pai_id: e.pai_id ? mapaEtapa.get(e.pai_id) : null, ordem: e.ordem, titulo: e.titulo } });
    mapaEtapa.set(e.id, c.id);
  }
  const itens = await tx.itens_orcamento.findMany({ where: { revisao_id: origemId } });
  if (itens.length) {
    await tx.itens_orcamento.createMany({
      data: itens.map(({ id: _id, revisao_id: _r, etapa_id, bdi_aplicado_id, criado_em: _c, atualizado_em: _a, ...resto }) => ({
        ...resto, revisao_id: nova.id, etapa_id: mapaEtapa.get(etapa_id)!, bdi_aplicado_id: bdi_aplicado_id ? mapaBdi.get(bdi_aplicado_id)! : null,
      })),
    });
  }
  const crono = await tx.cronograma.findMany({ where: { revisao_id: origemId } });
  if (crono.length) await tx.cronograma.createMany({ data: crono.map((c) => ({ revisao_id: nova.id, etapa_id: mapaEtapa.get(c.etapa_id)!, mes: c.mes, percentual: c.percentual })) });
  return nova;
}

export async function novaRevisao(origemId: string, descricao: string, usuarioId: string | null) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.revisoes_orcamento.findUniqueOrThrow({ where: { id: origemId } });
    const max = await tx.revisoes_orcamento.aggregate({ where: { orcamento_id: o.orcamento_id }, _max: { numero: true } });
    const nova = await copiarRevisao(tx, origemId, { orcamentoId: o.orcamento_id, numero: (max._max.numero ?? 0) + 1, descricao: descricao.trim() || `Revisão a partir da nº ${o.numero}`, usuarioId });
    await auditar({ usuarioId, acao: "REVISAO_CRIADA", entidade: "revisoes_orcamento", entidadeId: nova.id, dados: { origem: origemId } }, tx);
    return nova;
  }, { timeout: 120_000 });
}

export async function duplicarOrcamento(revisaoOrigemId: string, nome: string, usuarioId: string | null) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.revisoes_orcamento.findUniqueOrThrow({ where: { id: revisaoOrigemId }, include: { orcamentos: true } });
    const orc = await tx.orcamentos.create({ data: { obra_id: o.orcamentos.obra_id, nome: nome.trim() || `${o.orcamentos.nome} (cópia)`, descricao: o.orcamentos.descricao, criado_por: usuarioId } });
    const nova = await copiarRevisao(tx, revisaoOrigemId, { orcamentoId: orc.id, numero: 1, descricao: `Cópia de ${o.orcamentos.nome}, revisão ${o.numero}`, usuarioId });
    await auditar({ usuarioId, acao: "ORCAMENTO_DUPLICADO", entidade: "orcamentos", entidadeId: orc.id, dados: { origem: revisaoOrigemId } }, tx);
    return { orcamentoId: orc.id, revisaoId: nova.id };
  }, { timeout: 120_000 });
}

export interface ResultadoAtualizacao {
  atualizados: number;
  semAlteracao: number;
  naoEncontrados: Array<{ codigo: string; descricao: string; motivo: string }>;
}

/**
 * Atualiza os preços de uma revisão ABERTA para novas bases (nova competência).
 * Itens que não existem na nova base continuam com o preço anterior e ficam sinalizados.
 * Use sobre uma NOVA revisão para preservar a anterior.
 */
export async function atualizarCompetencia(revisaoId: string, versao: number | null, novas: BasePadrao[], usuarioId: string | null): Promise<ResultadoAtualizacao> {
  return alterarRevisao(revisaoId, versao, usuarioId, "COMPETENCIA_ATUALIZADA", async (tx, rev) => {
    const res: ResultadoAtualizacao = { atualizados: 0, semAlteracao: 0, naoEncontrados: [] };
    for (const b of novas) {
      const fonteId = await conferirBase(tx, b);
      await tx.revisoes_orcamento_bases.upsert({
        where: { revisao_id_fonte_id: { revisao_id: revisaoId, fonte_id: fonteId } },
        update: { revisao_base_id: b.revisaoBaseId, regime_codigo: b.regime },
        create: { revisao_id: revisaoId, fonte_id: fonteId, revisao_base_id: b.revisaoBaseId, regime_codigo: b.regime },
      });
      const rb = await tx.revisoes_base.findUniqueOrThrow({ where: { id: b.revisaoBaseId }, include: { bases_referencia: true } });
      const itens = await tx.itens_orcamento.findMany({ where: { revisao_id: revisaoId, tipo: "REFERENCIA", fonte_sigla: b.fonteSigla } });
      for (const it of itens) {
        const p = await tx.precos_referencia.findUnique({
          where: { item_id_revisao_base_id_regime_codigo: { item_id: it.item_referencia_id!, revisao_base_id: b.revisaoBaseId, regime_codigo: b.regime } },
          include: { descricoes_item: true },
        });
        if (!p) {
          res.naoEncontrados.push({ codigo: it.codigo, descricao: it.descricao, motivo: "não consta da nova base/regime; mantido o preço anterior" });
          await tx.itens_orcamento.update({ where: { id: it.id }, data: { observacao: `ATENÇÃO: não encontrado em ${b.fonteSigla} ${rb.bases_referencia.competencia.toISOString().slice(0, 7)} (${b.regime}); mantido preço de ${it.competencia?.toISOString().slice(0, 7)}.` } });
          continue;
        }
        const pub = await tx.composicoes_publicadas.findUnique({ where: { revisao_base_id_item_id: { revisao_base_id: b.revisaoBaseId, item_id: it.item_referencia_id! } } });
        const custo = p.preco !== null ? D(p.preco) : null;
        if (custo === null) res.naoEncontrados.push({ codigo: it.codigo, descricao: it.descricao, motivo: `sem preço na nova base (${p.situacao})` });
        const mudou = (it.custo_unitario?.toString() ?? null) !== (custo?.toString() ?? null);
        if (mudou) res.atualizados++;
        else res.semAlteracao++;
        await tx.itens_orcamento.update({
          where: { id: it.id },
          data: {
            revisao_base_id: b.revisaoBaseId, regime_codigo: b.regime, composicao_id: pub?.composicao_id ?? null, competencia: rb.bases_referencia.competencia,
            rotulo_revisao_base: rb.rotulo, descricao: p.descricoes_item.descricao, unidade: p.descricoes_item.unidade,
            custo_unitario: custo?.toString() ?? null, situacao_preco: p.situacao, observacao: null,
          },
        });
      }
    }
    await recalcularItens(tx, rev);
    return res;
  }, { bases: novas } as unknown as Prisma.InputJsonValue);
}

export interface Pendencia {
  tipo: "ERRO" | "AVISO";
  mensagem: string;
}

/** Verifica se a revisão pode ser fechada. */
export async function pendenciasFechamento(revisaoId: string, db: Tx = prisma): Promise<Pendencia[]> {
  const p: Pendencia[] = [];
  const rev = await db.revisoes_orcamento.findUniqueOrThrow({ where: { id: revisaoId } });
  const itens = await db.itens_orcamento.findMany({ where: { revisao_id: revisaoId } });
  if (itens.length === 0) p.push({ tipo: "ERRO", mensagem: "O orçamento não tem itens." });
  for (const i of itens) {
    if (i.custo_unitario === null) p.push({ tipo: "ERRO", mensagem: `Item ${i.codigo} sem preço na base (${i.situacao_preco}). Substitua por outro serviço ou por serviço próprio.` });
    if (D(i.quantidade).isZero()) p.push({ tipo: "AVISO", mensagem: `Item ${i.codigo} com quantidade zero.` });
    if (i.observacao?.startsWith("ATENÇÃO")) p.push({ tipo: "AVISO", mensagem: `Item ${i.codigo}: ${i.observacao}` });
  }
  if (!rev.bdi_padrao_id) p.push({ tipo: "AVISO", mensagem: "Sem BDI padrão definido (BDI 0%)." });
  if (rev.prazo_meses) {
    const etapas = await db.etapas.findMany({ where: { revisao_id: revisaoId, pai_id: null }, include: { cronograma: true } });
    for (const e of etapas) {
      const soma = e.cronograma.reduce((s, c) => s.plus(D(c.percentual)), new Decimal(0));
      if (!soma.eq(100)) p.push({ tipo: "AVISO", mensagem: `Cronograma da etapa "${e.titulo}" soma ${soma.toString()}% (esperado 100%).` });
    }
  }
  return p;
}

/**
 * Fecha a revisão: congela totais, registra a explosão analítica até os insumos com os preços
 * usados e gera um hash do conteúdo. Depois disso o banco impede qualquer alteração.
 */
export async function fecharRevisao(revisaoId: string, versao: number | null, usuarioId: string | null) {
  const erros = (await pendenciasFechamento(revisaoId)).filter((x) => x.tipo === "ERRO");
  if (erros.length) throw new ErroDeNegocio(`Não é possível fechar: ${erros.map((e) => e.mensagem).join(" ")}`);
  return prisma.$transaction(async (tx) => {
    const travada = await tx.$queryRawUnsafe<Array<{ versao: number; status: string }>>(`SELECT versao, status FROM revisoes_orcamento WHERE id = $1::uuid FOR UPDATE`, revisaoId);
    if (travada[0]?.status !== "ABERTA") throw new ErroDeNegocio("A revisão já está fechada.");
    if (versao !== null && travada[0].versao !== versao) throw new ErroConcorrencia();
    const rev = await tx.revisoes_orcamento.findUniqueOrThrow({ where: { id: revisaoId } });
    const etapas = await tx.etapas.findMany({ where: { revisao_id: revisaoId } });
    const numeros = numerarEtapas(etapas);
    const itens = await tx.itens_orcamento.findMany({ where: { revisao_id: revisaoId }, orderBy: [{ etapa_id: "asc" }, { ordem: "asc" }] });
    const linhasCalc = itens.map((i) => ({
      custoTotal: calcularItem({ custoUnitario: i.custo_unitario, quantidade: i.quantidade, bdiPercentual: i.bdi_percentual, modo: rev.modo_arredondamento as ModoArredondamento }).custoTotal,
      total: i.total,
    }));
    const t = totalizar(linhasCalc);
    // Explosão analítica congelada
    const cache = new Map<string, string | null>();
    for (const it of itens) {
      const insumos = await explodirItemOrcamento(tx, it, cache);
      if (insumos.length) {
        await tx.fechamento_insumos.createMany({
          data: insumos.map((x, k) => ({
            revisao_id: revisaoId, item_orcamento_id: it.id, ordem: k + 1, nivel: x.nivel, tipo_item: x.tipoItem, fonte_sigla: x.fonte, codigo: x.codigo,
            descricao: x.descricao, unidade: x.unidade, coeficiente: x.coeficiente.toDecimalPlaces(12).toString(), custo_unitario: x.custoUnitario?.toString() ?? null,
            revisao_base_id: x.revisaoBaseId, regime_codigo: x.regime,
          })),
        });
      }
    }
    const conteudo = JSON.stringify({
      revisao: revisaoId, modo: rev.modo_arredondamento,
      itens: itens.map((i) => [numeros.get(i.etapa_id), i.ordem, i.fonte_sigla, i.codigo, i.revisao_base_id, i.regime_codigo, i.custo_unitario?.toString(), i.quantidade.toString(), i.bdi_percentual.toString(), i.preco_unitario?.toString(), i.total?.toString()]),
      totais: [t.custoDireto.toString(), t.total.toString()],
    });
    const hash = createHash("sha256").update(conteudo).digest("hex");
    await tx.revisoes_orcamento.update({
      where: { id: revisaoId },
      data: {
        status: "FECHADA", fechada_em: new Date(), fechada_por: usuarioId, total_custo: arredondar(t.custoDireto, 2).toString(),
        total_bdi: arredondar(t.bdi, 2).toString(), total_geral: arredondar(t.total, 2).toString(), hash_fechamento: hash, versao: { increment: 1 },
      },
    });
    await auditar({ usuarioId, acao: "REVISAO_FECHADA", entidade: "revisoes_orcamento", entidadeId: revisaoId, dados: { total: t.total.toString(), hash } }, tx);
    return { hash, total: t.total };
  }, { timeout: 300_000 });
}

export { NOMES_PARCELA };

import { prisma } from "@/servidor/db";
import { carregarRevisao, type RevisaoCarregada } from "@/servidor/dados-orcamento";
import { composicaoAnalitica } from "@/servidor/consultas";
import { custoComposicaoPropria } from "@/servidor/composicoes-proprias";
import { explodirItemOrcamento } from "@/servidor/explosao";
import { compararRevisoes } from "@/servidor/comparacao";
import { curvaAbc } from "@/dominio/abc";
import { calcularBdi, NOMES_PARCELA, type CodigoParcela } from "@/dominio/bdi";
import { CEM, D, Decimal, ZERO, ajustar } from "@/dominio/decimal";
import { formatarCompetencia, formatarDataHora, formatarNumero, formatarPercentual } from "@/dominio/formato";
import { percentualDe } from "@/dominio/orcamento";
import { NOMES_REGIME, type CodigoRegime } from "@/dominio/referencias";
import type { Linha, Relatorio, Tabela } from "./modelo";

export const TIPOS_RELATORIO = {
  sintetico: "Orçamento sintético",
  analitico: "Orçamento analítico",
  composicoes: "Composições de custos unitários",
  "abc-servicos": "Curva ABC de serviços",
  "abc-insumos": "Curva ABC de insumos",
  bdi: "Demonstrativo de BDI",
  cronograma: "Cronograma físico-financeiro",
  comparativo: "Comparativo de revisões",
  historico: "Histórico de preços",
  memoria: "Memória de cálculo",
} as const;
export type TipoRelatorio = keyof typeof TIPOS_RELATORIO;

function cabecalho(d: RevisaoCarregada): Array<[string, string]> {
  const regimes = [...new Set(d.bases.map((b) => NOMES_REGIME[b.regime as CodigoRegime]))].join(", ");
  const status = d.rev.status === "FECHADA"
    ? `FECHADA em ${formatarDataHora(d.rev.fechada_em)} — código de integridade ${d.rev.hash_fechamento}`
    : `ABERTA (versão de edição ${d.rev.versao}) — valores sujeitos a alteração`;
  return [
    ["Obra", `${d.obra.nome}${d.obra.municipio ? ` — ${d.obra.municipio}/${d.obra.uf}` : ""}`],
    ["Orçamento", `${d.orcamento.codigo ? `${d.orcamento.codigo} — ` : ""}${d.orcamento.nome}`],
    ["Versão", `Revisão nº ${d.rev.numero}${d.rev.descricao ? ` (${d.rev.descricao})` : ""} — ${status}`],
    ["Fontes de referência", d.bases.map((b) => `${b.fonte} ${formatarCompetencia(b.competencia)} — ${b.rotulo}${b.status === "SUBSTITUIDA" ? " (substituída por retificação)" : ""}`).join("; ") || "—"],
    ["Competência", [...new Set(d.bases.map((b) => formatarCompetencia(b.competencia)))].join(", ") || "—"],
    ["Regime de encargos", regimes || "—"],
    ["BDI padrão", d.bdiPadrao ? `${d.bdiPadrao.nome} — ${formatarPercentual(d.bdiPadrao.percentual_adotado)}` : "não definido"],
    ["Critério de valores", d.modo === "TRUNCAR" ? "Preços unitários e totais truncados em 2 casas decimais" : "Preços unitários e totais arredondados em 2 casas decimais"],
    ["Emitido em", formatarDataHora(new Date())],
  ];
}

const notaPadrao = (d: RevisaoCarregada) => [
  "Valores em reais (R$). Preço unitário = custo unitário × (1 + BDI); total = quantidade × preço unitário.",
  ...(d.totais.semPreco ? [`${d.totais.semPreco} item(ns) sem preço na base não estão somados.`] : []),
  ...(d.itens.some((i) => i.fonte === "PROPRIA") ? ["Itens com fonte PRÓPRIA não são publicados por EMOP/SINAPI: custo informado pelo orçamentista ou composição própria."] : []),
];

function sintetico(d: RevisaoCarregada): Relatorio {
  const linhas: Linha[] = [];
  for (const e of d.etapas) {
    linhas.push({ celulas: [e.numero, null, null, e.titulo, null, null, null, null, e.total, percentualDe(e.total, d.totais.total)], estilo: "etapa", nivel: e.nivel });
    for (const i of e.itens) {
      linhas.push({ celulas: [i.numero, i.fonte, i.codigo, i.descricao, i.unidade, i.quantidade, i.custoUnitario, i.precoUnitario, i.total, i.total ? percentualDe(i.total, d.totais.total) : null], nivel: e.nivel + 1 });
    }
  }
  linhas.push({ celulas: [null, null, null, "CUSTO DIRETO", null, null, null, null, d.totais.custo, null], estilo: "subtotal" });
  linhas.push({ celulas: [null, null, null, "BDI", null, null, null, null, d.totais.bdi, null], estilo: "subtotal" });
  linhas.push({ celulas: [null, null, null, "TOTAL GERAL", null, null, null, null, d.totais.total, d.totais.total.isZero() ? null : new Decimal(100)], estilo: "total" });
  return {
    arquivo: "orcamento-sintetico", titulo: TIPOS_RELATORIO.sintetico, cabecalho: cabecalho(d), notas: notaPadrao(d),
    tabelas: [{
      colunas: [
        { titulo: "Item", largura: 1 }, { titulo: "Fonte", largura: 1 }, { titulo: "Código", largura: 1.6 }, { titulo: "Descrição", largura: 8 }, { titulo: "Und.", largura: 0.8 },
        { titulo: "Quantidade", formato: "variavel", largura: 1.3 }, { titulo: "Custo unit.", formato: "variavel", largura: 1.4 }, { titulo: "Preço unit. c/ BDI", formato: "moeda", largura: 1.4 },
        { titulo: "Total", formato: "moeda", largura: 1.6 }, { titulo: "%", formato: "percentual", largura: 0.9 },
      ],
      linhas,
    }],
  };
}

async function analitico(d: RevisaoCarregada): Promise<Relatorio> {
  const linhas: Linha[] = [];
  for (const e of d.etapas) {
    linhas.push({ celulas: [e.numero, null, e.titulo, null, null, null, null, e.total], estilo: "etapa" });
    for (const i of e.itens) {
      linhas.push({ celulas: [i.numero, `${i.fonte} ${i.codigo}`, i.descricao, i.unidade, i.quantidade, i.custoUnitario, i.precoUnitario, i.total], estilo: "subtotal" });
      const comp = await componentesDoItem(i);
      if (!comp) {
        linhas.push({ celulas: [null, null, "(a fonte não publicou composição analítica para este item)", null, null, null, null, null] });
        continue;
      }
      for (const c of comp.linhas) linhas.push({ celulas: [null, c.codigo, `  ${c.descricao}`, c.unidade, c.coeficiente, c.preco, c.valor, null], nivel: 2 });
      if (comp.nota) linhas.push({ celulas: [null, null, comp.nota, null, null, null, null, null] });
    }
  }
  linhas.push({ celulas: [null, null, "TOTAL GERAL", null, null, null, null, d.totais.total], estilo: "total" });
  return {
    arquivo: "orcamento-analitico", titulo: TIPOS_RELATORIO.analitico, cabecalho: cabecalho(d),
    notas: [...notaPadrao(d), "Nas linhas de componentes: coeficiente por unidade do serviço, preço unitário do componente e custo parcial pela regra da fonte (EMOP: TRUNC(q×p×(1+perdas%);4); SINAPI e próprias: TRUNC(coef×p;2))."],
    tabelas: [{
      colunas: [
        { titulo: "Item", largura: 0.9 }, { titulo: "Código", largura: 1.8 }, { titulo: "Descrição", largura: 8 }, { titulo: "Und.", largura: 0.8 },
        { titulo: "Qtd. / Coef.", formato: "variavel", largura: 1.4 }, { titulo: "Custo unit.", formato: "variavel", largura: 1.4 }, { titulo: "P.U. c/ BDI / Parcial", formato: "variavel", largura: 1.5 }, { titulo: "Total", formato: "moeda", largura: 1.5 },
      ],
      linhas,
    }],
  };
}

interface ComponentesItem {
  linhas: Array<{ codigo: string; descricao: string; unidade: string; coeficiente: Decimal; preco: Decimal | null; valor: Decimal | null }>;
  total: Decimal | null;
  nota?: string;
}

async function componentesDoItem(i: RevisaoCarregada["itens"][number]): Promise<ComponentesItem | null> {
  if (i.fonte === "PROPRIA") {
    if (!i.composicaoId) return null;
    const c = await custoComposicaoPropria(i.composicaoId);
    return { linhas: c.linhas.map((l) => ({ codigo: `${l.fonte} ${l.codigo}`, descricao: l.descricao, unidade: l.unidade, coeficiente: l.coeficiente, preco: l.custoUnitario, valor: l.valor })), total: c.custo, nota: "Composição PRÓPRIA (não publicada por fonte oficial)." };
  }
  if (!i.itemReferenciaId || !i.revisaoBaseId || !i.regime) return null;
  let alvo = i.itemReferenciaId;
  const ref = await prisma.itens_referencia.findUnique({ where: { id: alvo } });
  if (ref?.tipo === "INSUMO" && ref.codigo_composicao_vinculada) {
    const v = await prisma.itens_referencia.findUnique({ where: { fonte_id_tipo_codigo: { fonte_id: ref.fonte_id, tipo: "COMPOSICAO", codigo: ref.codigo_composicao_vinculada } } });
    if (v) alvo = v.id;
  }
  const a = await composicaoAnalitica(alvo, i.revisaoBaseId, i.regime);
  if (!a) return null;
  const nota = a.totalCalculado && i.custoUnitario && !D(a.totalCalculado).eq(i.custoUnitario)
    ? `Soma recalculada R$ ${formatarNumero(a.totalCalculado)}; vale o custo publicado R$ ${formatarNumero(i.custoUnitario)} (arredondamento da fonte).` : undefined;
  return {
    linhas: a.linhas.map((l) => ({ codigo: l.codigo, descricao: l.descricao, unidade: l.unidade, coeficiente: D(l.coeficiente).times(D(l.percentual_perda ?? 0).div(100).plus(1)), preco: l.preco !== null ? D(l.preco) : null, valor: l.valor !== null ? D(l.valor) : null })),
    total: a.totalCalculado !== null ? D(a.totalCalculado) : null, nota,
  };
}

async function composicoes(d: RevisaoCarregada): Promise<Relatorio> {
  const tabelas: Tabela[] = [];
  const vistos = new Set<string>();
  const fila = d.itens.map((i) => ({ i, nivel: 0 }));
  const bdiPorItem = new Map(d.itens.map((i) => [`${i.fonte}|${i.codigo}`, i]));
  while (fila.length && tabelas.length < 400) {
    const { i } = fila.shift()!;
    const chave = `${i.fonte}|${i.codigo}|${i.revisaoBaseId}|${i.regime}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const c = await componentesDoItem(i);
    if (!c) continue;
    const linhas: Linha[] = c.linhas.map((l) => ({ celulas: [l.codigo, l.descricao, l.unidade, l.coeficiente, l.preco, l.valor] }));
    const orc = bdiPorItem.get(`${i.fonte}|${i.codigo}`);
    linhas.push({ celulas: [null, "CUSTO UNITÁRIO (publicado/adotado)", i.unidade, null, null, i.custoUnitario], estilo: "subtotal" });
    if (orc) {
      linhas.push({ celulas: [null, `BDI (${formatarPercentual(orc.bdiPercentual)})`, null, null, null, orc.precoUnitario && orc.custoUnitario ? orc.precoUnitario.minus(orc.custoUnitario) : null] });
      linhas.push({ celulas: [null, "PREÇO UNITÁRIO COM BDI", i.unidade, null, null, orc.precoUnitario], estilo: "total" });
    }
    if (c.nota) linhas.push({ celulas: [null, c.nota, null, null, null, null] });
    tabelas.push({
      titulo: `${i.fonte} ${i.codigo} — ${i.descricao} (${i.unidade}) · ${i.referencia}`,
      colunas: [
        { titulo: "Código", largura: 1.6 }, { titulo: "Descrição", largura: 8 }, { titulo: "Und.", largura: 0.8 },
        { titulo: "Coeficiente", formato: "variavel", largura: 1.4 }, { titulo: "Preço unit.", formato: "variavel", largura: 1.4 }, { titulo: "Custo parcial", formato: "variavel", largura: 1.4 },
      ],
      linhas,
    });
  }
  return {
    arquivo: "composicoes-custos-unitarios", titulo: TIPOS_RELATORIO.composicoes, cabecalho: cabecalho(d), tabelas,
    notas: ["Composições analíticas exatamente como publicadas pela fonte para a base/regime de cada item. Itens sem composição publicada não são listados (nenhuma composição é inventada).", "Coeficientes EMOP já incluem o percentual de perdas: q × (1 + %/100)."],
  };
}

function abcServicos(d: RevisaoCarregada): Relatorio {
  const abc = curvaAbc(d.itens.filter((i) => i.total !== null).map((i) => ({ chave: `${i.fonte}|${i.codigo}|${i.regime ?? ""}`, valor: i.total!, i })));
  const qtd = new Map<string, Decimal>();
  for (const i of d.itens) {
    const k = `${i.fonte}|${i.codigo}|${i.regime ?? ""}`;
    qtd.set(k, (qtd.get(k) ?? ZERO).plus(i.quantidade));
  }
  return {
    arquivo: "curva-abc-servicos", titulo: TIPOS_RELATORIO["abc-servicos"], cabecalho: cabecalho(d),
    notas: ["Classes: A até 80% do valor acumulado, B até 95%, C o restante. Valores com BDI. Serviços iguais em etapas diferentes são somados."],
    tabelas: [{
      colunas: [
        { titulo: "Pos.", largura: 0.6 }, { titulo: "Fonte", largura: 1 }, { titulo: "Código", largura: 1.6 }, { titulo: "Descrição", largura: 8 }, { titulo: "Und.", largura: 0.8 },
        { titulo: "Quantidade", formato: "variavel", largura: 1.3 }, { titulo: "Valor", formato: "moeda", largura: 1.6 }, { titulo: "%", formato: "percentual", largura: 0.9 },
        { titulo: "% acum.", formato: "percentual", largura: 0.9 }, { titulo: "Classe", largura: 0.7 },
      ],
      linhas: [
        ...abc.map((l) => ({ celulas: [String(l.posicao), l.entrada.i.fonte, l.entrada.i.codigo, l.entrada.i.descricao, l.entrada.i.unidade, qtd.get(l.entrada.chave)!, l.valor, l.percentual, l.percentualAcumulado, l.classe] as Linha["celulas"] })),
        { celulas: [null, null, null, "TOTAL", null, null, d.totais.total, null, null, null], estilo: "total" },
      ],
    }],
  };
}

async function insumosDaRevisao(d: RevisaoCarregada) {
  // Revisão fechada: usa a explosão congelada no fechamento; aberta: calcula agora.
  const congelados = d.rev.status === "FECHADA" ? await prisma.fechamento_insumos.findMany({ where: { revisao_id: d.rev.id } }) : [];
  const porItem = new Map<string, Array<{ fonte: string; codigo: string; descricao: string; unidade: string; coeficiente: Decimal; custo: Decimal | null; regime: string | null }>>();
  if (congelados.length) {
    for (const c of congelados) {
      const l = porItem.get(c.item_orcamento_id) ?? [];
      l.push({ fonte: c.fonte_sigla, codigo: c.codigo, descricao: c.descricao, unidade: c.unidade, coeficiente: D(c.coeficiente), custo: c.custo_unitario !== null ? D(c.custo_unitario) : null, regime: c.regime_codigo });
      porItem.set(c.item_orcamento_id, l);
    }
  } else {
    const cache = new Map<string, string | null>();
    for (const i of d.itens) {
      const ex = await explodirItemOrcamento(prisma, {
        tipo: i.tipo, item_referencia_id: i.itemReferenciaId, revisao_base_id: i.revisaoBaseId, regime_codigo: i.regime, composicao_id: i.composicaoId,
        fonte_sigla: i.fonte, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, custo_unitario: i.custoUnitario,
      }, cache);
      porItem.set(i.id, ex.map((x) => ({ fonte: x.fonte, codigo: x.codigo, descricao: x.descricao, unidade: x.unidade, coeficiente: x.coeficiente, custo: x.custoUnitario, regime: x.regime })));
    }
  }
  return porItem;
}

async function abcInsumos(d: RevisaoCarregada): Promise<Relatorio> {
  const porItem = await insumosDaRevisao(d);
  const entradas: Array<{ chave: string; valor: Decimal; fonte: string; codigo: string; descricao: string; unidade: string; quantidade: Decimal; custo: Decimal | null }> = [];
  for (const i of d.itens) {
    for (const x of porItem.get(i.id) ?? []) {
      const quantidade = i.quantidade.times(x.coeficiente);
      entradas.push({ chave: `${x.fonte}|${x.codigo}|${x.regime ?? ""}`, valor: x.custo ? quantidade.times(x.custo) : ZERO, fonte: x.fonte, codigo: x.codigo, descricao: x.descricao, unidade: x.unidade, quantidade, custo: x.custo });
    }
  }
  const quantidades = new Map<string, Decimal>();
  for (const e of entradas) quantidades.set(e.chave, (quantidades.get(e.chave) ?? ZERO).plus(e.quantidade));
  const abc = curvaAbc(entradas);
  const soma = abc.reduce((s, l) => s.plus(l.valor), ZERO);
  return {
    arquivo: "curva-abc-insumos", titulo: TIPOS_RELATORIO["abc-insumos"], cabecalho: cabecalho(d),
    notas: [
      "Valores de custo direto (sem BDI): quantidade total do insumo × preço unitário da base de cada serviço. Classes: A até 80%, B até 95%, C o restante.",
      `Soma dos insumos: R$ ${formatarNumero(soma)}; custo direto do orçamento: R$ ${formatarNumero(d.totais.custo)}. A diferença decorre dos truncamentos por linha feitos pelas próprias fontes nas composições e dos ajustes de 2 casas no orçamento.`,
      ...(d.rev.status === "FECHADA" ? ["Explosão analítica congelada no fechamento da revisão."] : []),
    ],
    tabelas: [{
      colunas: [
        { titulo: "Pos.", largura: 0.6 }, { titulo: "Fonte", largura: 1 }, { titulo: "Código", largura: 1.3 }, { titulo: "Descrição", largura: 8 }, { titulo: "Und.", largura: 0.8 },
        { titulo: "Quantidade", formato: "numero4", largura: 1.4 }, { titulo: "Preço unit.", formato: "variavel", largura: 1.3 }, { titulo: "Valor", formato: "moeda", largura: 1.5 },
        { titulo: "%", formato: "percentual", largura: 0.9 }, { titulo: "% acum.", formato: "percentual", largura: 0.9 }, { titulo: "Classe", largura: 0.7 },
      ],
      linhas: [
        ...abc.map((l) => ({ celulas: [String(l.posicao), l.entrada.fonte, l.entrada.codigo, l.entrada.descricao, l.entrada.unidade, quantidades.get(l.entrada.chave)!, l.entrada.custo, l.valor, l.percentual, l.percentualAcumulado, l.classe] as Linha["celulas"] })),
        { celulas: [null, null, null, "TOTAL DOS INSUMOS", null, null, null, soma, null, null, null], estilo: "total" },
      ],
    }],
  };
}

function demonstrativoBdi(d: RevisaoCarregada): Relatorio {
  const tabelas: Tabela[] = [];
  for (const b of d.bdis) {
    const parcelas = (b.parcelas as Array<{ codigo: CodigoParcela; nome: string; percentual: string }>) ?? [];
    const linhas: Linha[] = parcelas.map((p) => ({ celulas: [p.codigo, NOMES_PARCELA[p.codigo] ?? p.nome, D(p.percentual)] }));
    if (parcelas.length) {
      const c = calcularBdi(parcelas);
      linhas.push({ celulas: [null, "AC + S + G + R", c.somaAdministracao], estilo: "subtotal" });
      linhas.push({ celulas: [null, "Despesas financeiras (DF)", c.despesasFinanceiras], estilo: "subtotal" });
      linhas.push({ celulas: [null, "Lucro (L)", c.lucro], estilo: "subtotal" });
      linhas.push({ celulas: [null, "Tributos (T)", c.tributos], estilo: "subtotal" });
      linhas.push({ celulas: [null, "BDI calculado = (1+AC+S+R+G)(1+DF)(1+L)/(1−T) − 1", c.percentual.toDecimalPlaces(4, Decimal.ROUND_HALF_UP)], estilo: "subtotal" });
    }
    linhas.push({ celulas: [null, "BDI ADOTADO", D(b.percentual_adotado)], estilo: "total" });
    const usos = d.itens.filter((i) => (i.bdiAplicadoId ?? d.rev.bdi_padrao_id) === b.id);
    linhas.push({ celulas: [null, `Aplicado a ${usos.length} item(ns), total R$ ${formatarNumero(usos.reduce((s, i) => s.plus(i.total ?? ZERO), ZERO))}${b.id === d.rev.bdi_padrao_id ? " (BDI padrão)" : ""}`, null] });
    tabelas.push({ titulo: b.nome, colunas: [{ titulo: "Sigla", largura: 1 }, { titulo: "Parcela", largura: 8 }, { titulo: "%", formato: "numero4", largura: 1.5 }], linhas });
  }
  return {
    arquivo: "demonstrativo-bdi", titulo: TIPOS_RELATORIO.bdi, cabecalho: cabecalho(d), tabelas, paisagem: false,
    notas: ["Fórmula do Acórdão TCU 2622/2013, adotada pela EMOP-RJ (Catálogo de Referência, item 2.3).", "Os BDIs desta revisão são cópias congeladas dos perfis no momento do uso."],
  };
}

async function cronograma(d: RevisaoCarregada): Promise<Relatorio> {
  const meses = d.rev.prazo_meses ?? 0;
  const raiz = d.etapas.filter((e) => !e.paiId);
  const pct = new Map(d.cronograma.map((c) => [`${c.etapa_id}|${c.mes}`, D(c.percentual)]));
  const totMes = Array.from({ length: meses }, () => ZERO);
  const linhas: Linha[] = [];
  for (const e of raiz) {
    const valores = Array.from({ length: meses }, (_x, k) => {
      const p = pct.get(`${e.id}|${k + 1}`) ?? ZERO;
      const v = ajustar(e.total.times(p).div(CEM), 2, "ARREDONDAR");
      totMes[k] = totMes[k]!.plus(v);
      return { p, v };
    });
    linhas.push({ celulas: [e.numero, e.titulo, e.total, ...valores.map((x) => (x.p.isZero() ? null : x.p))], estilo: "etapa" });
    linhas.push({ celulas: [null, "valor (R$)", null, ...valores.map((x) => (x.v.isZero() ? null : x.v))] });
  }
  let acum = ZERO;
  const acumulado = totMes.map((t) => (acum = acum.plus(t)));
  linhas.push({ celulas: [null, "TOTAL NO MÊS (R$)", d.totais.total, ...totMes], estilo: "total" });
  linhas.push({ celulas: [null, "% NO MÊS", null, ...totMes.map((t) => percentualDe(t, d.totais.total))], estilo: "subtotal" });
  linhas.push({ celulas: [null, "ACUMULADO (R$)", null, ...acumulado], estilo: "subtotal" });
  linhas.push({ celulas: [null, "% ACUMULADO", null, ...acumulado.map((t) => percentualDe(t, d.totais.total))], estilo: "subtotal" });
  return {
    arquivo: "cronograma-fisico-financeiro", titulo: TIPOS_RELATORIO.cronograma, cabecalho: cabecalho(d),
    notas: meses ? ["Linhas de etapa: percentual executado em cada mês; linhas \"valor\": valor correspondente (arredondado ao centavo)."] : ["Prazo da obra não definido nesta revisão."],
    tabelas: [{
      colunas: [{ titulo: "Item", largura: 0.7 }, { titulo: "Etapa", largura: 5 }, { titulo: "Valor total", formato: "moeda", largura: 1.6 },
        ...Array.from({ length: meses }, (_x, k) => ({ titulo: `Mês ${k + 1}`, formato: "numero2" as const, largura: 1.2 }))],
      linhas,
    }],
  };
}

async function comparativo(revA: string, revB: string): Promise<Relatorio> {
  const c = await compararRevisoes(revA, revB);
  const NOMES = { INCLUIDO: "Incluído", EXCLUIDO: "Excluído", ALTERADO: "Alterado", IGUAL: "Igual" };
  return {
    arquivo: "comparativo-revisoes", titulo: TIPOS_RELATORIO.comparativo,
    cabecalho: [...cabecalho(c.b), ["Comparado com", `Revisão nº ${c.a.rev.numero} (${c.a.rev.status}) — total R$ ${formatarNumero(c.a.totais.total)}`], ["Diferença total", `R$ ${formatarNumero(c.diferencaTotal)}`]],
    notas: ["A = revisão de referência; B = revisão comparada. Itens identificados por etapa, fonte e código."],
    tabelas: [{
      colunas: [
        { titulo: "Situação", largura: 1 }, { titulo: "Etapa", largura: 3 }, { titulo: "Código", largura: 1.6 }, { titulo: "Descrição", largura: 6 },
        { titulo: "Qtd. A", formato: "variavel", largura: 1.1 }, { titulo: "Qtd. B", formato: "variavel", largura: 1.1 }, { titulo: "P.U. A", formato: "moeda", largura: 1.2 }, { titulo: "P.U. B", formato: "moeda", largura: 1.2 },
        { titulo: "Total A", formato: "moeda", largura: 1.4 }, { titulo: "Total B", formato: "moeda", largura: 1.4 }, { titulo: "Diferença", formato: "moeda", largura: 1.4 },
      ],
      linhas: [
        ...c.linhas.map((l) => ({ celulas: [NOMES[l.situacao], l.etapa, `${l.fonte} ${l.codigo}`, l.descricao, l.qtdA, l.qtdB, l.precoA, l.precoB, l.totalA, l.totalB, l.diferenca] as Linha["celulas"] })),
        { celulas: [null, null, null, "TOTAL", null, null, null, null, c.a.totais.total, c.b.totais.total, c.diferencaTotal], estilo: "total" },
      ],
    }],
  };
}

async function historico(d: RevisaoCarregada): Promise<Relatorio> {
  const refs = d.itens.filter((i) => i.itemReferenciaId && i.fonte !== "PROPRIA" && i.regime);
  const ids = [...new Set(refs.map((i) => i.itemReferenciaId!))];
  const precos = ids.length
    ? await prisma.$queryRawUnsafe<Array<{ item_id: string; regime_codigo: string; competencia: Date; numero: number; preco: string | null; situacao: string }>>(
        `SELECT p.item_id, p.regime_codigo, b.competencia, r.numero, p.preco::text preco, p.situacao
           FROM precos_referencia p JOIN revisoes_base r ON r.id = p.revisao_base_id JOIN bases_referencia b ON b.id = r.base_id
          WHERE p.item_id = ANY($1::uuid[]) AND r.status IN ('PUBLICADA', 'SUBSTITUIDA')`, ids)
    : [];
  const periodos = [...new Set(precos.map((p) => `${p.competencia.toISOString().slice(0, 7)}|${p.numero}`))].sort();
  const mapa = new Map(precos.map((p) => [`${p.item_id}|${p.regime_codigo}|${p.competencia.toISOString().slice(0, 7)}|${p.numero}`, p]));
  const vistos = new Set<string>();
  const linhas: Linha[] = [];
  for (const i of refs) {
    const k = `${i.itemReferenciaId}|${i.regime}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const serie = periodos.map((per) => mapa.get(`${k}|${per}`));
    const valores = serie.map((s) => (s?.preco ? D(s.preco) : null));
    const primeiro = valores.find((v) => v !== null) ?? null;
    const ultimo = [...valores].reverse().find((v) => v !== null) ?? null;
    linhas.push({ celulas: [`${i.fonte} ${i.codigo}`, i.descricao, i.unidade, NOMES_REGIME[i.regime as CodigoRegime], ...valores, primeiro && ultimo && !primeiro.isZero() ? ultimo.div(primeiro).minus(1).times(CEM) : null] });
  }
  return {
    arquivo: "historico-precos", titulo: TIPOS_RELATORIO.historico, cabecalho: cabecalho(d),
    notas: ["Preços publicados para os itens EMOP/SINAPI do orçamento em todas as bases importadas (r2, r3 = retificações). Célula vazia: sem preço ou item inexistente naquela base."],
    tabelas: [{
      colunas: [
        { titulo: "Código", largura: 1.8 }, { titulo: "Descrição", largura: 6 }, { titulo: "Und.", largura: 0.8 }, { titulo: "Regime", largura: 1.5 },
        ...periodos.map((p) => { const [c, n] = p.split("|"); return { titulo: `${formatarCompetencia(new Date(`${c}-01T00:00:00Z`))}${n !== "1" ? ` r${n}` : ""}`, formato: "variavel" as const, largura: 1.2 }; }),
        { titulo: "Variação %", formato: "percentual", largura: 1 },
      ],
      linhas,
    }],
  };
}

function memoria(d: RevisaoCarregada): Relatorio {
  const modo = d.modo === "TRUNCAR" ? "truncado" : "arredondado";
  const linhas: Linha[] = [];
  for (const e of d.etapas) {
    linhas.push({ celulas: [e.numero, e.titulo, null, null, null], estilo: "etapa" });
    for (const i of e.itens) {
      const fator = i.bdiPercentual.div(CEM).plus(1);
      const bruto = i.custoUnitario ? i.custoUnitario.times(fator) : null;
      const totBruto = i.precoUnitario ? i.quantidade.times(i.precoUnitario) : null;
      linhas.push({
        celulas: [
          i.numero,
          `${i.fonte} ${i.codigo} — ${i.descricao} (${i.unidade})`,
          `Custo: ${i.custoUnitario ? formatarNumero(i.custoUnitario, Math.max(2, i.custoUnitario.decimalPlaces())) : "sem preço"} [${i.referencia}]`,
          bruto ? `P.U. = ${formatarNumero(i.custoUnitario!, Math.max(2, i.custoUnitario!.decimalPlaces()))} × ${formatarNumero(fator, 6)} = ${formatarNumero(bruto, Math.min(8, bruto.decimalPlaces()))} → ${formatarNumero(i.precoUnitario!)} (${modo}); BDI ${formatarPercentual(i.bdiPercentual)}` : "—",
          totBruto ? `Total = ${formatarNumero(i.quantidade, Math.max(2, i.quantidade.decimalPlaces()))} × ${formatarNumero(i.precoUnitario!)} = ${formatarNumero(totBruto, Math.min(8, totBruto.decimalPlaces()))} → ${formatarNumero(i.total!)} (${modo})` : "—",
        ],
      });
    }
  }
  linhas.push({ celulas: [null, "TOTAL GERAL", null, null, `R$ ${formatarNumero(d.totais.total)}`], estilo: "total" });
  return {
    arquivo: "memoria-de-calculo", titulo: TIPOS_RELATORIO.memoria, cabecalho: cabecalho(d),
    notas: [
      "Regras: preço unitário = ajuste(custo unitário × (1 + BDI/100); 2 casas); total = ajuste(quantidade × preço unitário; 2 casas); totais = soma dos totais dos itens.",
      "Custos unitários são os publicados pela fonte na base/regime indicados (instantâneo gravado no item). Cálculos em aritmética decimal exata.",
      ...(d.rev.hash_fechamento ? [`Código de integridade (SHA-256) do fechamento: ${d.rev.hash_fechamento}`] : []),
    ],
    tabelas: [{ colunas: [{ titulo: "Item", largura: 0.8 }, { titulo: "Serviço", largura: 6 }, { titulo: "Origem do custo", largura: 4 }, { titulo: "Preço unitário", largura: 5 }, { titulo: "Total", largura: 4 }], linhas }],
  };
}

export async function montarRelatorio(tipo: TipoRelatorio, revisaoId: string, comparadoCom?: string | null): Promise<Relatorio> {
  if (tipo === "comparativo") {
    if (!comparadoCom) throw new Error("Informe a revisão a comparar");
    return comparativo(revisaoId, comparadoCom);
  }
  const d = await carregarRevisao(revisaoId);
  switch (tipo) {
    case "sintetico": return sintetico(d);
    case "analitico": return analitico(d);
    case "composicoes": return composicoes(d);
    case "abc-servicos": return abcServicos(d);
    case "abc-insumos": return abcInsumos(d);
    case "bdi": return demonstrativoBdi(d);
    case "cronograma": return cronograma(d);
    case "historico": return historico(d);
    case "memoria": return memoria(d);
  }
}

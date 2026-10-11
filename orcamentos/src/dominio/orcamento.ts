import { CEM, D, Decimal, ZERO, ajustar, type ModoArredondamento, type ValorDecimal } from "./decimal";

/**
 * Regras de cálculo do orçamento (documentadas em docs/REGRAS_DE_CALCULO.md):
 *
 *  preço unitário = ajuste( custo unitário × (1 + BDI%/100) ; 2 casas )
 *  total do item  = ajuste( quantidade × preço unitário ; 2 casas )
 *  custo do item  = ajuste( quantidade × custo unitário ; 2 casas )
 *  totais         = soma dos totais dos itens (sem novo ajuste)
 *
 *  "ajuste" = TRUNCAR (padrão, mesma prática da EMOP e do SINAPI) ou ARREDONDAR, por revisão.
 */
export const CASAS_MONETARIAS = 2;

export interface EntradaItem {
  custoUnitario: ValorDecimal | null;
  quantidade: ValorDecimal;
  /** Pontos percentuais (25 = 25%) */
  bdiPercentual: ValorDecimal;
  modo: ModoArredondamento;
}

export interface ResultadoItem {
  precoUnitario: Decimal | null;
  total: Decimal | null;
  custoTotal: Decimal | null;
  valorBdi: Decimal | null;
}

export function calcularItem(e: EntradaItem): ResultadoItem {
  const q = D(e.quantidade);
  if (q.isNegative()) throw new Error("Quantidade não pode ser negativa");
  const bdi = D(e.bdiPercentual);
  if (bdi.isNegative()) throw new Error("BDI não pode ser negativo");
  if (e.custoUnitario === null) return { precoUnitario: null, total: null, custoTotal: null, valorBdi: null };
  const custo = D(e.custoUnitario);
  const precoUnitario = ajustar(custo.times(bdi.div(CEM).plus(1)), CASAS_MONETARIAS, e.modo);
  const total = ajustar(q.times(precoUnitario), CASAS_MONETARIAS, e.modo);
  const custoTotal = ajustar(q.times(custo), CASAS_MONETARIAS, e.modo);
  return { precoUnitario, total, custoTotal, valorBdi: total.minus(custoTotal) };
}

export interface TotaisOrcamento {
  custoDireto: Decimal;
  bdi: Decimal;
  total: Decimal;
  itensSemPreco: number;
}

export function totalizar(itens: Array<{ custoTotal: ValorDecimal | null; total: ValorDecimal | null }>): TotaisOrcamento {
  let custoDireto = ZERO;
  let total = ZERO;
  let semPreco = 0;
  for (const i of itens) {
    if (i.total === null || i.custoTotal === null) {
      semPreco++;
      continue;
    }
    custoDireto = custoDireto.plus(D(i.custoTotal));
    total = total.plus(D(i.total));
  }
  return { custoDireto, bdi: total.minus(custoDireto), total, itensSemPreco: semPreco };
}

/** Árvore de etapas → numeração hierárquica "1", "1.1", "1.1.2" */
export interface NoEtapa {
  id: string;
  pai_id: string | null;
  ordem: number;
}

export function numerarEtapas<T extends NoEtapa>(etapas: T[]): Map<string, string> {
  const filhos = new Map<string | null, T[]>();
  for (const e of etapas) {
    const lista = filhos.get(e.pai_id) ?? [];
    lista.push(e);
    filhos.set(e.pai_id, lista);
  }
  const numeros = new Map<string, string>();
  const visitar = (pai: string | null, prefixo: string, profundidade: number) => {
    if (profundidade > 20) throw new Error("Profundidade de etapas excedida (possível ciclo)");
    const lista = (filhos.get(pai) ?? []).slice().sort((a, b) => a.ordem - b.ordem);
    lista.forEach((e, i) => {
      const n = prefixo ? `${prefixo}.${i + 1}` : `${i + 1}`;
      numeros.set(e.id, n);
      visitar(e.id, n, profundidade + 1);
    });
  };
  visitar(null, "", 0);
  return numeros;
}

/** Ordena etapas em profundidade (pré-ordem), como aparecem no relatório. */
export function ordenarEtapasEmProfundidade<T extends NoEtapa>(etapas: T[]): T[] {
  const numeros = numerarEtapas(etapas);
  const chave = (id: string) =>
    (numeros.get(id) ?? "")
      .split(".")
      .map((p) => p.padStart(4, "0"))
      .join(".");
  return etapas.slice().sort((a, b) => (chave(a.id) < chave(b.id) ? -1 : chave(a.id) > chave(b.id) ? 1 : 0));
}

/** Percentual de um valor sobre o total, com `casas` decimais. */
export function percentualDe(valor: ValorDecimal, total: ValorDecimal, casas = 2): Decimal {
  const t = D(total);
  if (t.isZero()) return ZERO;
  return D(valor).div(t).times(CEM).toDecimalPlaces(casas, Decimal.ROUND_HALF_UP);
}

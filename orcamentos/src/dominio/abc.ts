import { CEM, D, Decimal, ZERO, type ValorDecimal } from "./decimal";

export interface EntradaAbc {
  chave: string;
  valor: ValorDecimal;
}

export interface LinhaAbc<T extends EntradaAbc> {
  entrada: T;
  posicao: number;
  valor: Decimal;
  percentual: Decimal;
  percentualAcumulado: Decimal;
  classe: "A" | "B" | "C";
}

/**
 * Curva ABC: ordena por valor decrescente e classifica pelo percentual acumulado.
 * Padrão usual em orçamentos de obras: A até 80%, B até 95%, C o restante — configurável.
 * Classe pelo percentual acumulado INCLUINDO o próprio item (acumulado ≤ 80% → A;
 * ≤ 95% → B; demais → C). O primeiro item é sempre A, mesmo que sozinho passe de 80%.
 */
export function curvaAbc<T extends EntradaAbc>(
  entradas: T[],
  limites: { a: ValorDecimal; b: ValorDecimal } = { a: 80, b: 95 },
): LinhaAbc<T>[] {
  // Agrupa entradas com a mesma chave (o mesmo insumo usado em vários serviços).
  const agrupado = new Map<string, { entrada: T; valor: Decimal }>();
  for (const e of entradas) {
    const atual = agrupado.get(e.chave);
    if (atual) atual.valor = atual.valor.plus(D(e.valor));
    else agrupado.set(e.chave, { entrada: e, valor: D(e.valor) });
  }
  const lista = [...agrupado.values()].sort((x, y) => {
    const c = y.valor.comparedTo(x.valor);
    return c !== 0 ? c : x.entrada.chave.localeCompare(y.entrada.chave);
  });
  const total = lista.reduce((s, x) => s.plus(x.valor), ZERO);
  const la = D(limites.a);
  const lb = D(limites.b);
  let acumulado = ZERO;
  return lista.map((x, i) => {
    const percentual = total.isZero() ? ZERO : x.valor.div(total).times(CEM);
    acumulado = acumulado.plus(percentual);
    const classe = i === 0 || acumulado.lte(la) ? "A" : acumulado.lte(lb) ? "B" : "C";
    return { entrada: x.entrada, posicao: i + 1, valor: x.valor, percentual, percentualAcumulado: acumulado, classe };
  });
}

import DecimalBase from "decimal.js";

/**
 * Decimal de alta precisão usado em TODOS os cálculos financeiros.
 * Nunca usar `number` para valores monetários, quantidades ou coeficientes.
 */
export const Decimal = DecimalBase.clone({ precision: 60, rounding: DecimalBase.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });
export type Decimal = InstanceType<typeof Decimal>;

export type ValorDecimal = Decimal | string | number | bigint | { toString(): string };

export type ModoArredondamento = "TRUNCAR" | "ARREDONDAR";

/** Converte para Decimal. Aceita Decimal, string ("1234.56"), inteiros e Prisma.Decimal. */
export function D(valor: ValorDecimal): Decimal {
  if (valor instanceof Decimal) return valor;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) throw new Error(`Número inválido: ${valor}`);
    // String(number) devolve a representação decimal mais curta, sem artefatos binários.
    return new Decimal(String(valor));
  }
  if (typeof valor === "bigint") return new Decimal(valor.toString());
  return new Decimal(valor.toString());
}

export const ZERO = new Decimal(0);
export const CEM = new Decimal(100);

/**
 * Ajusta para `casas` decimais.
 * TRUNCAR: descarta as casas excedentes (regra usada pela EMOP e pela Caixa/SINAPI).
 * ARREDONDAR: meio para cima (0,005 → 0,01).
 */
export function ajustar(valor: ValorDecimal, casas: number, modo: ModoArredondamento): Decimal {
  const v = D(valor);
  return v.toDecimalPlaces(casas, modo === "TRUNCAR" ? Decimal.ROUND_DOWN : Decimal.ROUND_HALF_UP);
}

export function truncar(valor: ValorDecimal, casas: number): Decimal {
  return ajustar(valor, casas, "TRUNCAR");
}

export function arredondar(valor: ValorDecimal, casas: number): Decimal {
  return ajustar(valor, casas, "ARREDONDAR");
}

export function somar(valores: Iterable<ValorDecimal>): Decimal {
  let total = ZERO;
  for (const v of valores) total = total.plus(D(v));
  return total;
}

/**
 * Converte texto numérico de arquivos oficiais para Decimal SEM perda.
 * Aceita "  208.83", "1.19650000", "-0.5". Retorna null para vazio.
 * Lança erro para conteúdo não numérico (ex.: "*****" de estouro em DBF).
 */
export function decimalDeTextoOficial(texto: string | null | undefined): Decimal | null {
  if (texto === null || texto === undefined) return null;
  const t = texto.trim();
  if (t === "") return null;
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t)) {
    throw new Error(`Valor numérico inválido: "${texto}"`);
  }
  return new Decimal(t);
}

/**
 * Converte texto digitado por usuário brasileiro ("1.234,56", "1234,56", "1234.56").
 * Retorna null se vazio; lança erro se inválido.
 */
export function decimalDeTextoBR(texto: string | null | undefined): Decimal | null {
  if (texto === null || texto === undefined) return null;
  let t = texto.trim().replace(/\s|R\$/g, "");
  if (t === "") return null;
  if (t.includes(",")) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // "1.234.567" sem vírgula = separador de milhar
    t = t.replace(/\./g, "");
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) throw new Error(`Número inválido: "${texto}"`);
  return new Decimal(t);
}

/** Casas decimais efetivamente presentes (sem zeros à direita). */
export function casasDecimais(valor: ValorDecimal): number {
  return D(valor).decimalPlaces();
}

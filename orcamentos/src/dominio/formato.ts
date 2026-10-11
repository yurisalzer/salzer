import { D, Decimal, type ValorDecimal } from "./decimal";

function agrupar(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Formata número no padrão brasileiro com casas fixas: 1234567.8 → "1.234.567,80". */
export function formatarNumero(valor: ValorDecimal | null | undefined, casas = 2): string {
  if (valor === null || valor === undefined) return "";
  // Valores monetários chegam aqui já ajustados pela regra do orçamento; a exibição só
  // arredonda valores com mais casas que o pedido (ex.: percentuais calculados).
  const texto = D(valor).toFixed(casas, Decimal.ROUND_HALF_UP);
  const negativo = texto.startsWith("-");
  const [inteiro, fracao] = (negativo ? texto.slice(1) : texto).split(".");
  const resultado = agrupar(inteiro ?? "0") + (fracao ? "," + fracao : "");
  return negativo && !/^[0,.]+$/.test(resultado) ? "-" + resultado : resultado;
}

/** "R$ 1.234,56" */
export function formatarMoeda(valor: ValorDecimal | null | undefined, casas = 2): string {
  if (valor === null || valor === undefined) return "—";
  return "R$ " + formatarNumero(valor, casas);
}

/** Exibe com as casas significativas do próprio valor (mínimo `minimo`). */
export function formatarDecimalVariavel(valor: ValorDecimal | null | undefined, minimo = 2, maximo = 10): string {
  if (valor === null || valor === undefined) return "";
  const d = D(valor);
  const casas = Math.min(Math.max(d.decimalPlaces(), minimo), maximo);
  return formatarNumero(d, casas);
}

/** 21.18 → "21,18%" */
export function formatarPercentual(valor: ValorDecimal | null | undefined, casas = 2): string {
  if (valor === null || valor === undefined) return "";
  return formatarNumero(valor, casas) + "%";
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Date (dia 1) → "jan/2026" */
export function formatarCompetencia(data: Date | string | null | undefined): string {
  if (!data) return "";
  const d = typeof data === "string" ? new Date(data) : data;
  return `${MESES[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}

export function formatarData(data: Date | string | null | undefined): string {
  if (!data) return "";
  const d = typeof data === "string" ? new Date(data) : data;
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function formatarDataHora(data: Date | string | null | undefined): string {
  if (!data) return "";
  const d = typeof data === "string" ? new Date(data) : data;
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

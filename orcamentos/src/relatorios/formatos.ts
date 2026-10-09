import { D, type Decimal } from "@/dominio/decimal";
import { formatarDecimalVariavel, formatarNumero, formatarPercentual } from "@/dominio/formato";
import type { Celula, FormatoColuna } from "./modelo";

export function textoCelula(c: Celula, f: FormatoColuna = "texto"): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "string") return c;
  const v = c as Decimal;
  switch (f) {
    case "moeda": return formatarNumero(v, 2);
    case "numero2": return formatarNumero(v, 2);
    case "numero4": return formatarNumero(v, 4);
    case "percentual": return formatarPercentual(v, 2);
    case "variavel": return formatarDecimalVariavel(v, 2, 8);
    default: return D(v).toString();
  }
}

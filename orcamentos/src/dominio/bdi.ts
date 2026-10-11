import { CEM, D, Decimal, ZERO, arredondar, type ValorDecimal } from "./decimal";

export const CODIGOS_PARCELA = ["AC", "S", "G", "SG", "R", "DF", "L", "PIS", "COFINS", "ISS", "CPRB", "OUTROS_TRIBUTOS"] as const;
export type CodigoParcela = (typeof CODIGOS_PARCELA)[number];

export const NOMES_PARCELA: Record<CodigoParcela, string> = {
  AC: "Administração central",
  S: "Seguro",
  G: "Garantia",
  SG: "Seguro e garantia",
  R: "Risco",
  DF: "Despesas financeiras",
  L: "Lucro / remuneração",
  PIS: "PIS",
  COFINS: "COFINS",
  ISS: "ISS",
  CPRB: "CPRB / INSS sobre a receita bruta (desoneração)",
  OUTROS_TRIBUTOS: "Outros tributos",
};

const GRUPO_ADMINISTRACAO: CodigoParcela[] = ["AC", "S", "G", "SG", "R"];
const GRUPO_TRIBUTOS: CodigoParcela[] = ["PIS", "COFINS", "ISS", "CPRB", "OUTROS_TRIBUTOS"];

export interface ParcelaBdi {
  codigo: CodigoParcela;
  /** Em pontos percentuais: 3 = 3% */
  percentual: ValorDecimal;
  nome?: string;
}

export interface ResultadoBdi {
  /** Fração exata (0,176792...) */
  fracao: Decimal;
  /** Percentual exato (17,6792...) */
  percentual: Decimal;
  /** Percentual com 2 casas (arredondamento matemático) — Catálogo EMOP 2.2.4 pede 2 casas */
  percentual2casas: Decimal;
  somaAdministracao: Decimal;
  despesasFinanceiras: Decimal;
  lucro: Decimal;
  tributos: Decimal;
}

/**
 * BDI pela fórmula do Acórdão TCU 2622/2013, adotada pela EMOP-RJ (Catálogo de Referência, item 2.3):
 *
 *   BDI = (1 + AC + S + R + G) × (1 + DF) × (1 + L) / (1 − T) − 1
 */
export function calcularBdi(parcelas: ParcelaBdi[]): ResultadoBdi {
  const vistos = new Set<string>();
  let adm = ZERO;
  let df = ZERO;
  let l = ZERO;
  let t = ZERO;
  for (const p of parcelas) {
    if (!CODIGOS_PARCELA.includes(p.codigo)) throw new Error(`Parcela de BDI desconhecida: ${p.codigo}`);
    if (vistos.has(p.codigo)) throw new Error(`Parcela de BDI repetida: ${p.codigo}`);
    vistos.add(p.codigo);
    const v = D(p.percentual);
    if (v.isNegative()) throw new Error(`Parcela ${p.codigo} não pode ser negativa`);
    const f = v.div(CEM);
    if (GRUPO_ADMINISTRACAO.includes(p.codigo)) adm = adm.plus(f);
    else if (p.codigo === "DF") df = df.plus(f);
    else if (p.codigo === "L") l = l.plus(f);
    else if (GRUPO_TRIBUTOS.includes(p.codigo)) t = t.plus(f);
  }
  if (vistos.has("SG") && (vistos.has("S") || vistos.has("G"))) {
    throw new Error("Use 'Seguro e garantia' (SG) ou as parcelas S e G separadas, não ambas");
  }
  if (t.gte(1)) throw new Error("A soma dos tributos deve ser menor que 100%");
  const fracao = new Decimal(1).plus(adm).times(new Decimal(1).plus(df)).times(new Decimal(1).plus(l)).div(new Decimal(1).minus(t)).minus(1);
  const percentual = fracao.times(CEM);
  return {
    fracao,
    percentual,
    percentual2casas: arredondar(percentual, 2),
    somaAdministracao: adm.times(CEM),
    despesasFinanceiras: df.times(CEM),
    lucro: l.times(CEM),
    tributos: t.times(CEM),
  };
}

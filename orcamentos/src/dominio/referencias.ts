import { CEM, D, Decimal, ZERO, truncar, type ValorDecimal } from "./decimal";

export type CodigoRegime = "SEM_DESONERACAO" | "COM_DESONERACAO" | "SEM_ENCARGOS" | "NAO_SE_APLICA";

export const NOMES_REGIME: Record<CodigoRegime, string> = {
  SEM_DESONERACAO: "Sem desoneração",
  COM_DESONERACAO: "Com desoneração",
  SEM_ENCARGOS: "Sem encargos sociais",
  NAO_SE_APLICA: "Não se aplica",
};

/**
 * EMOP-RJ — Catálogo de Referência 13ª ed. (jan/2026), "Caracterização das nomenclaturas", item 2,
 * e tópico 4 (desoneração): dígito final 0–4 = sem desoneração; A–E = com desoneração.
 * Dígitos 5/6 e F/G são reservados a itens criados pelo orçamentista/setor de custos.
 */
export function regimeEmopPorCodigo(codigo: string): CodigoRegime | null {
  const m = /^\d{2}\.\d{3}\.\d{4}-([0-9A-Z])$/.exec(codigo);
  if (!m) return null;
  const d = m[1]!;
  if ("01234".includes(d)) return "SEM_DESONERACAO";
  if ("ABCDE".includes(d)) return "COM_DESONERACAO";
  if (d === "5" || d === "6") return "SEM_DESONERACAO";
  if (d === "F" || d === "G") return "COM_DESONERACAO";
  return null;
}

/** "01.001.0075-1" → "0100100751" (forma usada no campo REUT.COMPOSICAO). */
export function codigoEmopSemPontuacao(codigo: string): string {
  return codigo.replace(/[.-]/g, "");
}

/** "0100100751" → "01.001.0075-1" */
export function codigoEmopComPontuacao(compacto: string): string | null {
  const m = /^(\d{2})(\d{3})(\d{4})([0-9A-Z])$/.exec(compacto);
  return m ? `${m[1]}.${m[2]}.${m[3]}-${m[4]}` : null;
}

export interface ComponenteEmop {
  quantidade: ValorDecimal;
  /** PERCENTUAL do COMP (ex.: perdas de 5%) */
  percentual: ValorDecimal;
  precoElementar: ValorDecimal;
}

/**
 * Reconstituição do custo EMOP a partir do COMP — USADA SOMENTE COMO VERIFICAÇÃO.
 * Verificada em jan/2026: Σ TRUNC(q × p × (1 + %/100); 4) truncado em 2 casas reproduz
 * 22.259 de 22.260 preços publicados (o restante difere R$ 0,01). O preço oficial publicado
 * é sempre o valor usado no orçamento.
 */
export function custoEmopReconstituido(componentes: ComponenteEmop[]): Decimal {
  let soma = ZERO;
  for (const c of componentes) {
    const linha = D(c.quantidade).times(D(c.precoElementar)).times(D(c.percentual).div(CEM).plus(1));
    soma = soma.plus(truncar(linha, 4));
  }
  return truncar(soma, 2);
}

export interface ComponenteSinapi {
  coeficiente: ValorDecimal;
  custoUnitario: ValorDecimal;
}

/**
 * SINAPI — custo de composição = Σ TRUNC(coeficiente × custo unitário; 2).
 * Fórmula presente na própria planilha oficial (aba "Analítico com Custo": TRUNC(E*F;2)) e
 * verificada em 6.431/6.431 composições RJ com todos os preços disponíveis (jan/2026).
 * Usada como verificação e para composições próprias que seguem o padrão SINAPI.
 */
export function custoSinapiReconstituido(componentes: ComponenteSinapi[]): Decimal {
  let soma = ZERO;
  for (const c of componentes) soma = soma.plus(truncar(D(c.coeficiente).times(D(c.custoUnitario)), 2));
  return soma;
}

/** Competência: "01/2026", "2026-01", "0126" (MMAA, EMOP) → Date UTC dia 1. */
export function lerCompetencia(texto: string): Date | null {
  const t = texto.trim();
  let m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return criarCompetencia(Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})(-01)?$/.exec(t);
  if (m) return criarCompetencia(Number(m[1]), Number(m[2]));
  m = /^(\d{2})(\d{2})$/.exec(t);
  if (m) return criarCompetencia(2000 + Number(m[2]), Number(m[1]));
  return null;
}

export function criarCompetencia(ano: number, mes: number): Date | null {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;
  return new Date(Date.UTC(ano, mes - 1, 1));
}

export function competenciaIso(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function mesmaCompetencia(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

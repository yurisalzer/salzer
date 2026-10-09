import type { Decimal } from "@/dominio/decimal";

export type FormatoColuna = "texto" | "moeda" | "numero2" | "numero4" | "variavel" | "percentual";

export interface Coluna {
  titulo: string;
  formato?: FormatoColuna;
  /** Largura relativa (PDF) / em caracteres (XLSX) */
  largura?: number;
}

export type Celula = string | Decimal | null;

export interface Linha {
  celulas: Celula[];
  estilo?: "normal" | "etapa" | "subtotal" | "total" | "titulo";
  nivel?: number;
}

export interface Tabela {
  titulo?: string;
  colunas: Coluna[];
  linhas: Linha[];
}

export interface Relatorio {
  /** Nome do arquivo sem extensão */
  arquivo: string;
  titulo: string;
  /** Identificação exigida em todos os relatórios: obra, orçamento, revisão, fontes, competência, regime, data */
  cabecalho: Array<[string, string]>;
  tabelas: Tabela[];
  notas: string[];
  paisagem?: boolean;
}

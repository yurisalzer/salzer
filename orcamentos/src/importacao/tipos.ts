import type { Assinatura } from "./assinatura";
import type { CodigoRegime } from "@/dominio/referencias";

/** Versão do importador gravada em cada lote (alterar quando regras de importação mudarem). */
export const IMPORTADOR_VERSAO = "1.0.0";

export type SiglaFonteOficial = "EMOP" | "SINAPI";
export type Severidade = "ERRO" | "AVISO" | "INFO";

export interface ArquivoEntrada {
  id: string; // arquivos_importacao.id
  nome: string; // nome do arquivo (sem diretórios)
  caminhoNoPacote: string; // ex.: "012026/COMP0126.dbf"
  caminhoDisco: string;
  sha256: string;
  assinatura: Assinatura;
  tamanho: number;
}

export interface ContextoImportacao {
  loteId: string;
  fonte: SiglaFonteOficial;
  uf: string;
  competencia: Date;
  regimes: CodigoRegime[];
}

export interface Verificacao {
  regra: string;
  severidade: Severidade;
  mensagem: string;
  arquivo?: string | null;
  linha?: number | null;
  codigo?: string | null;
  detalhes?: unknown;
}

export interface StgItem {
  arquivo: string;
  linha: number;
  tipo: "INSUMO" | "COMPOSICAO";
  codigo: string;
  descricao: string | null;
  unidade: string | null;
  classe?: string | null;
  grupo?: string | null;
  regime?: CodigoRegime | null;
  codigoComposicaoVinculada?: string | null;
}

export type SituacaoPreco = "INFORMADO" | "AUSENTE" | "SEM_CUSTO" | "SEM_PRECO";

export interface StgPreco {
  arquivo: string;
  linha: number;
  regime: CodigoRegime;
  tipo: "INSUMO" | "COMPOSICAO";
  codigo: string;
  precoTexto: string | null;
  /** Texto decimal exato (ou null quando não há preço) */
  preco: string | null;
  situacao: SituacaoPreco;
  origemPreco?: string | null;
  percentualAs?: string | null;
}

export interface StgComponente {
  arquivo: string;
  linha: number;
  codigoPai: string;
  ordem: number;
  sequencia?: string | null;
  tipoItem: "INSUMO" | "COMPOSICAO";
  codigoItem: string;
  coeficiente: string | null;
  coeficienteTexto: string | null;
  percentualPerda?: string | null;
  situacaoOrigem?: string | null;
}

export interface StgComposicao {
  arquivo: string;
  linha: number;
  codigo: string;
  situacao: string | null;
}

export interface StgAtributo {
  arquivo: string;
  linha: number;
  regime: CodigoRegime;
  tipo: "INSUMO" | "COMPOSICAO";
  codigo: string;
  atributo: "percentual_mao_obra";
  valor: string | null;
}

export interface StgManutencao {
  linha: number;
  referencia: Date | null;
  tipo: string | null;
  codigo: string | null;
  descricao: string | null;
  manutencao: string | null;
}

/** Para onde os adaptadores enviam os registros lidos (staging) e as verificações. */
export interface Destino {
  item(r: StgItem): Promise<void>;
  preco(r: StgPreco): Promise<void>;
  componente(r: StgComponente): Promise<void>;
  composicao(r: StgComposicao): Promise<void>;
  atributo(r: StgAtributo): Promise<void>;
  manutencao(r: StgManutencao): Promise<void>;
  verificacao(v: Verificacao): void;
  /** Registra papel/layout/nº de registros de um arquivo reconhecido. */
  arquivoReconhecido(arquivoId: string, papel: string, layout: string, registros: number | null): Promise<void>;
  metadado(chave: string, valor: unknown): void;
}

export interface ArquivoReconhecido {
  arquivo: ArquivoEntrada;
  papel: string;
  layout: string;
}

export interface Identificacao {
  reconhecidos: ArquivoReconhecido[];
  /** Papéis obrigatórios que não foram encontrados */
  faltando: string[];
  ignorados: Array<{ arquivo: ArquivoEntrada; motivo: string }>;
  /** Sugestões lidas dos arquivos (competência, rótulo de retificação, regimes) */
  sugestoes: { competencia?: Date; rotuloRevisao?: string; regimes?: CodigoRegime[]; dataEmissao?: Date };
}

export interface Adaptador {
  id: string;
  fonte: SiglaFonteOficial;
  descricao: string;
  identificar(arquivos: ArquivoEntrada[]): Promise<Identificacao>;
  ler(ctx: ContextoImportacao, identificacao: Identificacao, destino: Destino): Promise<void>;
}

export class ErroImportacao extends Error {}

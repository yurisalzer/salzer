import type { Prisma } from "@prisma/client";
import { prisma as prismaPadrao, type Tx } from "@/servidor/db";
import type {
  Destino, StgAtributo, StgComponente, StgComposicao, StgItem, StgManutencao, StgPreco, Verificacao,
} from "./tipos";

type Coluna = { nome: string; tipo: string };

/** Acumula linhas e grava em lotes com INSERT ... SELECT FROM unnest(arrays). */
class Buffer<T> {
  private linhas: T[] = [];
  total = 0;
  constructor(
    private readonly db: Tx,
    private readonly tabela: string,
    private readonly loteId: string,
    private readonly colunas: Coluna[],
    private readonly extrair: (r: T) => unknown[],
    private readonly tamanho = 2000,
  ) {}

  async adicionar(r: T): Promise<void> {
    this.linhas.push(r);
    this.total++;
    if (this.linhas.length >= this.tamanho) await this.gravar();
  }

  async gravar(): Promise<void> {
    if (this.linhas.length === 0) return;
    const arrays: unknown[][] = this.colunas.map(() => []);
    for (const r of this.linhas) {
      const v = this.extrair(r);
      v.forEach((x, i) => arrays[i]!.push(x === undefined || x === null ? null : typeof x === "string" ? x : String(x)));
    }
    this.linhas = [];
    const nomes = this.colunas.map((c) => c.nome);
    const params = this.colunas.map((_c, i) => `$${i + 2}::text[]`).join(", ");
    const selecao = this.colunas.map((c, i) => `u.c${i}::${c.tipo}`).join(", ");
    const alias = this.colunas.map((_c, i) => `c${i}`).join(", ");
    const sql = `INSERT INTO ${this.tabela} (lote_id, ${nomes.join(", ")})
      SELECT $1::uuid, ${selecao} FROM unnest(${params}) AS u(${alias})`;
    await this.db.$executeRawUnsafe(sql, this.loteId, ...arrays);
  }
}

const T = (nome: string, tipo = "text"): Coluna => ({ nome, tipo });

export class GravadorStaging implements Destino {
  readonly verificacoes: Verificacao[] = [];
  readonly metadados: Record<string, unknown> = {};
  private readonly itens: Buffer<StgItem>;
  private readonly precos: Buffer<StgPreco>;
  private readonly componentes: Buffer<StgComponente>;
  private readonly composicoes: Buffer<StgComposicao>;
  private readonly atributos: Buffer<StgAtributo>;
  private readonly manutencoes: Buffer<StgManutencao>;
  private readonly limiteVerificacoesPorRegra = 200;
  private readonly contagemPorRegra = new Map<string, number>();

  constructor(private readonly loteId: string, private readonly db: Tx = prismaPadrao) {
    this.itens = new Buffer(db, "stg_itens", loteId,
      [T("arquivo"), T("linha", "integer"), T("tipo"), T("codigo"), T("descricao"), T("unidade"), T("classe"), T("grupo"), T("regime_codigo"), T("codigo_composicao_vinculada")],
      (r) => [r.arquivo, r.linha, r.tipo, r.codigo, r.descricao, r.unidade, r.classe, r.grupo, r.regime, r.codigoComposicaoVinculada]);
    this.precos = new Buffer(db, "stg_precos", loteId,
      [T("arquivo"), T("linha", "integer"), T("regime_codigo"), T("tipo"), T("codigo"), T("preco_texto"), T("preco", "numeric"), T("situacao"), T("origem_preco"), T("percentual_as", "numeric")],
      (r) => [r.arquivo, r.linha, r.regime, r.tipo, r.codigo, r.precoTexto, r.preco, r.situacao, r.origemPreco, r.percentualAs]);
    this.componentes = new Buffer(db, "stg_componentes", loteId,
      [T("arquivo"), T("linha", "integer"), T("codigo_pai"), T("ordem", "integer"), T("sequencia"), T("tipo_item"), T("codigo_item"), T("coeficiente", "numeric"), T("coeficiente_texto"), T("percentual_perda", "numeric"), T("situacao_origem")],
      (r) => [r.arquivo, r.linha, r.codigoPai, r.ordem, r.sequencia, r.tipoItem, r.codigoItem, r.coeficiente, r.coeficienteTexto, r.percentualPerda, r.situacaoOrigem]);
    this.composicoes = new Buffer(db, "stg_composicoes", loteId,
      [T("arquivo"), T("linha", "integer"), T("codigo"), T("situacao")],
      (r) => [r.arquivo, r.linha, r.codigo, r.situacao]);
    this.atributos = new Buffer(db, "stg_atributos", loteId,
      [T("arquivo"), T("linha", "integer"), T("regime_codigo"), T("tipo"), T("codigo"), T("atributo"), T("valor", "numeric")],
      (r) => [r.arquivo, r.linha, r.regime, r.tipo, r.codigo, r.atributo, r.valor]);
    this.manutencoes = new Buffer(db, "stg_manutencoes", loteId,
      [T("linha", "integer"), T("referencia", "date"), T("tipo"), T("codigo"), T("descricao"), T("manutencao")],
      (r) => [r.linha, r.referencia ? r.referencia.toISOString().slice(0, 10) : null, r.tipo, r.codigo, r.descricao, r.manutencao]);
  }

  item(r: StgItem) { return this.itens.adicionar(r); }
  preco(r: StgPreco) { return this.precos.adicionar(r); }
  componente(r: StgComponente) { return this.componentes.adicionar(r); }
  composicao(r: StgComposicao) { return this.composicoes.adicionar(r); }
  atributo(r: StgAtributo) { return this.atributos.adicionar(r); }
  manutencao(r: StgManutencao) { return this.manutencoes.adicionar(r); }

  verificacao(v: Verificacao): void {
    const n = (this.contagemPorRegra.get(v.regra) ?? 0) + 1;
    this.contagemPorRegra.set(v.regra, n);
    // Evita relatórios gigantes: guarda as primeiras ocorrências e um resumo do total.
    if (n <= this.limiteVerificacoesPorRegra) this.verificacoes.push(v);
  }

  /** Ocorrências por regra, inclusive as que excederam o limite de detalhamento. */
  get totaisPorRegra(): Map<string, number> {
    return this.contagemPorRegra;
  }

  async arquivoReconhecido(arquivoId: string, papel: string, layout: string, registros: number | null): Promise<void> {
    await this.db.arquivos_importacao.update({ where: { id: arquivoId }, data: { papel, layout, registros } });
  }

  metadado(chave: string, valor: unknown): void {
    this.metadados[chave] = valor;
  }

  async finalizar(): Promise<Record<string, number>> {
    for (const b of [this.itens, this.precos, this.componentes, this.composicoes, this.atributos, this.manutencoes]) await b.gravar();
    return {
      stg_itens: this.itens.total,
      stg_precos: this.precos.total,
      stg_componentes: this.componentes.total,
      stg_composicoes: this.composicoes.total,
      stg_atributos: this.atributos.total,
      stg_manutencoes: this.manutencoes.total,
    };
  }
}

export async function limparStaging(loteId: string, db: Tx = prismaPadrao): Promise<void> {
  for (const t of ["stg_itens", "stg_precos", "stg_componentes", "stg_composicoes", "stg_atributos", "stg_manutencoes"]) {
    await db.$executeRawUnsafe(`DELETE FROM ${t} WHERE lote_id = $1::uuid`, loteId);
  }
}

export type JsonEntrada = Prisma.InputJsonValue;

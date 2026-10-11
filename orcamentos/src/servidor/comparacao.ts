import { carregarRevisao, type RevisaoCarregada } from "./dados-orcamento";
import { Decimal, ZERO } from "@/dominio/decimal";

export interface LinhaComparacao {
  chave: string;
  situacao: "INCLUIDO" | "EXCLUIDO" | "ALTERADO" | "IGUAL";
  etapa: string;
  fonte: string;
  codigo: string;
  descricao: string;
  unidade: string;
  qtdA: Decimal | null;
  qtdB: Decimal | null;
  precoA: Decimal | null;
  precoB: Decimal | null;
  totalA: Decimal | null;
  totalB: Decimal | null;
  diferenca: Decimal;
  referenciaA: string | null;
  referenciaB: string | null;
}

function indexar(r: RevisaoCarregada) {
  const titulos = new Map(r.etapas.map((e) => [e.id, e]));
  const caminho = (etapaId: string): string => {
    const e = titulos.get(etapaId)!;
    return e.paiId ? `${caminho(e.paiId)} › ${e.titulo}` : e.titulo;
  };
  const mapa = new Map<string, { i: RevisaoCarregada["itens"][number]; etapa: string }>();
  const contagem = new Map<string, number>();
  for (const i of r.itens) {
    const base = `${caminho(i.etapaId)}|${i.fonte}|${i.codigo}`;
    const n = (contagem.get(base) ?? 0) + 1;
    contagem.set(base, n);
    mapa.set(`${base}|${n}`, { i, etapa: caminho(i.etapaId) });
  }
  return mapa;
}

/** Compara duas revisões item a item (por etapa, fonte e código). */
export async function compararRevisoes(revisaoA: string, revisaoB: string) {
  const [a, b] = await Promise.all([carregarRevisao(revisaoA), carregarRevisao(revisaoB)]);
  const ia = indexar(a);
  const ib = indexar(b);
  const linhas: LinhaComparacao[] = [];
  for (const chave of new Set([...ia.keys(), ...ib.keys()])) {
    const x = ia.get(chave);
    const y = ib.get(chave);
    const ref = (x ?? y)!;
    const totalA = x?.i.total ?? null;
    const totalB = y?.i.total ?? null;
    const situacao = !x ? "INCLUIDO" : !y ? "EXCLUIDO"
      : x.i.quantidade.eq(y.i.quantidade) && (x.i.precoUnitario?.toString() ?? "") === (y.i.precoUnitario?.toString() ?? "") ? "IGUAL" : "ALTERADO";
    linhas.push({
      chave, situacao, etapa: ref.etapa, fonte: ref.i.fonte, codigo: ref.i.codigo, descricao: (y ?? x)!.i.descricao, unidade: ref.i.unidade,
      qtdA: x?.i.quantidade ?? null, qtdB: y?.i.quantidade ?? null, precoA: x?.i.precoUnitario ?? null, precoB: y?.i.precoUnitario ?? null,
      totalA, totalB, diferenca: (totalB ?? ZERO).minus(totalA ?? ZERO), referenciaA: x?.i.referencia ?? null, referenciaB: y?.i.referencia ?? null,
    });
  }
  linhas.sort((p, q) => p.etapa.localeCompare(q.etapa, "pt-BR") || p.codigo.localeCompare(q.codigo));
  return { a, b, linhas, diferencaTotal: b.totais.total.minus(a.totais.total) };
}

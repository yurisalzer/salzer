import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/servidor/sessao";
import { compararRevisoes } from "@/servidor/comparacao";
import { formatarDecimalVariavel, formatarMoeda, formatarNumero } from "@/dominio/formato";

export const dynamic = "force-dynamic";

const ROTULO = { INCLUIDO: "Incluído", EXCLUIDO: "Excluído", ALTERADO: "Alterado", IGUAL: "Igual" } as const;
const COR = { INCLUIDO: "text-emerald-700", EXCLUIDO: "text-red-700", ALTERADO: "text-amber-700", IGUAL: "text-slate-400" } as const;

export default async function Comparar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirUsuario("orcamentos.ver");
  const { id } = await params;
  const sp = await searchParams;
  if (!sp.a || !sp.b || !/^[0-9a-f-]{36}$/.test(sp.a) || !/^[0-9a-f-]{36}$/.test(sp.b)) notFound();
  const c = await compararRevisoes(sp.a, sp.b);
  if (c.a.orcamento.id !== id || c.b.orcamento.id !== id) notFound();
  const so = sp.todas ? c.linhas : c.linhas.filter((l) => l.situacao !== "IGUAL");
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase text-slate-500"><Link className="btn-link" href={`/orcamentos/${id}`}>{c.a.orcamento.nome}</Link></p>
        <h1 className="titulo-pagina">Comparativo: revisão {c.a.rev.numero} × revisão {c.b.rev.numero}</h1>
        <p className="text-sm">Total {formatarMoeda(c.a.totais.total)} → {formatarMoeda(c.b.totais.total)} · diferença <strong>{formatarMoeda(c.diferencaTotal)}</strong></p>
        <p className="text-xs text-slate-500">
          <a className="btn-link" href={`/api/relatorios/comparativo?revisao=${sp.a}&com=${sp.b}&formato=pdf`}>PDF</a> · <a className="btn-link" href={`/api/relatorios/comparativo?revisao=${sp.a}&com=${sp.b}&formato=xlsx`}>XLSX</a> ·{" "}
          {sp.todas ? <Link className="btn-link" href={`?a=${sp.a}&b=${sp.b}`}>só diferenças</Link> : <Link className="btn-link" href={`?a=${sp.a}&b=${sp.b}&todas=1`}>mostrar itens iguais</Link>}
        </p>
      </div>
      <section className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Situação</th><th>Etapa</th><th>Fonte</th><th>Código</th><th>Descrição</th><th className="num">Qtd. A</th><th className="num">Qtd. B</th><th className="num">P.U. A</th><th className="num">P.U. B</th><th className="num">Total A</th><th className="num">Total B</th><th className="num">Diferença</th></tr></thead>
          <tbody>
            {so.map((l) => (
              <tr key={l.chave}>
                <td className={`text-xs font-semibold ${COR[l.situacao]}`}>{ROTULO[l.situacao]}</td>
                <td className="text-xs">{l.etapa}</td><td className="text-xs">{l.fonte}</td><td className="font-mono text-xs">{l.codigo}</td><td>{l.descricao}</td>
                <td className="num">{l.qtdA ? formatarDecimalVariavel(l.qtdA, 2, 6) : ""}</td><td className="num">{l.qtdB ? formatarDecimalVariavel(l.qtdB, 2, 6) : ""}</td>
                <td className="num" title={l.referenciaA ?? ""}>{l.precoA ? formatarNumero(l.precoA) : ""}</td><td className="num" title={l.referenciaB ?? ""}>{l.precoB ? formatarNumero(l.precoB) : ""}</td>
                <td className="num">{l.totalA ? formatarNumero(l.totalA) : ""}</td><td className="num">{l.totalB ? formatarNumero(l.totalB) : ""}</td>
                <td className={`num ${l.diferenca.isNegative() ? "text-red-700" : l.diferenca.isZero() ? "" : "text-emerald-700"}`}>{formatarNumero(l.diferenca)}</td>
              </tr>
            ))}
            {so.length === 0 && <tr><td colSpan={12} className="text-slate-500">Nenhuma diferença entre as revisões.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

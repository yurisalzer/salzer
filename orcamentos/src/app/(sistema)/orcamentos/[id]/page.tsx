import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { formatarDataHora, formatarMoeda } from "@/dominio/formato";
import { Etiqueta } from "@/componentes/etiquetas";

export const dynamic = "force-dynamic";

export default async function Orcamento({ params }: { params: Promise<{ id: string }> }) {
  await exigirUsuario("orcamentos.ver");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const o = await prisma.orcamentos.findUnique({ where: { id }, include: { obras: true, revisoes_orcamento: { orderBy: { numero: "desc" }, include: { criador: true } } } });
  if (!o) notFound();
  const revs = o.revisoes_orcamento;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase text-slate-500"><Link className="btn-link" href={`/obras/${o.obra_id}`}>{o.obras.nome}</Link></p>
        <h1 className="titulo-pagina">{o.codigo ? `${o.codigo} — ` : ""}{o.nome}</h1>
      </div>
      <section className="cartao overflow-x-auto">
        <h2 className="mb-2 font-semibold">Revisões</h2>
        <table className="tabela">
          <thead><tr><th>Nº</th><th>Descrição</th><th>Situação</th><th className="num">Total</th><th>Criada</th><th>Fechada</th><th>Integridade</th></tr></thead>
          <tbody>
            {revs.map((r) => (
              <tr key={r.id}>
                <td><Link className="btn-link" href={`/orcamentos/${o.id}/revisoes/${r.id}`}>Revisão {r.numero}</Link></td>
                <td>{r.descricao}</td>
                <td><Etiqueta valor={r.status} /></td>
                <td className="num">{r.total_geral ? formatarMoeda(r.total_geral) : "—"}</td>
                <td className="text-xs">{formatarDataHora(r.criado_em)} {r.criador?.nome}</td>
                <td className="text-xs">{formatarDataHora(r.fechada_em)}</td>
                <td className="font-mono text-xs" title={r.hash_fechamento ?? ""}>{r.hash_fechamento?.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {revs.length > 1 && (
        <form action={`/orcamentos/${o.id}/comparar`} className="cartao flex flex-wrap items-end gap-3">
          <div><label className="rotulo">Comparar revisão</label><select name="a" className="campo" defaultValue={revs[1]!.id}>{revs.map((r) => <option key={r.id} value={r.id}>Revisão {r.numero}</option>)}</select></div>
          <div><label className="rotulo">com</label><select name="b" className="campo" defaultValue={revs[0]!.id}>{revs.map((r) => <option key={r.id} value={r.id}>Revisão {r.numero}</option>)}</select></div>
          <button className="btn-secundario">Comparar</button>
        </form>
      )}
    </div>
  );
}

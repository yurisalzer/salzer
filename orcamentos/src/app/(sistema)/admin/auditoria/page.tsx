import Link from "next/link";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { formatarDataHora } from "@/dominio/formato";

export const dynamic = "force-dynamic";

export default async function Auditoria({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirUsuario("auditoria.ver");
  const sp = await searchParams;
  const pagina = Math.max(1, Number(sp.p ?? "1") || 1);
  const where = {
    ...(sp.acao ? { acao: { contains: sp.acao.toUpperCase() } } : {}),
    ...(sp.entidade ? { entidade: sp.entidade } : {}),
    ...(sp.id && /^[0-9a-f-]{36}$/.test(sp.id) ? { entidade_id: sp.id } : {}),
  };
  const eventos = await prisma.auditoria.findMany({ where, include: { usuarios: true }, orderBy: { criado_em: "desc" }, take: 100, skip: (pagina - 1) * 100 });
  const entidades = await prisma.auditoria.groupBy({ by: ["entidade"], _count: true });
  const qs = (p: number) => new URLSearchParams({ ...(sp.acao ? { acao: sp.acao } : {}), ...(sp.entidade ? { entidade: sp.entidade } : {}), p: String(p) }).toString();
  return (
    <div className="space-y-4">
      <h1 className="titulo-pagina">Trilha de auditoria</h1>
      <p className="text-sm text-slate-500">Registro somente-inserção: o banco impede alterar ou apagar eventos.</p>
      <form className="cartao flex flex-wrap items-end gap-3">
        <div><label className="rotulo">Ação contém</label><input name="acao" defaultValue={sp.acao ?? ""} className="campo" placeholder="LOGIN, IMPORTACAO…" /></div>
        <div><label className="rotulo">Entidade</label>
          <select name="entidade" defaultValue={sp.entidade ?? ""} className="campo"><option value="">Todas</option>{entidades.map((e) => <option key={e.entidade} value={e.entidade}>{e.entidade} ({e._count})</option>)}</select>
        </div>
        <button className="btn-secundario">Filtrar</button>
      </form>
      <section className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhes</th><th>IP</th></tr></thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-xs">{formatarDataHora(e.criado_em)}</td>
                <td className="text-xs">{e.usuarios?.nome ?? "sistema/terminal"}</td>
                <td className="text-xs font-semibold">{e.acao}</td>
                <td className="text-xs">{e.entidade}{e.entidade_id && <> · <Link className="btn-link" href={`?id=${e.entidade_id}`}>{e.entidade_id.slice(0, 8)}</Link></>}</td>
                <td className="max-w-md break-all font-mono text-xs">{JSON.stringify(e.dados).slice(0, 300)}</td>
                <td className="text-xs">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex gap-2">
          {pagina > 1 && <Link className="btn-secundario" href={`?${qs(pagina - 1)}`}>Anterior</Link>}
          {eventos.length === 100 && <Link className="btn-secundario" href={`?${qs(pagina + 1)}`}>Próxima</Link>}
        </div>
      </section>
    </div>
  );
}

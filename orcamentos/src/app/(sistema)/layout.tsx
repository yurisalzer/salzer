import Link from "next/link";
import { exigirUsuario } from "@/servidor/sessao";
import { acaoSair } from "../acoes-sessao";
import type { Permissao } from "@/servidor/permissoes";

const MENU: Array<{ href: string; rotulo: string; permissao?: Permissao }> = [
  { href: "/", rotulo: "Início" },
  { href: "/obras", rotulo: "Obras e orçamentos", permissao: "orcamentos.ver" },
  { href: "/referencias", rotulo: "Consulta EMOP / SINAPI", permissao: "bases.consultar" },
  { href: "/composicoes", rotulo: "Composições próprias", permissao: "bases.consultar" },
  { href: "/bdi", rotulo: "Perfis de BDI", permissao: "orcamentos.ver" },
  { href: "/bases", rotulo: "Bases e importação", permissao: "bases.consultar" },
  { href: "/admin/usuarios", rotulo: "Usuários", permissao: "usuarios.gerenciar" },
  { href: "/admin/auditoria", rotulo: "Auditoria", permissao: "auditoria.ver" },
];

export default async function LayoutSistema({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-marca-800 text-slate-100 md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="px-4 py-4">
          <Link href="/" className="block text-base font-semibold text-white">Orçamentos de Obras</Link>
          <span className="text-xs text-marca-100">EMOP-RJ · SINAPI</span>
        </div>
        <nav className="flex flex-wrap gap-1 px-2 pb-3 md:flex-col md:flex-nowrap">
          {MENU.filter((m) => !m.permissao || u.permissoes.has(m.permissao)).map((m) => (
            <Link key={m.href} href={m.href} className="rounded px-3 py-1.5 text-sm text-slate-100 hover:bg-marca-700">
              {m.rotulo}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-marca-700 px-4 py-3 text-xs md:block">
          <div className="font-medium text-white">{u.nome}</div>
          <div className="truncate text-marca-100">{u.email}</div>
          <Link href="/conta" className="mt-2 block text-marca-100 underline hover:text-white">Minha conta</Link>
          <form action={acaoSair} className="mt-1">
            <button className="text-marca-100 underline hover:text-white" type="submit">Sair</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}

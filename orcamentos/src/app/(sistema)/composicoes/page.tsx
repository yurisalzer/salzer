import Link from "next/link";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { formatarDataHora } from "@/dominio/formato";

export const dynamic = "force-dynamic";

export default async function Composicoes() {
  const u = await exigirUsuario("bases.consultar");
  const itens = await prisma.itens_referencia.findMany({
    where: { fontes: { sigla: "PROPRIA" }, tipo: "COMPOSICAO" },
    include: { composicoes: { orderBy: { versao: "desc" }, take: 1 } },
    orderBy: { codigo: "asc" },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="titulo-pagina">Composições próprias</h1>
          <p className="text-sm text-slate-500">Composições criadas pelo orçamentista. São sempre identificadas como PRÓPRIAS — nunca como publicadas por EMOP ou SINAPI.</p>
        </div>
        {u.permissoes.has("composicoes.editar") && <Link className="btn-primario" href="/composicoes/nova">Nova composição</Link>}
      </div>
      <section className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Código</th><th>Descrição</th><th>Und.</th><th>Versão</th><th>Atualizada</th></tr></thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id}>
                <td className="font-mono text-xs"><Link className="btn-link" href={`/referencias/${i.id}`}>{i.codigo}</Link></td>
                <td>{i.descricao}</td><td>{i.unidade}</td><td>v{i.composicoes[0]?.versao ?? "—"}</td>
                <td className="text-xs">{formatarDataHora(i.composicoes[0]?.criada_em)}</td>
              </tr>
            ))}
            {itens.length === 0 && <tr><td colSpan={5} className="text-slate-500">Nenhuma composição própria. Crie uma nova ou use "Copiar como composição própria" na consulta de uma composição oficial.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

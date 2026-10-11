import Link from "next/link";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { formatarCompetencia, formatarDataHora } from "@/dominio/formato";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  const u = await exigirUsuario();
  const [publicadas, pendentes, revisoes] = await Promise.all([
    prisma.revisoes_base.findMany({
      where: { status: "PUBLICADA" },
      include: { bases_referencia: { include: { fontes: true } } },
      orderBy: [{ bases_referencia: { competencia: "desc" } }],
      take: 8,
    }),
    prisma.revisoes_base.count({ where: { status: "VALIDADA" } }),
    u.permissoes.has("orcamentos.ver")
      ? prisma.revisoes_orcamento.findMany({
          include: { orcamentos: { include: { obras: true } } },
          orderBy: { atualizado_em: "desc" },
          take: 8,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina">Olá, {u.nome.split(" ")[0]}</h1>
        <p className="text-sm text-slate-500">Resumo do sistema</p>
      </div>
      {pendentes > 0 && u.permissoes.has("bases.publicar") && (
        <p className="alerta-aviso">
          Há {pendentes} revisão(ões) de base importada(s) aguardando publicação. <Link className="btn-link" href="/bases">Revisar</Link>
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="cartao">
          <h2 className="mb-3 font-semibold">Bases publicadas</h2>
          {publicadas.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhuma base publicada ainda.{" "}
              {u.permissoes.has("importacao.executar") && <Link className="btn-link" href="/importacoes/nova">Importar arquivos oficiais</Link>}
            </p>
          ) : (
            <table className="tabela">
              <thead><tr><th>Fonte</th><th>UF</th><th>Competência</th><th>Revisão</th></tr></thead>
              <tbody>
                {publicadas.map((r) => (
                  <tr key={r.id}>
                    <td>{r.bases_referencia.fontes.sigla}</td>
                    <td>{r.bases_referencia.uf}</td>
                    <td>{formatarCompetencia(r.bases_referencia.competencia)}</td>
                    <td>{r.rotulo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {u.permissoes.has("orcamentos.ver") && (
          <section className="cartao">
            <h2 className="mb-3 font-semibold">Orçamentos recentes</h2>
            {revisoes.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum orçamento ainda. <Link className="btn-link" href="/obras">Criar obra</Link></p>
            ) : (
              <table className="tabela">
                <thead><tr><th>Obra / orçamento</th><th>Rev.</th><th>Situação</th><th>Atualizado</th></tr></thead>
                <tbody>
                  {revisoes.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link className="btn-link" href={`/orcamentos/${r.orcamento_id}/revisoes/${r.id}`}>{r.orcamentos.nome}</Link>
                        <div className="text-xs text-slate-500">{r.orcamentos.obras.nome}</div>
                      </td>
                      <td>{r.numero}</td>
                      <td>{r.status === "FECHADA" ? "Fechada" : "Aberta"}</td>
                      <td className="text-xs">{formatarDataHora(r.atualizado_em)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

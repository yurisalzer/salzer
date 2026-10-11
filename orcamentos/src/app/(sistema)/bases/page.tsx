import Link from "next/link";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { formatarCompetencia, formatarDataHora, formatarNumero } from "@/dominio/formato";
import { NOMES_REGIME, type CodigoRegime } from "@/dominio/referencias";
import { Etiqueta } from "@/componentes/etiquetas";

export const dynamic = "force-dynamic";

export default async function PaginaBases() {
  const u = await exigirUsuario("bases.consultar");
  const [revisoes, lotes, espaco] = await Promise.all([
    prisma.revisoes_base.findMany({
      include: { bases_referencia: { include: { fontes: true } }, _count: { select: { precos_referencia: true } } },
      orderBy: [{ bases_referencia: { competencia: "desc" } }, { numero: "desc" }],
      take: 100,
    }),
    prisma.lotes_importacao.findMany({ include: { fontes: true, usuarios: true }, orderBy: { criado_em: "desc" }, take: 30 }),
    prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`,
  ]);
  const mb = Number(espaco[0]?.bytes ?? 0) / 1024 / 1024;
  const limite = Number(process.env.LIMITE_BANCO_MB ?? "512");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="titulo-pagina">Bases de referência</h1>
          <p className="text-sm text-slate-500">Publicações mensais EMOP e SINAPI, retificações e importações</p>
        </div>
        {u.permissoes.has("importacao.executar") && <Link href="/importacoes/nova" className="btn-primario">Importar nova base</Link>}
      </div>

      <p className={mb / limite > 0.7 ? "alerta-aviso" : "alerta-info"}>
        Espaço ocupado no banco: <strong>{formatarNumero(mb, 0)} MB</strong> de {limite} MB ({formatarNumero((mb / limite) * 100, 0)}%).
        {mb / limite > 0.7 && " Acima de 70%: avalie remover revisões rejeitadas, importar menos regimes ou contratar mais espaço."}
      </p>

      <section className="cartao overflow-x-auto">
        <h2 className="mb-2 font-semibold">Revisões das bases</h2>
        <table className="tabela">
          <thead><tr><th>Fonte</th><th>UF</th><th>Competência</th><th>Nº</th><th>Publicação</th><th>Regimes</th><th className="num">Preços</th><th>Situação</th><th>Publicada em</th><th></th></tr></thead>
          <tbody>
            {revisoes.map((r) => (
              <tr key={r.id}>
                <td>{r.bases_referencia.fontes.sigla}</td>
                <td>{r.bases_referencia.uf}</td>
                <td>{formatarCompetencia(r.bases_referencia.competencia)}</td>
                <td>{r.numero}</td>
                <td>{r.rotulo}</td>
                <td className="text-xs">{r.regimes.map((x) => NOMES_REGIME[x as CodigoRegime] ?? x).join(", ")}</td>
                <td className="num">{formatarNumero(r._count.precos_referencia, 0)}</td>
                <td><Etiqueta valor={r.status} /></td>
                <td className="text-xs">{formatarDataHora(r.publicada_em)}</td>
                <td>{r.lote_id && <Link className="btn-link text-xs" href={`/importacoes/${r.lote_id}`}>detalhes</Link>}</td>
              </tr>
            ))}
            {revisoes.length === 0 && <tr><td colSpan={10} className="text-slate-500">Nenhuma base importada.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="cartao overflow-x-auto">
        <h2 className="mb-2 font-semibold">Importações recentes</h2>
        <table className="tabela">
          <thead><tr><th>Data</th><th>Fonte</th><th>Competência</th><th>Publicação</th><th>Usuário</th><th>Situação</th><th className="num">Erros</th><th className="num">Avisos</th><th></th></tr></thead>
          <tbody>
            {lotes.map((l) => {
              const c = (l.contagens ?? {}) as Record<string, number>;
              return (
                <tr key={l.id}>
                  <td className="text-xs">{formatarDataHora(l.criado_em)}</td>
                  <td>{l.fontes.sigla}</td>
                  <td>{formatarCompetencia(l.competencia)}</td>
                  <td>{l.rotulo_revisao}</td>
                  <td className="text-xs">{l.usuarios?.nome ?? "terminal"}</td>
                  <td><Etiqueta valor={l.status} /></td>
                  <td className="num">{c.erros ?? (l.status === "FALHOU" ? 1 : "")}</td>
                  <td className="num">{c.avisos ?? ""}</td>
                  <td><Link className="btn-link text-xs" href={`/importacoes/${l.id}`}>abrir</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

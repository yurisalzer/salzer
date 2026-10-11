import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { revisoesPublicadas } from "@/servidor/consultas";
import { formatarMoeda } from "@/dominio/formato";
import { FormAcao } from "@/componentes/form-acao";
import { Etiqueta } from "@/componentes/etiquetas";
import { SeletorBases } from "@/componentes/seletor-bases";
import { acaoCriarOrcamento } from "../../orcamentos/acoes";

export const dynamic = "force-dynamic";

export default async function Obra({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario("orcamentos.ver");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const obra = await prisma.obras.findUnique({
    where: { id },
    include: { orcamentos: { include: { revisoes_orcamento: { orderBy: { numero: "desc" }, take: 1 } }, orderBy: { criado_em: "desc" } } },
  });
  if (!obra) notFound();
  const [revisoes, perfis] = await Promise.all([revisoesPublicadas(), prisma.perfis_bdi.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } })]);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase text-slate-500"><Link className="btn-link" href="/obras">Obras</Link></p>
        <h1 className="titulo-pagina">{obra.nome}</h1>
        <p className="text-sm text-slate-500">{[obra.cliente, obra.municipio && `${obra.municipio}/${obra.uf}`, obra.endereco].filter(Boolean).join(" · ")}</p>
      </div>
      <section className="cartao overflow-x-auto">
        <h2 className="mb-2 font-semibold">Orçamentos</h2>
        <table className="tabela">
          <thead><tr><th>Código</th><th>Orçamento</th><th>Última revisão</th><th>Situação</th><th className="num">Total fechado</th></tr></thead>
          <tbody>
            {obra.orcamentos.map((o) => {
              const r = o.revisoes_orcamento[0];
              return (
                <tr key={o.id}>
                  <td>{o.codigo}</td>
                  <td><Link className="btn-link" href={`/orcamentos/${o.id}`}>{o.nome}</Link></td>
                  <td>{r && <Link className="btn-link" href={`/orcamentos/${o.id}/revisoes/${r.id}`}>Revisão {r.numero}</Link>}</td>
                  <td>{r && <Etiqueta valor={r.status} />}</td>
                  <td className="num">{r?.total_geral ? formatarMoeda(r.total_geral) : ""}</td>
                </tr>
              );
            })}
            {obra.orcamentos.length === 0 && <tr><td colSpan={5} className="text-slate-500">Nenhum orçamento.</td></tr>}
          </tbody>
        </table>
      </section>
      {u.permissoes.has("orcamentos.editar") && (
        <section className="cartao">
          <h2 className="mb-3 font-semibold">Novo orçamento</h2>
          {revisoes.length === 0 ? (
            <p className="alerta-aviso">Nenhuma base publicada. Importe e publique uma base EMOP ou SINAPI antes de orçar.</p>
          ) : (
            <FormAcao acao={acaoCriarOrcamento} campos={{ obraId: obra.id }} className="grid gap-3 md:grid-cols-4">
              <div><label className="rotulo">Código</label><input name="codigo" className="campo" placeholder="opcional" /></div>
              <div className="md:col-span-3"><label className="rotulo">Nome do orçamento</label><input name="nome" className="campo" required /></div>
              <SeletorBases revisoes={revisoes} />
              <div className="md:col-span-2">
                <label className="rotulo">BDI padrão (perfil)</label>
                <select name="perfil" className="campo" defaultValue="">
                  <option value="">Informar percentual →</option>
                  {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.percentual_adotado?.toString()}%)</option>)}
                </select>
              </div>
              <div><label className="rotulo">ou BDI (%)</label><input name="bdi_percentual" className="campo" placeholder="ex.: 25,00" /></div>
              <div>
                <label className="rotulo">Ajuste de valores</label>
                <select name="modo" className="campo" defaultValue="TRUNCAR"><option value="TRUNCAR">Truncar (padrão EMOP/SINAPI)</option><option value="ARREDONDAR">Arredondar</option></select>
              </div>
              <div><label className="rotulo">Prazo (meses)</label><input name="prazo" type="number" min={1} max={120} className="campo" /></div>
              <div className="md:col-span-4"><button className="btn-primario">Criar orçamento</button></div>
            </FormAcao>
          )}
        </section>
      )}
    </div>
  );
}

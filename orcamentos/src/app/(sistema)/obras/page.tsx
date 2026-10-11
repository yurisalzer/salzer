import Link from "next/link";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { formatarDataHora } from "@/dominio/formato";
import { FormAcao } from "@/componentes/form-acao";
import { acaoCriarObra } from "../orcamentos/acoes";

export const dynamic = "force-dynamic";

export default async function Obras() {
  const u = await exigirUsuario("orcamentos.ver");
  const obras = await prisma.obras.findMany({ include: { _count: { select: { orcamentos: true } } }, orderBy: { atualizado_em: "desc" } });
  return (
    <div className="space-y-4">
      <h1 className="titulo-pagina">Obras e orçamentos</h1>
      <section className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Obra</th><th>Cliente</th><th>Município</th><th className="num">Orçamentos</th><th>Criada</th></tr></thead>
          <tbody>
            {obras.map((o) => (
              <tr key={o.id}>
                <td><Link className="btn-link" href={`/obras/${o.id}`}>{o.nome}</Link></td>
                <td>{o.cliente}</td><td>{o.municipio}/{o.uf}</td><td className="num">{o._count.orcamentos}</td><td className="text-xs">{formatarDataHora(o.criado_em)}</td>
              </tr>
            ))}
            {obras.length === 0 && <tr><td colSpan={5} className="text-slate-500">Nenhuma obra cadastrada.</td></tr>}
          </tbody>
        </table>
      </section>
      {u.permissoes.has("orcamentos.editar") && (
        <section className="cartao">
          <h2 className="mb-3 font-semibold">Nova obra</h2>
          <FormAcao acao={acaoCriarObra} className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2"><label className="rotulo">Nome da obra</label><input name="nome" className="campo" required /></div>
            <div><label className="rotulo">Cliente / órgão</label><input name="cliente" className="campo" /></div>
            <div><label className="rotulo">Município (RJ)</label><input name="municipio" className="campo" /></div>
            <div className="md:col-span-2"><label className="rotulo">Endereço</label><input name="endereco" className="campo" /></div>
            <div className="md:col-span-2"><label className="rotulo">Descrição</label><input name="descricao" className="campo" /></div>
            <div><button className="btn-primario">Criar obra</button></div>
          </FormAcao>
        </section>
      )}
    </div>
  );
}

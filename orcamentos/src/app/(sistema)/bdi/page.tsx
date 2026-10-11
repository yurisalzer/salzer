import Link from "next/link";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { calcularBdi, type CodigoParcela } from "@/dominio/bdi";
import { formatarPercentual } from "@/dominio/formato";
import { NOMES_REGIME, type CodigoRegime } from "@/dominio/referencias";
import { BotaoAcao } from "@/componentes/botao-acao";
import { acaoAlternarPerfil } from "./acoes";

export const dynamic = "force-dynamic";

export default async function Bdi() {
  const u = await exigirUsuario("orcamentos.ver");
  const perfis = await prisma.perfis_bdi.findMany({ include: { parcelas_bdi: { orderBy: { ordem: "asc" } } }, orderBy: [{ ativo: "desc" }, { nome: "asc" }] });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="titulo-pagina">Perfis de BDI</h1>
          <p className="text-sm text-slate-500">BDI = (1 + AC + S + R + G) × (1 + DF) × (1 + L) / (1 − T) − 1 (Acórdão TCU 2622/2013; Catálogo EMOP item 2.3). Orçamentos guardam uma cópia congelada do perfil usado.</p>
        </div>
        {u.permissoes.has("bdi.editar") && <Link href="/bdi/novo" className="btn-primario">Novo perfil</Link>}
      </div>
      <section className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Perfil</th><th>Regime</th><th>Parcelas</th><th className="num">Calculado</th><th className="num">Adotado</th><th>Fonte</th>{u.permissoes.has("bdi.editar") && <th />}</tr></thead>
          <tbody>
            {perfis.map((p) => {
              const calc = p.parcelas_bdi.length ? calcularBdi(p.parcelas_bdi.map((x) => ({ codigo: x.codigo as CodigoParcela, percentual: x.percentual.toString() }))) : null;
              return (
                <tr key={p.id} id={`p-${p.id}`} className={p.ativo ? "" : "text-slate-400"}>
                  <td>{p.nome}</td>
                  <td className="text-xs">{p.regime_codigo ? NOMES_REGIME[p.regime_codigo as CodigoRegime] : ""}</td>
                  <td className="text-xs">{p.parcelas_bdi.map((x) => `${x.codigo} ${formatarPercentual(x.percentual)}`).join(" · ")}</td>
                  <td className="num">{calc ? formatarPercentual(calc.percentual) : ""}</td>
                  <td className="num font-semibold">{p.percentual_adotado !== null ? formatarPercentual(p.percentual_adotado) : ""}</td>
                  <td className="text-xs">{p.fonte_documento}</td>
                  {u.permissoes.has("bdi.editar") && (
                    <td><BotaoAcao acao={acaoAlternarPerfil} campos={{ id: p.id, ativo: p.ativo ? "0" : "1" }} rotulo={p.ativo ? "Desativar" : "Ativar"} classe="text-xs btn-link" /></td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

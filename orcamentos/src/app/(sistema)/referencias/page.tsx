import Link from "next/link";
import { exigirUsuario } from "@/servidor/sessao";
import { buscarItens, revisoesPublicadas } from "@/servidor/consultas";
import { formatarCompetencia, formatarDecimalVariavel } from "@/dominio/formato";
import { NOMES_REGIME, type CodigoRegime } from "@/dominio/referencias";
import { Etiqueta } from "@/componentes/etiquetas";

export const dynamic = "force-dynamic";

export default async function Referencias({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await exigirUsuario("bases.consultar");
  const sp = await searchParams;
  const revisoes = await revisoesPublicadas(undefined, true);
  const porFonte = (f: string) => revisoes.filter((r) => r.fonte === f);
  const padrao = (f: string) => porFonte(f).find((r) => r.status === "PUBLICADA")?.id ?? "";
  // Compatibilidade com link "?revisao=" vindo da página de importação
  const revDireta = revisoes.find((r) => r.id === sp.revisao);
  const emop = sp.emop ?? (revDireta?.fonte === "EMOP" ? revDireta.id : padrao("EMOP"));
  const sinapi = sp.sinapi ?? (revDireta?.fonte === "SINAPI" ? revDireta.id : padrao("SINAPI"));
  const fonte = sp.fonte ?? "TODAS";
  const regime = (sp.regime as CodigoRegime) ?? "SEM_DESONERACAO";
  const tipo = sp.tipo === "INSUMO" || sp.tipo === "COMPOSICAO" ? sp.tipo : undefined;
  const pagina = Math.max(1, Number(sp.p ?? "1") || 1);
  const q = sp.q ?? "";
  const ids = [fonte === "TODAS" || fonte === "EMOP" ? emop : "", fonte === "TODAS" || fonte === "SINAPI" ? sinapi : ""].filter(Boolean);
  const resultado = q || sp.buscar
    ? await buscarItens({ texto: q, revisoes: ids, regime, tipo, incluirProprios: fonte === "TODAS" || fonte === "PROPRIA", limite: 50, deslocamento: (pagina - 1) * 50 })
    : [];
  const rotuloRev = (id: string) => {
    const r = revisoes.find((x) => x.id === id);
    return r ? `${r.fonte} ${formatarCompetencia(r.competencia)} — ${r.rotulo}${r.status === "SUBSTITUIDA" ? " (substituída)" : ""}` : "";
  };
  const qs = (extra: Record<string, string>) => new URLSearchParams({ q, fonte, regime, emop, sinapi, ...(tipo ? { tipo } : {}), buscar: "1", ...extra }).toString();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="titulo-pagina">Consulta de serviços e insumos</h1>
        <p className="text-sm text-slate-500">Pesquise por código (ex.: 01.001.0001, 104658) ou por palavras da descrição.</p>
      </div>
      <form className="cartao grid gap-3 md:grid-cols-6">
        <input type="hidden" name="buscar" value="1" />
        <div className="md:col-span-2">
          <label className="rotulo">Código ou descrição</label>
          <input name="q" defaultValue={q} className="campo" placeholder="ex.: concreto fck 25" autoFocus />
        </div>
        <div>
          <label className="rotulo">Fonte</label>
          <select name="fonte" defaultValue={fonte} className="campo">
            <option value="TODAS">Todas</option><option value="EMOP">EMOP</option><option value="SINAPI">SINAPI</option><option value="PROPRIA">Próprias</option>
          </select>
        </div>
        <div>
          <label className="rotulo">Tipo</label>
          <select name="tipo" defaultValue={tipo ?? ""} className="campo">
            <option value="">Todos</option><option value="COMPOSICAO">Serviços/composições</option><option value="INSUMO">Insumos</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="rotulo">Regime</label>
          <select name="regime" defaultValue={regime} className="campo">
            {Object.entries(NOMES_REGIME).filter(([k]) => k !== "NAO_SE_APLICA").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="rotulo">Base EMOP</label>
          <select name="emop" defaultValue={emop} className="campo">
            {porFonte("EMOP").map((r) => <option key={r.id} value={r.id}>{rotuloRev(r.id)}</option>)}
            {porFonte("EMOP").length === 0 && <option value="">Nenhuma base publicada</option>}
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="rotulo">Base SINAPI (RJ)</label>
          <select name="sinapi" defaultValue={sinapi} className="campo">
            {porFonte("SINAPI").map((r) => <option key={r.id} value={r.id}>{rotuloRev(r.id)}</option>)}
            {porFonte("SINAPI").length === 0 && <option value="">Nenhuma base publicada</option>}
          </select>
        </div>
        <div className="md:col-span-6"><button className="btn-primario">Pesquisar</button></div>
      </form>

      {(q || sp.buscar) && (
        <section className="cartao overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Fonte</th><th>Código</th><th>Descrição</th><th>Und.</th><th>Tipo</th><th className="num">Preço ({NOMES_REGIME[regime]})</th><th>Situação</th></tr></thead>
            <tbody>
              {resultado.map((r) => (
                <tr key={`${r.id}-${r.revisao_base_id}`}>
                  <td>{r.fonte}</td>
                  <td className="whitespace-nowrap font-mono text-xs">
                    <Link className="btn-link" href={`/referencias/${r.id}?${new URLSearchParams({ ...(r.revisao_base_id ? { revisao: r.revisao_base_id } : {}), regime }).toString()}`}>{r.codigo}</Link>
                  </td>
                  <td>{r.descricao}{r.tem_composicao && <span className="ml-1 text-xs text-marca-600">[composição]</span>}</td>
                  <td>{r.unidade}</td>
                  <td className="text-xs">{r.tipo === "INSUMO" ? "Insumo" : "Composição"}</td>
                  <td className="num">{r.preco !== null ? formatarDecimalVariavel(r.preco, 2, 4) : ""}</td>
                  <td>{r.situacao ? <Etiqueta valor={r.situacao} /> : r.fonte === "PROPRIA" ? <Etiqueta valor="PROPRIA" texto="Própria" /> : ""}</td>
                </tr>
              ))}
              {resultado.length === 0 && <tr><td colSpan={7} className="text-slate-500">Nada encontrado nesta base/regime.</td></tr>}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2 text-sm">
            {pagina > 1 && <Link className="btn-secundario" href={`?${qs({ p: String(pagina - 1) })}`}>Anterior</Link>}
            {resultado.length === 50 && <Link className="btn-secundario" href={`?${qs({ p: String(pagina + 1) })}`}>Próxima</Link>}
          </div>
        </section>
      )}
    </div>
  );
}

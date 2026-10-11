import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { composicaoAnalitica, historicoPrecos, ondeEUsado, precoDoItem, revisoesPublicadas } from "@/servidor/consultas";
import { custoComposicaoPropria } from "@/servidor/composicoes-proprias";
import { D } from "@/dominio/decimal";
import { formatarCompetencia, formatarDecimalVariavel, formatarMoeda, formatarNumero, formatarPercentual } from "@/dominio/formato";
import { NOMES_REGIME, type CodigoRegime } from "@/dominio/referencias";
import { Etiqueta } from "@/componentes/etiquetas";
import { BotaoAcao } from "@/componentes/botao-acao";
import { acaoCopiarComoPropria } from "../../composicoes/acoes";

export const dynamic = "force-dynamic";

function GraficoHistorico({ pontos }: { pontos: Array<{ rotulo: string; valor: number }> }) {
  if (pontos.length < 2) return null;
  const w = 560, h = 140, m = 30;
  const vals = pontos.map((p) => p.valor);
  const min = Math.min(...vals), max = Math.max(...vals);
  const esc = (v: number) => (max === min ? h / 2 : h - m / 2 - ((v - min) / (max - min)) * (h - m));
  const x = (i: number) => m + (i * (w - 2 * m)) / (pontos.length - 1);
  const d = pontos.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${esc(p.valor).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-xl" role="img" aria-label="Evolução do preço">
      <path d={d} fill="none" stroke="#1d5fa8" strokeWidth={2} />
      {pontos.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={esc(p.valor)} r={3} fill="#1d5fa8" />
          <text x={x(i)} y={h - 2} fontSize={9} textAnchor="middle" fill="#64748b">{p.rotulo}</text>
        </g>
      ))}
    </svg>
  );
}

export default async function DetalheItem({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await exigirUsuario("bases.consultar");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const item = await prisma.itens_referencia.findUnique({ where: { id }, include: { fontes: true } });
  if (!item) notFound();
  const fonte = item.fontes.sigla;
  const regime = (sp.regime as CodigoRegime) ?? item.regime_codigo ?? "SEM_DESONERACAO";

  if (fonte === "PROPRIA") {
    const versoes = await prisma.composicoes.findMany({ where: { item_id: id }, orderBy: { versao: "desc" }, include: { usuarios: true } });
    const atual = versoes[0];
    const custo = atual ? await custoComposicaoPropria(atual.id) : null;
    return (
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase text-amber-700">Composição PRÓPRIA — não publicada por fonte oficial</p>
          <h1 className="titulo-pagina">{item.codigo} — {item.descricao}</h1>
          <p className="text-sm text-slate-500">Unidade: {item.unidade} · versão {atual?.versao ?? "—"}</p>
          {atual?.observacao && <p className="text-sm text-slate-600">{atual.observacao}</p>}
        </div>
        {u.permissoes.has("composicoes.editar") && <Link className="btn-secundario" href={`/composicoes/editar/${id}`}>Editar (cria nova versão)</Link>}
        {custo && (
          <section className="cartao overflow-x-auto">
            <h2 className="mb-2 font-semibold">Composição analítica (regra: Σ TRUNC(coeficiente × custo; 2))</h2>
            <table className="tabela">
              <thead><tr><th>Fonte</th><th>Código</th><th>Descrição</th><th>Und.</th><th className="num">Coeficiente</th><th className="num">Custo unit.</th><th className="num">Custo parcial</th><th>Origem do preço</th></tr></thead>
              <tbody>
                {custo.linhas.map((l) => (
                  <tr key={l.ordem}>
                    <td>{l.fonte}</td>
                    <td className="font-mono text-xs">{l.item_id ? <Link className="btn-link" href={`/referencias/${l.item_id}?${l.revisao_base_id ? `revisao=${l.revisao_base_id}&` : ""}regime=${l.regime_codigo ?? regime}`}>{l.codigo}</Link> : l.codigo}</td>
                    <td>{l.descricao}</td><td>{l.unidade}</td>
                    <td className="num">{formatarDecimalVariavel(l.coeficiente, 4, 10)}</td>
                    <td className="num">{l.custoUnitario ? formatarDecimalVariavel(l.custoUnitario, 2, 4) : <Etiqueta valor="SEM_PRECO" />}</td>
                    <td className="num">{l.valor ? formatarNumero(l.valor) : ""}</td>
                    <td className="text-xs">{l.origemPreco}</td>
                  </tr>
                ))}
                <tr className="font-semibold"><td colSpan={6} className="text-right">Custo unitário</td><td className="num">{custo.custo ? formatarMoeda(custo.custo) : "sem preço"}</td><td /></tr>
              </tbody>
            </table>
          </section>
        )}
        <section className="cartao">
          <h2 className="mb-2 font-semibold">Versões</h2>
          <ul className="text-sm">{versoes.map((v) => <li key={v.id}>v{v.versao} — {v.criada_em.toLocaleString("pt-BR")} — {v.usuarios?.nome ?? ""}</li>)}</ul>
        </section>
      </div>
    );
  }

  const revisoes = (await revisoesPublicadas(undefined, true)).filter((r) => r.fonte === fonte);
  const historico = await historicoPrecos(id);
  const revisaoId = sp.revisao ?? historico.filter((h) => h.status === "PUBLICADA").at(-1)?.revisao_base_id ?? revisoes[0]?.id ?? "";
  const [preco, analitica, usos] = revisaoId
    ? await Promise.all([precoDoItem(id, revisaoId, regime), composicaoAnalitica(id, revisaoId, regime), item.tipo === "INSUMO" ? ondeEUsado(id, revisaoId) : Promise.resolve([])])
    : [null, null, []];
  const vinculado = item.codigo_composicao_vinculada
    ? await prisma.itens_referencia.findFirst({ where: { fonte_id: item.fonte_id, tipo: "COMPOSICAO", codigo: item.codigo_composicao_vinculada } })
    : null;
  const pontos = historico
    .filter((h) => h.regime_codigo === regime && h.preco !== null)
    .map((h) => ({ rotulo: `${formatarCompetencia(h.competencia)}${h.numero > 1 ? ` r${h.numero}` : ""}`, valor: Number(h.preco) }));
  const diferenca = analitica?.totalCalculado && preco?.preco != null ? D(analitica.totalCalculado).minus(D(preco.preco)) : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase text-marca-600">{fonte} · {item.tipo === "INSUMO" ? "Insumo" : "Serviço / composição"}{item.classe ? ` · ${item.classe}` : ""}</p>
        <h1 className="titulo-pagina"><span className="font-mono">{item.codigo}</span> — {item.descricao}</h1>
        <p className="text-sm text-slate-500">
          Unidade: {item.unidade}{item.grupo ? ` · Grupo: ${item.grupo}` : ""}
          {item.regime_codigo && ` · Código de regime: ${NOMES_REGIME[item.regime_codigo as CodigoRegime]}`}
        </p>
        {vinculado && <p className="text-sm">Elementar que reutiliza a composição <Link className="btn-link" href={`/referencias/${vinculado.id}?revisao=${revisaoId}&regime=${regime}`}>{vinculado.codigo}</Link>.</p>}
      </div>

      <form className="cartao flex flex-wrap items-end gap-3">
        <div>
          <label className="rotulo">Base</label>
          <select name="revisao" defaultValue={revisaoId} className="campo">
            {revisoes.map((r) => <option key={r.id} value={r.id}>{formatarCompetencia(r.competencia)} — {r.rotulo}{r.status === "SUBSTITUIDA" ? " (substituída)" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="rotulo">Regime</label>
          <select name="regime" defaultValue={regime} className="campo">
            {Object.entries(NOMES_REGIME).filter(([k]) => k !== "NAO_SE_APLICA").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button className="btn-secundario">Atualizar</button>
      </form>

      <section className="cartao">
        <h2 className="mb-2 font-semibold">Preço na base selecionada</h2>
        {preco ? (
          <div className="flex flex-wrap items-baseline gap-4 text-sm">
            <span className="text-2xl font-semibold tabular-nums">{preco.preco !== null ? formatarMoeda(preco.preco, Math.max(2, D(preco.preco).decimalPlaces())) : "—"}</span>
            <Etiqueta valor={preco.situacao} />
            {preco.origem_preco && <span>Origem: {preco.origem_preco === "C" ? "Coletado" : preco.origem_preco === "CR" ? "Coeficiente de representatividade" : preco.origem_preco}</span>}
            {preco.percentual_as !== null && D(preco.percentual_as).gt(0) && <span>%AS (preços de SP): {formatarPercentual(D(preco.percentual_as).times(100))}</span>}
            {preco.percentual_mao_obra !== null && <span>Mão de obra: {formatarPercentual(D(preco.percentual_mao_obra).times(100))}</span>}
            <span className="text-xs text-slate-500">Descrição nesta base: {preco.descricoes_item.descricao}</span>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Este item não consta da base/regime selecionados.</p>
        )}
      </section>

      {item.tipo === "COMPOSICAO" && (
        <section className="cartao overflow-x-auto">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Composição analítica publicada pela fonte</h2>
            {analitica && u.permissoes.has("composicoes.editar") && (
              <BotaoAcao acao={acaoCopiarComoPropria} campos={{ itemId: id, revisaoId, regime }} rotulo="Copiar como composição própria" classe="btn-secundario">
                <input name="codigo" className="campo w-40" placeholder="Código próprio" required />
              </BotaoAcao>
            )}
          </div>
          {!analitica ? (
            <p className="alerta-info">A fonte não publicou composição analítica para este item nesta base. Nenhuma composição é exibida.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">Versão {analitica.versao} · situação: {analitica.situacao ?? "—"} · custo parcial pela regra da fonte: {analitica.regra}</p>
              <table className="tabela">
                <thead><tr><th>Seq.</th><th>Tipo</th><th>Código</th><th>Descrição</th><th>Und.</th><th className="num">Coeficiente</th>{fonte === "EMOP" && <th className="num">Perdas %</th>}<th className="num">Preço unit.</th><th className="num">Custo parcial</th></tr></thead>
                <tbody>
                  {analitica.linhas.map((l) => (
                    <tr key={l.ordem}>
                      <td className="text-xs">{l.sequencia ?? l.ordem}</td>
                      <td className="text-xs">{l.tipo_item === "INSUMO" ? (l.codigo_composicao_vinculada ? "Reutilizada" : "Insumo") : "Composição"}</td>
                      <td className="font-mono text-xs">{l.item_id ? <Link className="btn-link" href={`/referencias/${l.item_id}?revisao=${revisaoId}&regime=${regime}`}>{l.codigo}</Link> : l.codigo}</td>
                      <td>{l.descricao}</td>
                      <td>{l.unidade}</td>
                      <td className="num">{formatarDecimalVariavel(l.coeficiente, 4, 10)}</td>
                      {fonte === "EMOP" && <td className="num">{l.percentual_perda && D(l.percentual_perda).gt(0) ? formatarNumero(l.percentual_perda) : ""}</td>}
                      <td className="num">{l.preco !== null ? formatarDecimalVariavel(l.preco, 2, 4) : <Etiqueta valor={l.situacao ?? "SEM_PRECO"} />}</td>
                      <td className="num">{l.valor !== null ? formatarDecimalVariavel(l.valor, 2, 4) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 text-sm">
                <div>Custo publicado: <strong>{preco?.preco != null ? formatarMoeda(preco.preco) : "não publicado"}</strong></div>
                <div>Soma recalculada: {analitica.totalCalculado ? formatarMoeda(analitica.totalCalculado) : "indisponível (há componente sem preço)"}
                  {diferenca !== null && !diferenca.isZero() && <span className="ml-2 text-amber-700">(diferença de {formatarMoeda(diferenca)} — arredondamento da própria fonte; vale o publicado)</span>}
                </div>
              </div>
            </>
          )}
        </section>
      )}

      <section className="cartao overflow-x-auto">
        <h2 className="mb-2 font-semibold">Histórico de preços</h2>
        <GraficoHistorico pontos={pontos} />
        <table className="tabela mt-2">
          <thead><tr><th>Competência</th><th>Publicação</th><th>Regime</th><th className="num">Preço</th><th>Situação</th><th>Revisão</th></tr></thead>
          <tbody>
            {historico.map((h) => (
              <tr key={`${h.revisao_base_id}-${h.regime_codigo}`} className={h.regime_codigo === regime ? "" : "text-slate-400"}>
                <td>{formatarCompetencia(h.competencia)}</td>
                <td>{h.rotulo}</td>
                <td className="text-xs">{NOMES_REGIME[h.regime_codigo as CodigoRegime]}</td>
                <td className="num">{h.preco !== null ? formatarDecimalVariavel(h.preco, 2, 4) : ""}</td>
                <td><Etiqueta valor={h.situacao} /></td>
                <td><Etiqueta valor={h.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {usos.length > 0 && (
        <section className="cartao overflow-x-auto">
          <h2 className="mb-2 font-semibold">Composições que usam este insumo ({usos.length}{usos.length === 100 ? "+" : ""})</h2>
          <table className="tabela">
            <thead><tr><th>Código</th><th>Descrição</th><th>Und.</th><th className="num">Coeficiente</th></tr></thead>
            <tbody>{usos.map((x) => (
              <tr key={x.id}><td className="font-mono text-xs"><Link className="btn-link" href={`/referencias/${x.id}?revisao=${revisaoId}&regime=${regime}`}>{x.codigo}</Link></td><td>{x.descricao}</td><td>{x.unidade}</td><td className="num">{formatarDecimalVariavel(x.coeficiente, 4, 10)}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}

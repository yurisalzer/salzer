import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { carregarRevisao } from "@/servidor/dados-orcamento";
import { revisoesPublicadas } from "@/servidor/consultas";
import { pendenciasFechamento } from "@/servidor/orcamentos";
import { formatarDataHora, formatarDecimalVariavel, formatarMoeda, formatarNumero, formatarPercentual } from "@/dominio/formato";
import { D } from "@/dominio/decimal";
import { Etiqueta } from "@/componentes/etiquetas";
import { FormAcao } from "@/componentes/form-acao";
import { BotaoAcao } from "@/componentes/botao-acao";
import { SeletorBases } from "@/componentes/seletor-bases";
import { AdicionarItem } from "./adicionar-item";
import * as A from "../../../acoes";

export const dynamic = "force-dynamic";

const RELATORIOS = [
  ["sintetico", "Orçamento sintético"], ["analitico", "Orçamento analítico"], ["composicoes", "Composições de custos unitários"],
  ["abc-servicos", "Curva ABC de serviços"], ["abc-insumos", "Curva ABC de insumos"], ["bdi", "Demonstrativo de BDI"],
  ["cronograma", "Cronograma físico-financeiro"], ["memoria", "Memória de cálculo"], ["historico", "Histórico de preços"],
] as const;

export default async function EditorRevisao({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const u = await exigirUsuario("orcamentos.ver");
  const { id, rid } = await params;
  if (!/^[0-9a-f-]{36}$/.test(rid) || !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const existe = await prisma.revisoes_orcamento.findFirst({ where: { id: rid, orcamento_id: id } });
  if (!existe) notFound();
  const d = await carregarRevisao(rid);
  const aberta = d.rev.status === "ABERTA";
  const pode = aberta && u.permissoes.has("orcamentos.editar");
  const [revisoesBase, perfis, pend] = await Promise.all([
    revisoesPublicadas(),
    prisma.perfis_bdi.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    aberta ? pendenciasFechamento(rid) : Promise.resolve([]),
  ]);
  const campos = { revisaoId: rid, orcamentoId: id, versao: d.rev.versao };
  const basesIds = d.bases.map((b) => b.revisaoBaseId);
  const basesRegimes = d.bases.map((b) => b.regime);
  const nomeBdi = (bid: string | null) => d.bdis.find((b) => b.id === (bid ?? d.rev.bdi_padrao_id));
  const meses = d.rev.prazo_meses ?? 0;
  const cron = new Map(d.cronograma.map((c) => [`${c.etapa_id}|${c.mes}`, c.percentual.toString()]));
  const padraoBases = {
    emop: d.bases.find((b) => b.fonte === "EMOP")?.revisaoBaseId, sinapi: d.bases.find((b) => b.fonte === "SINAPI")?.revisaoBaseId,
    regimeEmop: d.bases.find((b) => b.fonte === "EMOP")?.regime, regimeSinapi: d.bases.find((b) => b.fonte === "SINAPI")?.regime,
  };
  const colunas = pode ? 11 : 10;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-slate-500">
            <Link className="btn-link" href={`/obras/${d.obra.id}`}>{d.obra.nome}</Link> › <Link className="btn-link" href={`/orcamentos/${id}`}>{d.orcamento.nome}</Link>
          </p>
          <h1 className="titulo-pagina">Revisão {d.rev.numero}{d.rev.descricao ? ` — ${d.rev.descricao}` : ""}</h1>
          <p className="text-sm text-slate-500">Bases: {d.bases.map((b) => b.descricao).join(" | ") || "nenhuma"}</p>
          <p className="text-sm text-slate-500">
            BDI padrão: {d.bdiPadrao ? `${d.bdiPadrao.nome} — ${formatarPercentual(d.bdiPadrao.percentual_adotado)}` : "não definido"} · valores {d.modo === "TRUNCAR" ? "truncados" : "arredondados"} em 2 casas
            {d.rev.prazo_meses ? ` · prazo ${d.rev.prazo_meses} meses` : ""}
          </p>
        </div>
        <div className="text-right">
          <Etiqueta valor={d.rev.status} />
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatarMoeda(d.totais.total)}</div>
          <div className="text-xs text-slate-500">Custo direto {formatarMoeda(d.totais.custo)} · BDI {formatarMoeda(d.totais.bdi)}</div>
          {!aberta && <div className="text-xs text-slate-500">Fechada em {formatarDataHora(d.rev.fechada_em)} por {d.rev.fechador?.nome ?? "—"} · integridade {d.rev.hash_fechamento?.slice(0, 16)}…</div>}
        </div>
      </div>

      {d.totais.semPreco > 0 && <p className="alerta-aviso">{d.totais.semPreco} item(ns) sem preço na base — não somados ao total e impedem o fechamento.</p>}

      <section className="cartao">
        <h2 className="mb-2 font-semibold">Relatórios (PDF / Excel)</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          {RELATORIOS.map(([k, nome]) => (
            <span key={k} className="inline-flex items-center gap-2 rounded border border-slate-200 px-2 py-1">
              {nome}
              <a className="btn-link font-semibold" href={`/api/relatorios/${k}?revisao=${rid}&formato=pdf`}>PDF</a>
              <a className="btn-link font-semibold" href={`/api/relatorios/${k}?revisao=${rid}&formato=xlsx`}>XLSX</a>
            </span>
          ))}
        </div>
      </section>

      <section className="cartao overflow-x-auto p-0">
        <table className="tabela">
          <thead>
            <tr><th>Item</th><th>Fonte</th><th>Código</th><th>Descrição</th><th>Und.</th><th className="num">Quantidade</th><th className="num">Custo unit.</th><th>BDI</th><th className="num">Preço unit.</th><th className="num">Total</th>{pode && <th />}</tr>
          </thead>
          <tbody>
            {d.etapas.map((e) => (
              <Fragment key={e.id}>
                <tr className="bg-marca-50">
                  <td className="font-semibold">{e.numero}</td>
                  <td colSpan={8} className="font-semibold" style={{ paddingLeft: `${(e.nivel - 1) * 16 + 8}px` }}>
                    {pode ? (
                      <FormAcao acao={A.acaoRenomearEtapa} campos={{ ...campos, etapaId: e.id }} className="inline-flex gap-1">
                        <input name="titulo" defaultValue={e.titulo} key={e.titulo} className="w-80 rounded border border-transparent bg-transparent px-1 font-semibold hover:border-slate-300" aria-label="Título da etapa" />
                      </FormAcao>
                    ) : e.titulo}
                  </td>
                  <td className="num font-semibold">{formatarMoeda(e.total)}</td>
                  {pode && (
                    <td className="whitespace-nowrap text-xs">
                      <BotaoAcao acao={A.acaoMoverEtapa} campos={{ ...campos, etapaId: e.id, direcao: "acima" }} rotulo="↑" classe="px-1 text-slate-500" />
                      <BotaoAcao acao={A.acaoMoverEtapa} campos={{ ...campos, etapaId: e.id, direcao: "abaixo" }} rotulo="↓" classe="px-1 text-slate-500" />
                      <BotaoAcao acao={A.acaoExcluirEtapa} campos={{ ...campos, etapaId: e.id }} rotulo="✕" classe="px-1 text-red-600" confirmar={`Excluir a etapa "${e.titulo}" com todos os seus itens e subetapas?`} />
                    </td>
                  )}
                </tr>
                {e.itens.map((i) => (
                  <tr key={i.id}>
                    <td className="text-xs">{i.numero}</td>
                    <td className="text-xs" title={i.referencia}>{i.fonte}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{i.itemReferenciaId ? <Link className="btn-link" href={`/referencias/${i.itemReferenciaId}?${i.revisaoBaseId ? `revisao=${i.revisaoBaseId}&` : ""}regime=${i.regime ?? ""}`}>{i.codigo}</Link> : i.codigo}</td>
                    <td className="min-w-72">
                      {i.descricao}
                      <div className="text-xs text-slate-400">{i.referencia}</div>
                      {i.observacao && <div className={`text-xs ${i.observacao.startsWith("ATENÇÃO") ? "text-amber-700" : "text-slate-500"}`}>{i.observacao}</div>}
                    </td>
                    <td>{i.unidade}</td>
                    <td className="num">
                      {pode ? (
                        <FormAcao acao={A.acaoAlterarItem} campos={{ ...campos, itemId: i.id }}>
                          <input name="quantidade" defaultValue={formatarDecimalVariavel(i.quantidade, 2, 6).replace(/\./g, "")} key={`${i.id}-${d.rev.versao}`} className="w-24 rounded border border-slate-200 px-1 text-right" inputMode="decimal" aria-label="Quantidade" />
                        </FormAcao>
                      ) : formatarDecimalVariavel(i.quantidade, 2, 6)}
                    </td>
                    <td className="num">
                      {i.custoUnitario !== null ? formatarDecimalVariavel(i.custoUnitario, 2, 6) : <Etiqueta valor={i.situacaoPreco} />}
                    </td>
                    <td className="text-xs">
                      {pode ? (
                        <FormAcao acao={A.acaoAlterarItem} campos={{ ...campos, itemId: i.id }} enviarAoAlterar>
                          <select name="bdi" defaultValue={i.bdiAplicadoId ?? ""} key={`${i.id}-b-${d.rev.versao}`} className="rounded border border-slate-200 text-xs" aria-label="BDI do item">
                            <option value="">Padrão ({d.bdiPadrao ? formatarPercentual(d.bdiPadrao.percentual_adotado) : "0%"})</option>
                            {d.bdis.filter((b) => b.id !== d.rev.bdi_padrao_id).map((b) => <option key={b.id} value={b.id}>{b.nome} ({formatarPercentual(b.percentual_adotado)})</option>)}
                          </select>
                        </FormAcao>
                      ) : (
                        <>{formatarPercentual(i.bdiPercentual)}{i.bdiAplicadoId && <span className="ml-1 text-marca-600" title={nomeBdi(i.bdiAplicadoId)?.nome}>*</span>}</>
                      )}
                    </td>
                    <td className="num">{i.precoUnitario !== null ? formatarNumero(i.precoUnitario) : ""}</td>
                    <td className="num">{i.total !== null ? formatarNumero(i.total) : ""}</td>
                    {pode && (
                      <td className="whitespace-nowrap text-xs">
                        <BotaoAcao acao={A.acaoMoverItem} campos={{ ...campos, itemId: i.id, direcao: "acima" }} rotulo="↑" classe="px-1 text-slate-500" />
                        <BotaoAcao acao={A.acaoMoverItem} campos={{ ...campos, itemId: i.id, direcao: "abaixo" }} rotulo="↓" classe="px-1 text-slate-500" />
                        <BotaoAcao acao={A.acaoExcluirItem} campos={{ ...campos, itemId: i.id }} rotulo="✕" classe="px-1 text-red-600" confirmar={`Excluir o item ${i.codigo}?`} />
                      </td>
                    )}
                  </tr>
                ))}
                {pode && (
                  <tr>
                    <td />
                    <td colSpan={colunas - 1}>
                      <details>
                        <summary className="cursor-pointer text-xs text-marca-600">+ adicionar item ou subetapa em {e.numero}</summary>
                        <div className="mt-2 space-y-2">
                          <AdicionarItem campos={{ ...campos, etapaId: e.id }} revisoes={basesIds} regimes={basesRegimes} />
                          <FormAcao acao={A.acaoAdicionarEtapa} campos={{ ...campos, paiId: e.id }} className="flex gap-2">
                            <input name="titulo" className="campo w-80" placeholder={`Nova subetapa de ${e.numero}`} required />
                            <button className="btn-secundario">Adicionar subetapa</button>
                          </FormAcao>
                        </div>
                      </details>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {d.etapas.length === 0 && <tr><td colSpan={colunas} className="text-slate-500">Comece criando as etapas do orçamento (ex.: Serviços preliminares, Fundações…).</td></tr>}
            <tr className="font-semibold">
              <td colSpan={9} className="text-right">Custo direto</td><td className="num">{formatarMoeda(d.totais.custo)}</td>{pode && <td />}
            </tr>
            <tr className="font-semibold">
              <td colSpan={9} className="text-right">BDI</td><td className="num">{formatarMoeda(d.totais.bdi)}</td>{pode && <td />}
            </tr>
            <tr className="text-base font-bold">
              <td colSpan={9} className="text-right">Total geral</td><td className="num">{formatarMoeda(d.totais.total)}</td>{pode && <td />}
            </tr>
          </tbody>
        </table>
      </section>

      {pode && (
        <section className="cartao">
          <FormAcao acao={A.acaoAdicionarEtapa} campos={{ ...campos, paiId: "" }} className="flex flex-wrap items-end gap-2">
            <div><label className="rotulo">Nova etapa (1º nível)</label><input name="titulo" className="campo w-96" required /></div>
            <button className="btn-primario">Adicionar etapa</button>
          </FormAcao>
        </section>
      )}

      {pode && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="cartao space-y-3">
            <h2 className="font-semibold">BDI</h2>
            <ul className="text-sm">
              {d.bdis.map((b) => (
                <li key={b.id}>{b.id === d.rev.bdi_padrao_id ? "★ " : "• "}{b.nome} — <strong>{formatarPercentual(b.percentual_adotado)}</strong>{b.percentual_calculado && ` (calculado ${formatarPercentual(b.percentual_calculado)})`}</li>
              ))}
            </ul>
            <FormAcao acao={A.acaoDefinirBdiPadrao} campos={campos} className="grid gap-2 md:grid-cols-3">
              <div className="md:col-span-2"><label className="rotulo">Novo BDI padrão (perfil)</label>
                <select name="perfil" className="campo" defaultValue=""><option value="">Informar percentual →</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.percentual_adotado?.toString()}%)</option>)}</select>
              </div>
              <div><label className="rotulo">ou %</label><input name="percentual" className="campo" placeholder="25,00" /></div>
              <div className="md:col-span-3"><button className="btn-secundario">Trocar BDI padrão e recalcular</button></div>
            </FormAcao>
            <FormAcao acao={A.acaoAdicionarBdi} campos={campos} className="grid gap-2 md:grid-cols-3">
              <div className="md:col-span-2"><label className="rotulo">BDI diferenciado (para itens específicos)</label>
                <select name="perfil" className="campo" defaultValue=""><option value="">Informar nome e percentual →</option>{perfis.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.percentual_adotado?.toString()}%)</option>)}</select>
              </div>
              <div><label className="rotulo">%</label><input name="percentual" className="campo" placeholder="16,00" /></div>
              <div className="md:col-span-2"><input name="nome" className="campo" placeholder="Nome (ex.: Fornecimento de equipamentos)" /></div>
              <div><button className="btn-secundario">Criar BDI</button></div>
            </FormAcao>
          </section>

          <section className="cartao space-y-3">
            <h2 className="font-semibold">Parâmetros</h2>
            <FormAcao acao={A.acaoParametros} campos={campos} className="grid gap-2 md:grid-cols-3">
              <div className="md:col-span-3"><label className="rotulo">Descrição da revisão</label><input name="descricao" defaultValue={d.rev.descricao ?? ""} className="campo" /></div>
              <div><label className="rotulo">Valores</label><select name="modo" defaultValue={d.modo} className="campo"><option value="TRUNCAR">Truncar</option><option value="ARREDONDAR">Arredondar</option></select></div>
              <div><label className="rotulo">Prazo (meses)</label><input name="prazo" type="number" min={1} max={120} defaultValue={d.rev.prazo_meses ?? ""} className="campo" /></div>
              <div className="flex items-end"><button className="btn-secundario">Salvar</button></div>
            </FormAcao>
          </section>
        </div>
      )}

      {meses > 0 && d.etapas.some((e) => !e.paiId) && (
        <section className="cartao overflow-x-auto">
          <h2 className="mb-2 font-semibold">Cronograma físico-financeiro (% por mês)</h2>
          <table className="tabela">
            <thead><tr><th>Etapa</th><th className="num">Valor</th>{Array.from({ length: meses }, (_x, k) => <th key={k} className="num">Mês {k + 1}</th>)}<th className="num">Soma</th>{pode && <th />}</tr></thead>
            <tbody>
              {d.etapas.filter((e) => !e.paiId).map((e) => {
                const soma = Array.from({ length: meses }, (_x, k) => D(cron.get(`${e.id}|${k + 1}`) ?? 0)).reduce((s, v) => s.plus(v), D(0));
                const formId = `cron-${e.id}`;
                return (
                  <tr key={e.id}>
                    <td>{e.numero} {e.titulo}</td>
                    <td className="num">{formatarNumero(e.total)}</td>
                    {Array.from({ length: meses }, (_x, k) => (
                      <td key={k} className="num">
                        {pode ? <input form={formId} name={`m${k + 1}`} defaultValue={cron.get(`${e.id}|${k + 1}`) ? formatarDecimalVariavel(cron.get(`${e.id}|${k + 1}`)!, 0, 4) : ""} key={`${formId}-${k}-${d.rev.versao}`} className="w-16 rounded border border-slate-200 px-1 text-right" inputMode="decimal" />
                          : cron.get(`${e.id}|${k + 1}`) ? formatarDecimalVariavel(cron.get(`${e.id}|${k + 1}`)!, 0, 4) : ""}
                      </td>
                    ))}
                    <td className={`num ${soma.eq(100) ? "" : "text-amber-700"}`}>{formatarDecimalVariavel(soma, 0, 4)}%</td>
                    {pode && (
                      <td>
                        <FormAcao id={formId} acao={A.acaoCronograma} campos={{ ...campos, etapaId: e.id, meses }}>
                          <button className="btn-secundario text-xs">Salvar</button>
                        </FormAcao>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="cartao space-y-3">
        <h2 className="font-semibold">Revisões e fechamento</h2>
        {aberta && pend.length > 0 && (
          <ul className="space-y-1 text-sm">
            {pend.map((p, k) => <li key={k} className={p.tipo === "ERRO" ? "text-red-700" : "text-amber-700"}>{p.tipo === "ERRO" ? "Impede o fechamento: " : "Atenção: "}{p.mensagem}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap items-start gap-4">
          {aberta && u.permissoes.has("orcamentos.fechar") && (
            <BotaoAcao acao={A.acaoFechar} campos={campos} rotulo="Fechar revisão" rotuloPendente="Fechando…" desabilitado={pend.some((p) => p.tipo === "ERRO")}
              confirmar="Fechar esta revisão? Os valores ficam congelados e não poderão mais ser alterados (alterações exigem nova revisão)." />
          )}
          {u.permissoes.has("orcamentos.editar") && (
            <FormAcao acao={A.acaoDuplicar} campos={campos} className="flex flex-wrap items-end gap-2">
              <div><label className="rotulo">Duplicar como novo orçamento</label><input name="nome" className="campo w-64" placeholder={`${d.orcamento.nome} (cópia)`} /></div>
              <button className="btn-secundario">Duplicar</button>
            </FormAcao>
          )}
        </div>
        {u.permissoes.has("orcamentos.editar") && (
          <FormAcao acao={A.acaoNovaRevisao} campos={campos} className="grid gap-2 rounded border border-slate-200 p-3 md:grid-cols-4">
            <div className="md:col-span-4 text-sm font-semibold">Nova revisão a partir desta (esta revisão não é alterada)</div>
            <div className="md:col-span-4"><label className="rotulo">Descrição</label><input name="descricao" className="campo" placeholder="ex.: Atualização para a competência mar/2026" /></div>
            <SeletorBases revisoes={revisoesBase} padrao={padraoBases} />
            <p className="md:col-span-4 text-xs text-slate-500">Se escolher bases diferentes das atuais, os preços dos itens EMOP/SINAPI da nova revisão são atualizados para elas. Itens inexistentes na nova base mantêm o preço anterior e ficam sinalizados.</p>
            <div className="md:col-span-4"><button className="btn-primario">Criar nova revisão</button></div>
          </FormAcao>
        )}
      </section>
    </div>
  );
}

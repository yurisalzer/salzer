import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { formatarCompetencia, formatarDataHora, formatarNumero } from "@/dominio/formato";
import { NOMES_REGIME, type CodigoRegime } from "@/dominio/referencias";
import { BotaoAcao } from "@/componentes/botao-acao";
import { Etiqueta } from "@/componentes/etiquetas";
import { acaoCancelarLote, acaoConfirmarLote, acaoPublicarRevisao, acaoRejeitarRevisao } from "../acoes";

export const dynamic = "force-dynamic";

type Previa = "precos" | "itens" | "componentes";

export default async function PaginaLote({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await exigirUsuario("bases.consultar");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const lote = await prisma.lotes_importacao.findUnique({
    where: { id },
    include: { fontes: true, usuarios: true, arquivos_importacao: { orderBy: { criado_em: "asc" } }, revisao_base_criada: true },
  });
  if (!lote) notFound();
  const sev = sp.sev && ["ERRO", "AVISO", "INFO"].includes(sp.sev) ? sp.sev : undefined;
  const [porSeveridade, verificacoes] = await Promise.all([
    prisma.verificacoes_importacao.groupBy({ by: ["severidade"], where: { lote_id: id }, _count: true }),
    prisma.verificacoes_importacao.findMany({
      where: { lote_id: id, ...(sev ? { severidade: sev } : {}) },
      orderBy: [{ severidade: "asc" }, { regra: "asc" }, { linha: "asc" }],
      take: 300,
    }),
  ]);
  const total = (s: string) => porSeveridade.find((x) => x.severidade === s)?._count ?? 0;
  const erros = total("ERRO");
  const contagens = (lote.contagens ?? {}) as Record<string, number>;
  const metadados = (lote.metadados ?? {}) as Record<string, unknown>;

  // Passo 7 — pré-visualização dos dados no staging (antes da confirmação)
  const previa: Previa = sp.ver === "itens" || sp.ver === "componentes" ? sp.ver : "precos";
  const busca = (sp.q ?? "").trim().slice(0, 50);
  let linhasPrevia: Array<Record<string, unknown>> = [];
  if (lote.status === "ANALISADO") {
    const filtro = busca ? `AND (codigo ILIKE $2 || '%')` : "";
    const filtroComp = busca ? `AND (codigo_pai ILIKE $2 || '%' OR codigo_item ILIKE $2 || '%')` : "";
    const params: unknown[] = busca ? [id, busca] : [id];
    const sql =
      previa === "precos"
        ? `SELECT p.tipo, p.codigo, i.descricao, i.unidade, p.regime_codigo, p.preco_texto, p.preco::text preco, p.situacao, p.arquivo, p.linha
             FROM stg_precos p LEFT JOIN LATERAL (SELECT descricao, unidade FROM stg_itens i WHERE i.lote_id = p.lote_id AND i.tipo = p.tipo AND i.codigo = p.codigo LIMIT 1) i ON true
            WHERE p.lote_id = $1::uuid ${filtro.replace("codigo", "p.codigo")} ORDER BY p.codigo, p.regime_codigo LIMIT 60`
        : previa === "itens"
          ? `SELECT DISTINCT ON (tipo, codigo) tipo, codigo, descricao, unidade, classe, regime_codigo, arquivo, linha FROM stg_itens
              WHERE lote_id = $1::uuid ${filtro} ORDER BY tipo, codigo, arquivo, linha LIMIT 60`
          : `SELECT codigo_pai, ordem, sequencia, tipo_item, codigo_item, coeficiente_texto, percentual_perda::text percentual_perda, situacao_origem, arquivo, linha
               FROM stg_componentes WHERE lote_id = $1::uuid ${filtroComp} ORDER BY codigo_pai, ordem LIMIT 60`;
    linhasPrevia = await prisma.$queryRawUnsafe(sql, ...params);
  }
  const rev = lote.revisao_base_criada;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pagina">
            Importação {lote.fontes.sigla} — {formatarCompetencia(lote.competencia)} — {lote.uf}
          </h1>
          <p className="text-sm text-slate-500">
            {lote.rotulo_revisao} · regimes: {lote.regimes.map((r) => NOMES_REGIME[r as CodigoRegime] ?? r).join(", ")} · enviado por {lote.usuarios?.nome ?? "terminal"} em {formatarDataHora(lote.criado_em)}
          </p>
          <p className="text-xs text-slate-400">Lote {lote.id} · adaptador {lote.adaptador ?? "—"} · importador v{lote.importador_versao}</p>
        </div>
        <div className="flex items-center gap-2">
          <Etiqueta valor={lote.status} />
          <a className="btn-secundario" href={`/api/importacoes/${id}/relatorio`}>Relatório de inconsistências (CSV)</a>
        </div>
      </div>

      {lote.erro && <p className={lote.status === "FALHOU" ? "alerta-erro" : "alerta-aviso"}>{lote.erro}</p>}

      {lote.status === "ANALISADO" && (
        <section className="cartao space-y-3">
          <h2 className="font-semibold">Confirmação</h2>
          {erros > 0 ? (
            <p className="alerta-erro">Há {erros} erro(s) de validação. Corrija os arquivos e importe novamente; este lote não pode ser gravado.</p>
          ) : (
            <p className="alerta-ok">Validação concluída sem erros. Confira a pré-visualização e os avisos abaixo antes de confirmar.</p>
          )}
          {u.permissoes.has("importacao.executar") && (
            <div className="flex flex-wrap gap-3">
              <BotaoAcao acao={acaoConfirmarLote} campos={{ loteId: id }} rotulo="Confirmar e gravar" rotuloPendente="Gravando (transação única)…" desabilitado={erros > 0}
                confirmar="Gravar esta base? A gravação é feita em uma única transação." />
              <BotaoAcao acao={acaoCancelarLote} campos={{ loteId: id }} rotulo="Cancelar importação" classe="btn-secundario" confirmar="Descartar esta importação?" />
            </div>
          )}
        </section>
      )}

      {rev && (
        <section className="cartao space-y-3">
          <h2 className="font-semibold">Revisão da base criada</h2>
          <p className="text-sm">
            Revisão nº {rev.numero} — {rev.rotulo} — <Etiqueta valor={rev.status} />
            {rev.data_emissao && <> · emissão {rev.data_emissao.toISOString().slice(0, 10).split("-").reverse().join("/")}</>}
          </p>
          {rev.status === "VALIDADA" && u.permissoes.has("bases.publicar") && (
            <div className="flex flex-wrap items-start gap-3">
              <BotaoAcao acao={acaoPublicarRevisao} campos={{ revisaoId: rev.id }} rotulo="Publicar para novos orçamentos"
                confirmar="Publicar esta revisão? Ela passará a ser a vigente desta competência; a anterior (se houver) fica como substituída, preservando os orçamentos que a usam." />
              <BotaoAcao acao={acaoRejeitarRevisao} campos={{ revisaoId: rev.id }} rotulo="Rejeitar" classe="btn-perigo">
                <input name="motivo" className="campo w-64" placeholder="Motivo da rejeição" required />
              </BotaoAcao>
            </div>
          )}
          {rev.status === "PUBLICADA" && <Link className="btn-link text-sm" href={`/referencias?revisao=${rev.id}`}>Consultar itens desta base</Link>}
        </section>
      )}

      <section className="cartao">
        <h2 className="mb-2 font-semibold">Resumo</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(contagens).map(([k, v]) => (
            <div key={k} className="rounded border border-slate-100 p-2">
              <div className="text-xs text-slate-500">{k.replace(/_/g, " ")}</div>
              <div className="font-semibold tabular-nums">{formatarNumero(v, 0)}</div>
            </div>
          ))}
          {Object.entries(metadados).map(([k, v]) => (
            <div key={k} className="rounded border border-slate-100 p-2">
              <div className="text-xs text-slate-500">{k.replace(/_/g, " ")}</div>
              <div className="font-semibold">{String(v)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="cartao overflow-x-auto">
        <h2 className="mb-2 font-semibold">Arquivos e integridade</h2>
        <table className="tabela">
          <thead><tr><th>Arquivo</th><th>Tipo real</th><th>Papel / layout</th><th className="num">Registros</th><th className="num">Tamanho</th><th>SHA-256</th></tr></thead>
          <tbody>
            {lote.arquivos_importacao.map((a) => (
              <tr key={a.id} className={a.papel ? "" : "text-slate-400"}>
                <td className="max-w-xs break-all">{a.caminho}</td>
                <td>{a.assinatura}</td>
                <td>{a.papel ? `${a.papel} (${a.layout})` : a.assinatura === "NAO_EXTRAIDO" ? "não utilizado" : "—"}</td>
                <td className="num">{a.registros !== null ? formatarNumero(a.registros, 0) : ""}</td>
                <td className="num">{formatarNumero(Number(a.tamanho) / 1024, 1)} KB</td>
                <td className="font-mono text-xs" title={a.sha256}>{a.assinatura === "NAO_EXTRAIDO" ? "" : `${a.sha256.slice(0, 16)}…`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="cartao">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Verificações</h2>
          <Link href={`?`} className={`etiqueta ${!sev ? "ring-2 ring-marca-600" : ""} bg-slate-100`}>Todas</Link>
          {(["ERRO", "AVISO", "INFO"] as const).map((s) => (
            <Link key={s} href={`?sev=${s}`} className={sev === s ? "rounded ring-2 ring-marca-600" : ""}>
              <Etiqueta valor={s} texto={`${s} (${total(s)})`} />
            </Link>
          ))}
        </div>
        {verificacoes.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma ocorrência.</p>
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="tabela">
              <thead><tr><th>Severidade</th><th>Regra</th><th>Mensagem</th><th>Arquivo / linha</th><th>Código</th></tr></thead>
              <tbody>
                {verificacoes.map((v) => (
                  <tr key={v.id}>
                    <td><Etiqueta valor={v.severidade} /></td>
                    <td className="text-xs">{v.regra}</td>
                    <td>{v.mensagem}</td>
                    <td className="text-xs">{v.arquivo}{v.linha ? `:${v.linha}` : ""}</td>
                    <td className="font-mono text-xs">{v.codigo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lote.status === "ANALISADO" && (
        <section className="cartao overflow-x-auto">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <h2 className="font-semibold">Pré-visualização dos dados</h2>
            {(["precos", "itens", "componentes"] as const).map((p) => (
              <Link key={p} href={`?ver=${p}${busca ? `&q=${encodeURIComponent(busca)}` : ""}`} className={previa === p ? "btn-primario" : "btn-secundario"}>
                {p === "precos" ? "Preços" : p === "itens" ? "Itens" : "Composições"}
              </Link>
            ))}
            <form className="flex gap-2">
              <input type="hidden" name="ver" value={previa} />
              <input name="q" defaultValue={busca} className="campo w-48" placeholder="Código começa com…" />
              <button className="btn-secundario">Filtrar</button>
            </form>
          </div>
          <table className="tabela">
            <thead><tr>{Object.keys(linhasPrevia[0] ?? { "sem dados": 1 }).map((k) => <th key={k}>{k.replace(/_/g, " ")}</th>)}</tr></thead>
            <tbody>
              {linhasPrevia.map((l, i) => (
                <tr key={i}>{Object.entries(l).map(([k, v]) => <td key={k} className={k === "descricao" ? "min-w-80" : "whitespace-nowrap"}>{v === null ? <span className="text-slate-400">—</span> : String(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Mostrando até 60 linhas. Valores exatamente como lidos dos arquivos (texto original em "preço texto").</p>
        </section>
      )}
    </div>
  );
}

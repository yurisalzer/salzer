"use client";

import { useActionState, useState } from "react";
import { BuscaItens, type ItemEncontrado } from "@/componentes/busca-itens";
import { acaoSalvarComposicao } from "./acoes";

interface Linha {
  chave: string;
  itemId: string | null;
  rotulo: string;
  unidade: string;
  revisaoBaseId: string | null;
  regime: string | null;
  coeficiente: string;
  custoInformado: string | null;
  descricaoInformada: string | null;
  unidadeInformada: string | null;
}

export interface DadosIniciais {
  itemId: string | null;
  codigo: string;
  descricao: string;
  unidade: string;
  componentes: Linha[];
}

// "1,279" → "1.279"; "1.279" é mantido (coeficientes raramente têm separador de milhar).
const virgulaParaPonto = (s: string) => { const t = s.trim(); return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t; };

export function EditorComposicao({ inicial, revisoes, rotulosRevisoes }: { inicial: DadosIniciais; revisoes: string[]; rotulosRevisoes: string }) {
  const [estado, salvar, pendente] = useActionState(acaoSalvarComposicao, {});
  const [codigo, setCodigo] = useState(inicial.codigo);
  const [descricao, setDescricao] = useState(inicial.descricao);
  const [unidade, setUnidade] = useState(inicial.unidade);
  const [observacao, setObservacao] = useState("");
  const [regime, setRegime] = useState("SEM_DESONERACAO");
  const [linhas, setLinhas] = useState<Linha[]>(inicial.componentes);

  const adicionar = (i: ItemEncontrado) =>
    setLinhas((l) => [...l, {
      chave: crypto.randomUUID(), itemId: i.id, rotulo: `${i.fonte} ${i.codigo} — ${i.descricao}`, unidade: i.unidade,
      revisaoBaseId: i.revisao_base_id, regime: i.regime_codigo, coeficiente: "1", custoInformado: null, descricaoInformada: null, unidadeInformada: null,
    }]);
  const adicionarProprio = () =>
    setLinhas((l) => [...l, { chave: crypto.randomUUID(), itemId: null, rotulo: "", unidade: "", revisaoBaseId: null, regime: null, coeficiente: "1", custoInformado: "0", descricaoInformada: "", unidadeInformada: "" }]);
  const alterar = (chave: string, campo: keyof Linha, valor: string) => setLinhas((l) => l.map((x) => (x.chave === chave ? { ...x, [campo]: valor } : x)));

  const dados = JSON.stringify({
    itemId: inicial.itemId, codigo, descricao, unidade, observacao,
    componentes: linhas.map((l) => ({
      itemId: l.itemId, revisaoBaseId: l.revisaoBaseId, regime: l.regime, coeficiente: virgulaParaPonto(l.coeficiente),
      custoInformado: l.custoInformado === null ? null : virgulaParaPonto(l.custoInformado), descricaoInformada: l.descricaoInformada, unidadeInformada: l.unidadeInformada,
    })),
  });

  return (
    <form action={salvar} className="space-y-4">
      <input type="hidden" name="dados" value={dados} />
      <section className="cartao grid gap-3 md:grid-cols-6">
        <div><label className="rotulo">Código</label><input className="campo" value={codigo} onChange={(e) => setCodigo(e.target.value)} required maxLength={30} /></div>
        <div className="md:col-span-4"><label className="rotulo">Descrição</label><input className="campo" value={descricao} onChange={(e) => setDescricao(e.target.value)} required /></div>
        <div><label className="rotulo">Unidade</label><input className="campo" value={unidade} onChange={(e) => setUnidade(e.target.value)} required maxLength={20} /></div>
        <div className="md:col-span-6"><label className="rotulo">Observação da versão</label><input className="campo" value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Justificativa, fonte das cotações…" /></div>
      </section>
      <section className="cartao space-y-3">
        <h2 className="font-semibold">Componentes</h2>
        <p className="text-xs text-slate-500">Preços buscados nas bases: {rotulosRevisoes}.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-80 flex-1"><BuscaItens revisoes={revisoes} regime={regime} aoEscolher={adicionar} /></div>
          <select className="campo w-48" value={regime} onChange={(e) => setRegime(e.target.value)}>
            <option value="SEM_DESONERACAO">Sem desoneração</option><option value="COM_DESONERACAO">Com desoneração</option><option value="SEM_ENCARGOS">Sem encargos</option>
          </select>
          <button type="button" className="btn-secundario" onClick={adicionarProprio}>+ Insumo próprio (cotação)</button>
        </div>
        <table className="tabela">
          <thead><tr><th>Componente</th><th>Und.</th><th className="num">Coeficiente</th><th className="num">Custo informado</th><th /></tr></thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave}>
                <td>{l.itemId ? <>{l.rotulo}<div className="text-xs text-slate-500">{l.regime ?? ""}</div></> : <input className="campo" placeholder="Descrição do insumo próprio" value={l.descricaoInformada ?? ""} onChange={(e) => alterar(l.chave, "descricaoInformada", e.target.value)} />}</td>
                <td>{l.itemId ? l.unidade : <input className="campo w-20" value={l.unidadeInformada ?? ""} onChange={(e) => alterar(l.chave, "unidadeInformada", e.target.value)} />}</td>
                <td><input className="campo w-28 text-right" value={l.coeficiente} onChange={(e) => alterar(l.chave, "coeficiente", e.target.value)} inputMode="decimal" /></td>
                <td>{l.itemId ? <span className="text-xs text-slate-500">da base</span> : <input className="campo w-28 text-right" value={l.custoInformado ?? ""} onChange={(e) => alterar(l.chave, "custoInformado", e.target.value)} inputMode="decimal" />}</td>
                <td><button type="button" className="text-xs text-red-700" onClick={() => setLinhas((x) => x.filter((y) => y.chave !== l.chave))}>remover</button></td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td colSpan={5} className="text-slate-500">Nenhum componente.</td></tr>}
          </tbody>
        </table>
      </section>
      {estado.erro && <p className="alerta-erro">{estado.erro}</p>}
      <button className="btn-primario" disabled={pendente}>{pendente ? "Salvando…" : "Salvar (nova versão)"}</button>
    </form>
  );
}

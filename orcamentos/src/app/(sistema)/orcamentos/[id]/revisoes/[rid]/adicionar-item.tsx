"use client";

import { useState } from "react";
import { BuscaItens, type ItemEncontrado } from "@/componentes/busca-itens";
import { FormAcao } from "@/componentes/form-acao";
import { acaoAdicionarItem, acaoAdicionarServicoProprio } from "../../../acoes";

export function AdicionarItem({ campos, revisoes, regimes }: { campos: Record<string, string | number>; revisoes: string[]; regimes: string[] }) {
  const [item, setItem] = useState<ItemEncontrado | null>(null);
  const [avulso, setAvulso] = useState(false);
  return (
    <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-2">
      {!item && !avulso && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-72 flex-1"><BuscaItens revisoes={revisoes} regime={regimes[0] ?? "SEM_DESONERACAO"} regimes={regimes} aoEscolher={setItem} /></div>
          <button type="button" className="btn-secundario" onClick={() => setAvulso(true)}>+ Serviço próprio (cotação)</button>
        </div>
      )}
      {item && (
        <FormAcao acao={async (e, f) => { const r = await acaoAdicionarItem(e, f); if (!r.erro) setItem(null); return r; }}
          campos={{ ...campos, itemId: item.id, fonte: item.fonte, revisaoBaseId: item.revisao_base_id ?? "", regime: item.regime_codigo ?? "" }}
          className="flex flex-wrap items-end gap-2 text-sm">
          <div className="min-w-72 flex-1"><span className="font-mono text-xs">{item.fonte} {item.codigo}</span> — {item.descricao} ({item.unidade}) {item.preco ? `· R$ ${item.preco}` : ""}</div>
          <div><label className="rotulo">Quantidade</label><input name="quantidade" className="campo w-28 text-right" required autoFocus inputMode="decimal" /></div>
          <button className="btn-primario">Adicionar</button>
          <button type="button" className="btn-secundario" onClick={() => setItem(null)}>Cancelar</button>
        </FormAcao>
      )}
      {avulso && (
        <FormAcao acao={async (e, f) => { const r = await acaoAdicionarServicoProprio(e, f); if (!r.erro) setAvulso(false); return r; }} campos={campos} className="grid gap-2 text-sm md:grid-cols-8">
          <div><label className="rotulo">Código</label><input name="codigo" className="campo" placeholder="PRÓPRIO" /></div>
          <div className="md:col-span-3"><label className="rotulo">Descrição</label><input name="descricao" className="campo" required /></div>
          <div><label className="rotulo">Und.</label><input name="unidade" className="campo" required /></div>
          <div><label className="rotulo">Custo unit. (R$)</label><input name="custo" className="campo text-right" required inputMode="decimal" /></div>
          <div><label className="rotulo">Quantidade</label><input name="quantidade" className="campo text-right" required inputMode="decimal" /></div>
          <div className="md:col-span-8"><label className="rotulo">Origem do custo (cotação, fornecedor, data)</label><input name="observacao" className="campo" /></div>
          <div className="flex gap-2 md:col-span-8"><button className="btn-primario">Adicionar</button><button type="button" className="btn-secundario" onClick={() => setAvulso(false)}>Cancelar</button></div>
        </FormAcao>
      )}
    </div>
  );
}

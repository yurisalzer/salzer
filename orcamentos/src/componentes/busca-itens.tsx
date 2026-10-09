"use client";

import { useEffect, useRef, useState } from "react";

export interface ItemEncontrado {
  id: string;
  fonte: string;
  tipo: string;
  codigo: string;
  descricao: string;
  unidade: string;
  revisao_base_id: string | null;
  regime_codigo: string | null;
  preco: string | null;
  situacao: string | null;
}

/** Campo de busca de itens EMOP/SINAPI/próprios com resultados em lista. */
export function BuscaItens({ revisoes, regime, regimes, proprios = true, aoEscolher }: { revisoes: string[]; regime: string; regimes?: string[]; proprios?: boolean; aoEscolher: (i: ItemEncontrado) => void }) {
  const [q, setQ] = useState("");
  const [itens, setItens] = useState<ItemEncontrado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setItens([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setCarregando(true);
      const p = new URLSearchParams({ q, regime, revisoes: revisoes.join(","), regimes: (regimes ?? []).join(","), proprios: proprios ? "1" : "0" });
      const r = await fetch(`/api/referencias/busca?${p}`);
      const j = await r.json().catch(() => ({ itens: [] }));
      setItens(j.itens ?? []);
      setCarregando(false);
    }, 300);
  }, [q, regime, regimes, revisoes, proprios]);

  return (
    <div>
      <input className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código ou descrição (mín. 2 caracteres)" />
      {carregando && <p className="text-xs text-slate-500">Buscando…</p>}
      {itens.length > 0 && (
        <ul className="mt-1 max-h-72 overflow-auto rounded border border-slate-200 bg-white text-sm shadow">
          {itens.map((i) => (
            <li key={`${i.id}-${i.revisao_base_id}`}>
              <button type="button" className="block w-full px-2 py-1 text-left hover:bg-marca-50" onClick={() => { aoEscolher(i); setQ(""); setItens([]); }}>
                <span className="font-mono text-xs">{i.fonte} {i.codigo}</span> — {i.descricao.slice(0, 140)} <span className="text-slate-500">({i.unidade})</span>
                <span className="float-right tabular-nums">{i.preco !== null ? i.preco : i.fonte === "PROPRIA" ? "própria" : (i.situacao ?? "")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

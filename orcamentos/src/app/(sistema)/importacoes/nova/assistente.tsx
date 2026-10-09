"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const REGIMES = [
  { codigo: "SEM_DESONERACAO", nome: "Sem desoneração" },
  { codigo: "COM_DESONERACAO", nome: "Com desoneração" },
  { codigo: "SEM_ENCARGOS", nome: "Sem encargos sociais" },
] as const;

const INSTRUCOES = {
  EMOP: "Envie o arquivo RAR/ZIP do boletim mensal da EMOP (ex.: EMOP_012026.rar) ou os seis DBF: EMOPmmaa, DIPRmmaa, COMPmmaa, MATmmaa, REUTmmaa e ELEMmmaa. PDFs e DOCX do pacote são apenas registrados.",
  SINAPI: "Envie o ZIP \"SINAPI-AAAA-MM-formato-xlsx\" publicado pela Caixa ou as planilhas SINAPI_Referência_AAAA_MM.xlsx (obrigatória), SINAPI_mao_de_obra e SINAPI_Manutenções (opcionais).",
};

function Passo({ atual, n, titulo, children }: { atual: number; n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className={`cartao ${atual === n ? "" : atual > n ? "opacity-80" : "opacity-40"}`}>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs text-white ${atual > n ? "bg-emerald-600" : "bg-marca-600"}`}>{atual > n ? "✓" : n}</span>
        {titulo}
      </h2>
      {atual >= n && children}
    </section>
  );
}

export function Assistente({ podeAutorizarDuplicidade, limiteMb }: { podeAutorizarDuplicidade: boolean; limiteMb: number }) {
  const router = useRouter();
  const [passo, setPasso] = useState(1);
  const [fonte, setFonte] = useState<"EMOP" | "SINAPI" | null>(null);
  const [competencia, setCompetencia] = useState("2026-01");
  const [regimes, setRegimes] = useState<string[]>(["SEM_DESONERACAO", "COM_DESONERACAO"]);
  const [rotulo, setRotulo] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const tamanhoTotal = useMemo(() => arquivos.reduce((s, a) => s + a.size, 0), [arquivos]);
  const competenciaValida = /^\d{4}-\d{2}$/.test(competencia) && competencia >= "2026-01";

  async function enviar() {
    if (!fonte) return;
    setEnviando(true);
    setErro(null);
    const fd = new FormData();
    fd.set("fonte", fonte);
    fd.set("competencia", competencia);
    fd.set("uf", "RJ");
    fd.set("regimes", (fonte === "EMOP" ? ["SEM_DESONERACAO", "COM_DESONERACAO"] : regimes).join(","));
    if (rotulo.trim()) fd.set("rotulo", rotulo.trim());
    if (justificativa.trim()) fd.set("justificativa", justificativa.trim());
    for (const a of arquivos) fd.append("arquivos", a, a.name);
    try {
      const r = await fetch("/api/importacoes", { method: "POST", body: fd });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.erro ?? `Falha no envio (${r.status})`);
      router.push(`/importacoes/${corpo.loteId}`);
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Passo atual={passo} n={1} titulo="Fonte de referência">
        <div className="flex gap-3">
          {(["EMOP", "SINAPI"] as const).map((f) => (
            <button key={f} type="button" disabled={passo > 1 && enviando}
              onClick={() => { setFonte(f); setRegimes(f === "EMOP" ? ["SEM_DESONERACAO", "COM_DESONERACAO"] : ["SEM_DESONERACAO", "COM_DESONERACAO", "SEM_ENCARGOS"]); setPasso(2); }}
              className={`rounded-md border px-4 py-3 text-left text-sm ${fonte === f ? "border-marca-600 bg-marca-50" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
              <div className="font-semibold">{f === "EMOP" ? "EMOP-RJ" : "SINAPI"}</div>
              <div className="text-xs text-slate-500">{f === "EMOP" ? "Arquivos DBF do boletim mensal" : "Planilhas XLSX da Caixa (UF RJ)"}</div>
            </button>
          ))}
        </div>
      </Passo>

      <Passo atual={passo} n={2} titulo="Competência">
        <div className="flex items-end gap-3">
          <div>
            <label className="rotulo" htmlFor="comp">Mês de referência</label>
            <input id="comp" type="month" min="2026-01" className="campo w-48" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </div>
          <div className="text-sm text-slate-500">UF: <strong>RJ</strong></div>
          {passo === 2 && <button type="button" className="btn-primario" disabled={!competenciaValida} onClick={() => setPasso(3)}>Continuar</button>}
        </div>
        {!competenciaValida && <p className="mt-2 text-xs text-red-700">Informe uma competência a partir de janeiro/2026.</p>}
        <p className="mt-2 text-xs text-slate-500">A competência é conferida com o conteúdo dos arquivos; divergências bloqueiam a importação.</p>
      </Passo>

      <Passo atual={passo} n={3} titulo="Regimes de encargos">
        {fonte === "EMOP" ? (
          <p className="text-sm text-slate-600">
            A EMOP publica os dois regimes no mesmo arquivo: códigos terminados em 0–4 são <strong>sem desoneração</strong> e em A–E são <strong>com desoneração</strong> (Catálogo de Referência). Ambos serão importados.
          </p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {REGIMES.map((r) => (
              <label key={r.codigo} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={regimes.includes(r.codigo)}
                  onChange={(e) => setRegimes((atual) => (e.target.checked ? [...atual, r.codigo] : atual.filter((x) => x !== r.codigo)))} />
                {r.nome}
              </label>
            ))}
          </div>
        )}
        <div className="mt-3">
          <label className="rotulo" htmlFor="rotulo">Identificação da publicação (opcional)</label>
          <input id="rotulo" className="campo max-w-xs" placeholder="Original, Retificação 01…" value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Se vazio, é sugerido pelo nome do arquivo (ex.: "…_Retificacao01.zip" → Retificação 01).</p>
        </div>
        {passo === 3 && <button type="button" className="btn-primario mt-3" disabled={regimes.length === 0} onClick={() => setPasso(4)}>Continuar</button>}
      </Passo>

      <Passo atual={passo} n={4} titulo="Arquivos oficiais">
        {fonte && <p className="mb-3 text-sm text-slate-600">{INSTRUCOES[fonte]}</p>}
        <input type="file" multiple accept=".rar,.zip,.dbf,.xls,.xlsx" className="block text-sm"
          onChange={(e) => setArquivos(Array.from(e.target.files ?? []))} disabled={enviando} />
        {arquivos.length > 0 && (
          <ul className="mt-2 text-xs text-slate-600">
            {arquivos.map((a) => <li key={a.name}>{a.name} — {(a.size / 1024 / 1024).toFixed(2)} MB</li>)}
          </ul>
        )}
        {tamanhoTotal > limiteMb * 1024 * 1024 && <p className="mt-2 text-xs text-red-700">Tamanho acima do limite de {limiteMb} MB por arquivo.</p>}
        {podeAutorizarDuplicidade && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-slate-600">Reimportar arquivo já importado (exige justificativa)</summary>
            <textarea className="campo mt-2" rows={2} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Motivo da reimportação" />
          </details>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className="btn-primario" disabled={arquivos.length === 0 || enviando || !fonte} onClick={enviar}>
            {enviando ? "Enviando e analisando…" : "Enviar e analisar"}
          </button>
          {enviando && <span className="text-xs text-slate-500">Arquivos completos podem levar até um minuto. Não feche a página.</span>}
        </div>
        {erro && <p className="alerta-erro mt-3">{erro}</p>}
        <p className="mt-3 text-xs text-slate-500">
          Próximos passos: identificação do layout, validação, pré-visualização, confirmação e gravação. Nada é gravado nas bases antes da sua confirmação.
        </p>
      </Passo>
    </div>
  );
}

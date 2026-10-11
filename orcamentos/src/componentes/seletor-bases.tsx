import { formatarCompetencia } from "@/dominio/formato";
import type { RevisaoPublicada } from "@/servidor/consultas";

const REGIMES = [
  ["SEM_DESONERACAO", "Sem desoneração"],
  ["COM_DESONERACAO", "Com desoneração"],
  ["SEM_ENCARGOS", "Sem encargos sociais"],
] as const;

/** Campos para escolher base EMOP/SINAPI (competência/publicação) e regime. */
export function SeletorBases({ revisoes, padrao }: { revisoes: RevisaoPublicada[]; padrao?: { emop?: string; sinapi?: string; regimeEmop?: string; regimeSinapi?: string } }) {
  const de = (f: string) => revisoes.filter((r) => r.fonte === f);
  return (
    <>
      {(["EMOP", "SINAPI"] as const).map((f) => (
        <div key={f} className="md:col-span-2 grid grid-cols-2 gap-2">
          <div>
            <label className="rotulo">Base {f}</label>
            <select name={f.toLowerCase()} className="campo" defaultValue={f === "EMOP" ? padrao?.emop ?? de(f)[0]?.id ?? "" : padrao?.sinapi ?? de(f)[0]?.id ?? ""}>
              <option value="">Não usar</option>
              {de(f).map((r) => <option key={r.id} value={r.id}>{formatarCompetencia(r.competencia)} — {r.rotulo}</option>)}
            </select>
          </div>
          <div>
            <label className="rotulo">Regime {f}</label>
            <select name={`regime_${f.toLowerCase()}`} className="campo" defaultValue={(f === "EMOP" ? padrao?.regimeEmop : padrao?.regimeSinapi) ?? "SEM_DESONERACAO"}>
              {REGIMES.filter(([k]) => f === "SINAPI" || k !== "SEM_ENCARGOS").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
      ))}
    </>
  );
}

import { revisoesPublicadas } from "@/servidor/consultas";
import { formatarCompetencia } from "@/dominio/formato";

/** Bases vigentes (publicadas) usadas pelos editores. */
export async function basesVigentes() {
  const revs = await revisoesPublicadas();
  const vigentes = ["EMOP", "SINAPI"].map((f) => revs.find((r) => r.fonte === f)).filter((r): r is NonNullable<typeof r> => !!r);
  return { ids: vigentes.map((r) => r.id), rotulo: vigentes.map((r) => `${r.fonte} ${formatarCompetencia(r.competencia)} (${r.rotulo})`).join(", ") || "nenhuma publicada" };
}

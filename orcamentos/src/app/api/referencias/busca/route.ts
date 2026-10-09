import { autorizarApi, respostaDeErro } from "@/servidor/api";
import { buscarItens } from "@/servidor/consultas";

export const dynamic = "force-dynamic";

/** Busca usada pelos editores (composição própria e orçamento). */
export async function GET(req: Request) {
  try {
    await autorizarApi("bases.consultar");
    const u = new URL(req.url);
    const revisoes = (u.searchParams.get("revisoes") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x));
    const tipo = u.searchParams.get("tipo");
    const itens = await buscarItens({
      texto: u.searchParams.get("q") ?? "",
      revisoes,
      regime: u.searchParams.get("regime") ?? "SEM_DESONERACAO",
      tipo: tipo === "INSUMO" || tipo === "COMPOSICAO" ? tipo : undefined,
      incluirProprios: u.searchParams.get("proprios") === "1",
      limite: 30,
    });
    return Response.json({ itens });
  } catch (e) {
    return respostaDeErro(e);
  }
}

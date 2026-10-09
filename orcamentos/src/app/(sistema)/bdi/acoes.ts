"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigir } from "@/servidor/autenticacao";
import { usuarioAtual } from "@/servidor/sessao";
import { alternarPerfilBdi, criarPerfilBdi } from "@/servidor/bdi";
import { CODIGOS_PARCELA } from "@/dominio/bdi";
import { decimalDeTextoBR } from "@/dominio/decimal";
import { ErroDeNegocio } from "@/importacao/servico";
import type { EstadoAcao } from "@/componentes/botao-acao";

export async function acaoCriarPerfil(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  let id = "";
  try {
    const u = await usuarioAtual();
    exigir(u, "bdi.editar");
    const num = (k: string) => {
      const t = String(f.get(k) ?? "").trim();
      if (!t) return "";
      try { return decimalDeTextoBR(t)!.toString(); } catch { throw new ErroDeNegocio(`Número inválido em ${k}: ${t}`); }
    };
    const p = await criarPerfilBdi({
      nome: String(f.get("nome") ?? ""), descricao: String(f.get("descricao") ?? ""), tipoObra: String(f.get("tipo") ?? ""),
      regime: String(f.get("regime") ?? "") || null, percentualAdotado: num("adotado") || null, fonteDocumento: String(f.get("documento") ?? ""),
      parcelas: CODIGOS_PARCELA.map((c) => ({ codigo: c, percentual: num(c) })),
    }, u.id);
    id = p.id;
  } catch (e) {
    if (e instanceof ErroDeNegocio || (e instanceof Error && /BDI|tributos|Parcela|permissão/.test(e.message))) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível criar o perfil." };
  }
  revalidatePath("/bdi");
  redirect(`/bdi#p-${id}`);
}

export async function acaoAlternarPerfil(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  const u = await usuarioAtual();
  try {
    exigir(u, "bdi.editar");
  } catch (e) {
    return { erro: (e as Error).message };
  }
  await alternarPerfilBdi(String(f.get("id")), f.get("ativo") === "1", u.id);
  revalidatePath("/bdi");
  return {};
}

"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/servidor/autenticacao";
import { ipRequisicao, usuarioAtual } from "@/servidor/sessao";
import { cancelarImportacao, confirmarImportacao, ErroDeNegocio, publicarRevisaoBase, rejeitarRevisaoBase } from "@/importacao/servico";
import type { EstadoAcao } from "@/componentes/botao-acao";

function mensagem(e: unknown): string {
  if (e instanceof ErroDeNegocio) return e.message;
  if (e instanceof Error && /permissão/.test(e.message)) return e.message;
  console.error(e);
  return "Não foi possível concluir a operação. Nenhum dado foi gravado. Detalhes no registro do lote.";
}

export async function acaoConfirmarLote(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  try {
    const u = await usuarioAtual();
    exigir(u, "importacao.executar");
    const id = String(f.get("loteId"));
    await confirmarImportacao(id, u.id, { ip: await ipRequisicao() });
    revalidatePath(`/importacoes/${id}`);
    return { ok: "Base gravada. Revise e publique para disponibilizá-la aos orçamentos." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function acaoCancelarLote(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  try {
    const u = await usuarioAtual();
    exigir(u, "importacao.executar");
    const id = String(f.get("loteId"));
    await cancelarImportacao(id, u.id);
    revalidatePath(`/importacoes/${id}`);
    return { ok: "Importação cancelada." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function acaoPublicarRevisao(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  try {
    const u = await usuarioAtual();
    exigir(u, "bases.publicar");
    await publicarRevisaoBase(String(f.get("revisaoId")), u.id, await ipRequisicao());
    revalidatePath("/bases");
    revalidatePath("/importacoes");
    return { ok: "Revisão publicada." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

export async function acaoRejeitarRevisao(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  try {
    const u = await usuarioAtual();
    exigir(u, "bases.publicar");
    await rejeitarRevisaoBase(String(f.get("revisaoId")), String(f.get("motivo") ?? ""), u.id, await ipRequisicao());
    revalidatePath("/bases");
    revalidatePath("/importacoes");
    return { ok: "Revisão rejeitada." };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}

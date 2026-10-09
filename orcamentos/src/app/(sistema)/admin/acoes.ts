"use server";

import { revalidatePath } from "next/cache";
import { exigir } from "@/servidor/autenticacao";
import { usuarioAtual } from "@/servidor/sessao";
import { criarUsuario, definirAtivo, definirPapel, redefinirSenha, trocarPropriaSenha } from "@/servidor/usuarios";
import { ErroDeNegocio } from "@/importacao/servico";
import type { EstadoAcao } from "@/componentes/botao-acao";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

async function comoAdmin(fn: (adminId: string) => Promise<string | void>): Promise<EstadoAcao> {
  try {
    const u = await usuarioAtual();
    exigir(u, "usuarios.gerenciar");
    const ok = await fn(u.id);
    revalidatePath("/admin/usuarios");
    return { ok: ok || "Salvo." };
  } catch (e) {
    if (e instanceof ErroDeNegocio || (e instanceof Error && /permissão/.test(e.message))) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível concluir a operação." };
  }
}

export async function acaoCriarUsuario(_e: EstadoAcao, f: FormData) {
  return comoAdmin(async (a) => { await criarUsuario({ nome: s(f, "nome"), email: s(f, "email"), papel: s(f, "papel"), senha: s(f, "senha") }, a); return "Usuário criado."; });
}
export async function acaoPapel(_e: EstadoAcao, f: FormData) {
  return comoAdmin((a) => definirPapel(s(f, "usuarioId"), s(f, "papel"), a));
}
export async function acaoAtivo(_e: EstadoAcao, f: FormData) {
  return comoAdmin((a) => definirAtivo(s(f, "usuarioId"), s(f, "ativo") === "1", a));
}
export async function acaoRedefinirSenha(_e: EstadoAcao, f: FormData) {
  return comoAdmin(async (a) => { await redefinirSenha(s(f, "usuarioId"), s(f, "senha"), a); return "Senha redefinida; sessões do usuário encerradas."; });
}
export async function acaoTrocarSenha(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  try {
    const u = await usuarioAtual();
    if (!u) return { erro: "Sessão expirada." };
    if (s(f, "nova") !== s(f, "confirmacao")) return { erro: "A confirmação não confere." };
    await trocarPropriaSenha(u.id, s(f, "atual"), s(f, "nova"), u.sessaoId);
    return { ok: "Senha alterada. Outras sessões foram encerradas." };
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível alterar a senha." };
  }
}

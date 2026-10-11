import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { COOKIE_SESSAO, usuarioDoToken, type UsuarioSessao } from "./autenticacao";
import type { Permissao } from "./permissoes";

/** Usuário da requisição atual (memoizado por requisição). */
export const usuarioAtual = cache(async (): Promise<UsuarioSessao | null> => {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  return usuarioDoToken(token);
});

/** Para páginas: exige login (e opcionalmente permissão), senão redireciona. */
export async function exigirUsuario(permissao?: Permissao): Promise<UsuarioSessao> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (permissao && !u.permissoes.has(permissao)) redirect("/sem-permissao");
  return u;
}

export async function ipRequisicao(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

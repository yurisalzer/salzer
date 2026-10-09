import "server-only";
import { cookies, headers } from "next/headers";
import { COOKIE_SESSAO, usuarioDoToken, type UsuarioSessao } from "./autenticacao";
import type { Permissao } from "./permissoes";

export class RespostaErro extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Para rotas /api: exige sessão, permissão e (em POST) origem do próprio site — proteção CSRF. */
export async function autorizarApi(permissao: Permissao, metodo: "GET" | "POST" = "GET"): Promise<UsuarioSessao> {
  const h = await headers();
  if (metodo === "POST") {
    const origem = h.get("origin");
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!origem || !host || new URL(origem).host !== host) throw new RespostaErro(403, "Origem da requisição não permitida");
  }
  const u = await usuarioDoToken((await cookies()).get(COOKIE_SESSAO)?.value);
  if (!u) throw new RespostaErro(401, "Sessão expirada. Entre novamente.");
  if (!u.permissoes.has(permissao)) throw new RespostaErro(403, "Sem permissão para esta operação");
  return u;
}

export function respostaDeErro(e: unknown): Response {
  if (e instanceof RespostaErro) return Response.json({ erro: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ erro: "Erro interno. Tente novamente ou contate o administrador." }, { status: 500 });
}

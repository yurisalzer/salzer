"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_SESSAO, entrar, sair } from "@/servidor/autenticacao";

export interface EstadoLogin {
  erro?: string;
  email?: string;
}

// Limite simples por IP (em memória do processo): no máximo 20 tentativas a cada 10 minutos.
const tentativasPorIp = new Map<string, number[]>();
function excedeuLimite(ip: string | null): boolean {
  const chave = ip ?? "desconhecido";
  const agora = Date.now();
  const lista = (tentativasPorIp.get(chave) ?? []).filter((t) => agora - t < 10 * 60 * 1000);
  lista.push(agora);
  tentativasPorIp.set(chave, lista);
  if (tentativasPorIp.size > 10000) tentativasPorIp.clear();
  return lista.length > 20;
}

export async function acaoEntrar(_estado: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "");
  const senha = String(form.get("senha") ?? "");
  if (!email || !senha) return { erro: "Informe e-mail e senha.", email };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (excedeuLimite(ip)) return { erro: "Muitas tentativas a partir desta rede. Aguarde alguns minutos.", email };
  const r = await entrar(email, senha, { ip, userAgent: h.get("user-agent") });
  if (!r.ok) {
    if (r.motivo === "BLOQUEADO") return { erro: "Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em alguns minutos.", email };
    return { erro: "E-mail ou senha inválidos.", email };
  }
  (await cookies()).set(COOKIE_SESSAO, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: r.expiraEm,
  });
  redirect("/");
}

export async function acaoSair(): Promise<void> {
  const jar = await cookies();
  await sair(jar.get(COOKIE_SESSAO)?.value);
  jar.delete(COOKIE_SESSAO);
  redirect("/login");
}

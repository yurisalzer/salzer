import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { conferirSenha, obterHashFicticio } from "./senha";
import { auditar } from "./auditoria";
import type { Permissao } from "./permissoes";

export const COOKIE_SESSAO = "orc_sessao";
export const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // 12 horas
export const MAX_TENTATIVAS = 5;
export const BLOQUEIO_MS = 15 * 60 * 1000; // 15 minutos

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  papeis: string[];
  permissoes: Set<Permissao>;
  sessaoId: string;
}

export type ResultadoLogin =
  | { ok: true; token: string; expiraEm: Date; usuarioId: string }
  | { ok: false; motivo: "CREDENCIAIS" | "BLOQUEADO" | "INATIVO"; bloqueadoAte?: Date };

/**
 * Verifica credenciais e cria sessão. Mensagens ao usuário devem ser genéricas
 * ("e-mail ou senha inválidos") para não revelar quais contas existem.
 */
export async function entrar(email: string, senha: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<ResultadoLogin> {
  const emailNorm = email.trim().toLowerCase();
  const usuario = await prisma.usuarios.findUnique({ where: { email: emailNorm } });
  const agora = new Date();

  if (!usuario) {
    await conferirSenha(await obterHashFicticio(), senha);
    await auditar({ usuarioId: null, acao: "LOGIN_FALHOU", entidade: "usuarios", dados: { email: emailNorm, motivo: "inexistente" }, ip: meta.ip });
    return { ok: false, motivo: "CREDENCIAIS" };
  }
  if (usuario.bloqueado_ate && usuario.bloqueado_ate > agora) {
    await auditar({ usuarioId: usuario.id, acao: "LOGIN_BLOQUEADO", entidade: "usuarios", entidadeId: usuario.id, ip: meta.ip });
    return { ok: false, motivo: "BLOQUEADO", bloqueadoAte: usuario.bloqueado_ate };
  }
  const senhaOk = await conferirSenha(usuario.senha_hash, senha);
  if (!senhaOk) {
    const tentativas = usuario.tentativas_falhas + 1;
    const bloquear = tentativas >= MAX_TENTATIVAS;
    await prisma.usuarios.update({
      where: { id: usuario.id },
      data: { tentativas_falhas: bloquear ? 0 : tentativas, bloqueado_ate: bloquear ? new Date(agora.getTime() + BLOQUEIO_MS) : null },
    });
    await auditar({ usuarioId: usuario.id, acao: bloquear ? "CONTA_BLOQUEADA" : "LOGIN_FALHOU", entidade: "usuarios", entidadeId: usuario.id, dados: { tentativas }, ip: meta.ip });
    return { ok: false, motivo: "CREDENCIAIS" };
  }
  if (!usuario.ativo) {
    await auditar({ usuarioId: usuario.id, acao: "LOGIN_INATIVO", entidade: "usuarios", entidadeId: usuario.id, ip: meta.ip });
    return { ok: false, motivo: "INATIVO" };
  }

  const token = randomBytes(32).toString("base64url");
  const expiraEm = new Date(agora.getTime() + DURACAO_SESSAO_MS);
  await prisma.$transaction(async (tx) => {
    await tx.sessoes.create({
      data: { usuario_id: usuario.id, token_hash: hashToken(token), expira_em: expiraEm, ip: meta.ip ?? null, user_agent: meta.userAgent?.slice(0, 300) ?? null },
    });
    await tx.usuarios.update({ where: { id: usuario.id }, data: { tentativas_falhas: 0, bloqueado_ate: null, ultimo_login_em: agora } });
    await auditar({ usuarioId: usuario.id, acao: "LOGIN", entidade: "usuarios", entidadeId: usuario.id, ip: meta.ip }, tx);
  });
  // Limpeza oportunista de sessões expiradas
  await prisma.sessoes.deleteMany({ where: { expira_em: { lt: agora } } });
  return { ok: true, token, expiraEm, usuarioId: usuario.id };
}

/** Resolve o usuário de um token de sessão (ou null se inválido/expirado/inativo). */
export async function usuarioDoToken(token: string | undefined | null): Promise<UsuarioSessao | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const sessao = await prisma.sessoes.findUnique({
    where: { token_hash: hashToken(token) },
    include: {
      usuarios: {
        include: { usuarios_papeis: { include: { papeis: { include: { papeis_permissoes: { include: { permissoes: true } } } } } } },
      },
    },
  });
  if (!sessao || sessao.expira_em <= new Date() || !sessao.usuarios.ativo) return null;
  const u = sessao.usuarios;
  const permissoes = new Set<Permissao>();
  for (const up of u.usuarios_papeis) for (const pp of up.papeis.papeis_permissoes) permissoes.add(pp.permissoes.codigo as Permissao);
  // Atualiza "último uso" no máximo a cada 5 minutos
  if (Date.now() - sessao.ultimo_uso_em.getTime() > 5 * 60 * 1000) {
    await prisma.sessoes.update({ where: { id: sessao.id }, data: { ultimo_uso_em: new Date() } });
  }
  return { id: u.id, nome: u.nome, email: u.email, papeis: u.usuarios_papeis.map((x) => x.papeis.codigo), permissoes, sessaoId: sessao.id };
}

export async function sair(token: string | undefined | null): Promise<void> {
  if (!token) return;
  const s = await prisma.sessoes.findUnique({ where: { token_hash: hashToken(token) } });
  if (s) {
    await prisma.sessoes.delete({ where: { id: s.id } });
    await auditar({ usuarioId: s.usuario_id, acao: "LOGOUT", entidade: "usuarios", entidadeId: s.usuario_id });
  }
}

export class ErroPermissao extends Error {
  constructor(public permissao: Permissao) {
    super(`Você não tem permissão para esta ação (${permissao}).`);
  }
}

export function temPermissao(u: UsuarioSessao | null, p: Permissao): boolean {
  return !!u && u.permissoes.has(p);
}

export function exigir(u: UsuarioSessao | null, p: Permissao): asserts u is UsuarioSessao {
  if (!u) throw new ErroPermissao(p);
  if (!u.permissoes.has(p)) throw new ErroPermissao(p);
}

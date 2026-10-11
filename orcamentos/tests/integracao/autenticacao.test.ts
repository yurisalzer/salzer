import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/servidor/db";
import { MAX_TENTATIVAS, entrar, exigir, sair, temPermissao, usuarioDoToken } from "@/servidor/autenticacao";
import { criarUsuario, limparBanco, temBanco } from "./banco";

describe.skipIf(!temBanco)("autenticação e permissões", () => {
  beforeAll(async () => {
    await limparBanco(prisma);
    await criarUsuario(prisma, "admin@teste.com", "ADMINISTRADOR");
    await criarUsuario(prisma, "leitor@teste.com", "CONSULTA");
  });
  afterAll(() => prisma.$disconnect());

  it("login correto cria sessão; o banco guarda só o hash do token", async () => {
    const r = await entrar("ADMIN@teste.com ", "senha-forte-123");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = await prisma.sessoes.findFirstOrThrow();
    expect(s.token_hash).not.toBe(r.token);
    expect(s.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const u = await usuarioDoToken(r.token);
    expect(u?.email).toBe("admin@teste.com");
    expect(temPermissao(u, "usuarios.gerenciar")).toBe(true);
    await sair(r.token);
    expect(await usuarioDoToken(r.token)).toBeNull();
  });

  it("senha errada e e-mail inexistente retornam o mesmo motivo genérico", async () => {
    const a = await entrar("admin@teste.com", "errada-123456");
    const b = await entrar("ninguem@teste.com", "errada-123456");
    expect(a).toEqual({ ok: false, motivo: "CREDENCIAIS" });
    expect(b).toEqual({ ok: false, motivo: "CREDENCIAIS" });
  });

  it(`bloqueia após ${MAX_TENTATIVAS} tentativas, mesmo com a senha correta depois`, async () => {
    for (let i = 0; i < MAX_TENTATIVAS; i++) await entrar("leitor@teste.com", "errada-123456");
    const r = await entrar("leitor@teste.com", "senha-forte-123");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("BLOQUEADO");
    const eventos = await prisma.auditoria.count({ where: { acao: "CONTA_BLOQUEADA" } });
    expect(eventos).toBe(1);
  });

  it("papel CONSULTA não pode editar orçamentos", async () => {
    await prisma.usuarios.update({ where: { email: "leitor@teste.com" }, data: { bloqueado_ate: null } });
    const r = await entrar("leitor@teste.com", "senha-forte-123");
    if (!r.ok) throw new Error("login falhou");
    const u = await usuarioDoToken(r.token);
    expect(temPermissao(u, "orcamentos.ver")).toBe(true);
    expect(() => exigir(u, "orcamentos.editar")).toThrow(/permissão/);
  });

  it("token inválido ou expirado não autentica", async () => {
    expect(await usuarioDoToken("x".repeat(43))).toBeNull();
    const r = await entrar("admin@teste.com", "senha-forte-123");
    if (!r.ok) throw new Error("login falhou");
    await prisma.sessoes.updateMany({ data: { expira_em: new Date(Date.now() - 1000) } });
    expect(await usuarioDoToken(r.token)).toBeNull();
  });

  it("usuário inativo não entra", async () => {
    await prisma.usuarios.update({ where: { email: "admin@teste.com" }, data: { ativo: false } });
    const r = await entrar("admin@teste.com", "senha-forte-123");
    expect(r).toMatchObject({ ok: false, motivo: "INATIVO" });
    await prisma.usuarios.update({ where: { email: "admin@teste.com" }, data: { ativo: true } });
  });

  it("auditoria é somente-inserção (gatilho do banco)", async () => {
    const a = await prisma.auditoria.findFirstOrThrow();
    await expect(prisma.auditoria.update({ where: { id: a.id }, data: { acao: "X" } })).rejects.toThrow(/não podem ser alterados/);
    await expect(prisma.auditoria.delete({ where: { id: a.id } })).rejects.toThrow(/não podem ser alterados/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/servidor/db";
import { entrar, usuarioDoToken } from "@/servidor/autenticacao";
import { criarUsuario, definirAtivo, definirPapel, redefinirSenha, trocarPropriaSenha } from "@/servidor/usuarios";
import { criarUsuario as criarDireto, limparBanco, temBanco } from "./banco";

describe.skipIf(!temBanco)("gestão de usuários", () => {
  let admin = "";
  beforeAll(async () => {
    await limparBanco(prisma);
    admin = (await criarDireto(prisma, "chefe@teste.com")).id;
  });
  afterAll(() => prisma.$disconnect());

  it("cria usuário com senha forte e papel", async () => {
    await expect(criarUsuario({ nome: "Ana", email: "ana@teste.com", papel: "ORCAMENTISTA", senha: "curta" }, admin)).rejects.toThrow(/10 caracteres/);
    const u = await criarUsuario({ nome: "Ana", email: "Ana@Teste.com", papel: "ORCAMENTISTA", senha: "senha-da-ana-1" }, admin);
    expect(u.email).toBe("ana@teste.com");
    await expect(criarUsuario({ nome: "Ana 2", email: "ana@teste.com", papel: "CONSULTA", senha: "senha-da-ana-1" }, admin)).rejects.toThrow(/Já existe/);
    const r = await entrar("ana@teste.com", "senha-da-ana-1");
    expect(r.ok).toBe(true);
  });

  it("troca de papel altera permissões; administrador não rebaixa a si mesmo", async () => {
    const ana = await prisma.usuarios.findUniqueOrThrow({ where: { email: "ana@teste.com" } });
    await definirPapel(ana.id, "CONSULTA", admin);
    const r = await entrar("ana@teste.com", "senha-da-ana-1");
    if (!r.ok) throw new Error();
    expect((await usuarioDoToken(r.token))!.permissoes.has("orcamentos.editar")).toBe(false);
    await expect(definirPapel(admin, "CONSULTA", admin)).rejects.toThrow(/próprio papel/);
  });

  it("desativar encerra sessões; redefinir senha também", async () => {
    const ana = await prisma.usuarios.findUniqueOrThrow({ where: { email: "ana@teste.com" } });
    const r = await entrar("ana@teste.com", "senha-da-ana-1");
    if (!r.ok) throw new Error();
    await definirAtivo(ana.id, false, admin);
    expect(await usuarioDoToken(r.token)).toBeNull();
    await expect(definirAtivo(admin, false, admin)).rejects.toThrow(/próprio usuário/);
    await definirAtivo(ana.id, true, admin);
    await redefinirSenha(ana.id, "nova-senha-123", admin);
    expect((await entrar("ana@teste.com", "senha-da-ana-1")).ok).toBe(false);
    expect((await entrar("ana@teste.com", "nova-senha-123")).ok).toBe(true);
  });

  it("troca da própria senha exige a atual", async () => {
    const ana = await prisma.usuarios.findUniqueOrThrow({ where: { email: "ana@teste.com" } });
    const r = await entrar("ana@teste.com", "nova-senha-123");
    if (!r.ok) throw new Error();
    const s = (await usuarioDoToken(r.token))!;
    await expect(trocarPropriaSenha(ana.id, "errada-12345", "outra-senha-456", s.sessaoId)).rejects.toThrow(/atual incorreta/);
    await trocarPropriaSenha(ana.id, "nova-senha-123", "outra-senha-456", s.sessaoId);
    expect(await usuarioDoToken(r.token)).not.toBeNull(); // sessão atual mantida
    expect((await entrar("ana@teste.com", "outra-senha-456")).ok).toBe(true);
  });
});

import { prisma } from "./db";
import { semear } from "./seed";
import { gerarHashSenha, validarForcaSenha } from "./senha";
import { auditar } from "./auditoria";

/**
 * Executado uma vez quando o servidor inicia:
 *  1) garante papéis, permissões e perfis de BDI oficiais (idempotente);
 *  2) se ainda não houver nenhum usuário, cria o primeiro administrador a partir de
 *     ADMIN_EMAIL / ADMIN_NOME / ADMIN_SENHA_INICIAL (remova a senha da configuração depois).
 */
export async function inicializar(): Promise<void> {
  try {
    await semear(prisma);
    const total = await prisma.usuarios.count();
    if (total > 0) return;
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const senha = process.env.ADMIN_SENHA_INICIAL ?? "";
    if (!email || !senha) {
      console.warn("[inicialização] Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_SENHA_INICIAL e reinicie o serviço.");
      return;
    }
    const erro = validarForcaSenha(senha);
    if (erro) {
      console.error(`[inicialização] ADMIN_SENHA_INICIAL inválida: ${erro}`);
      return;
    }
    const papel = await prisma.papeis.findUniqueOrThrow({ where: { codigo: "ADMINISTRADOR" } });
    const u = await prisma.usuarios.create({
      data: { email, nome: process.env.ADMIN_NOME?.trim() || "Administrador", senha_hash: await gerarHashSenha(senha), usuarios_papeis: { create: { papel_id: papel.id } } },
    });
    await auditar({ usuarioId: null, acao: "ADMIN_INICIAL_CRIADO", entidade: "usuarios", entidadeId: u.id, dados: { email } });
    console.log(`[inicialização] Administrador inicial criado: ${email}. Troque a senha no primeiro acesso e remova ADMIN_SENHA_INICIAL.`);
  } catch (e) {
    console.error("[inicialização] Falha:", e);
  }
}

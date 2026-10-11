import { PrismaClient } from "@prisma/client";
import { semear } from "../../prisma/seed";
import { gerarHashSenha } from "@/servidor/senha";

export const temBanco = !!process.env.TEST_DATABASE_URL;

/** Apaga dados de teste (TRUNCATE não dispara gatilhos de linha) e recria o seed. */
export async function limparBanco(prisma: PrismaClient): Promise<void> {
  const tabelas = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
      AND tablename NOT IN ('fontes', 'regimes', '_prisma_migrations')`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tabelas.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await semear(prisma);
}

export async function criarUsuario(prisma: PrismaClient, email: string, papel = "ADMINISTRADOR", senha = "senha-forte-123") {
  const u = await prisma.usuarios.create({ data: { email, nome: email.split("@")[0]!, senha_hash: await gerarHashSenha(senha) } });
  const p = await prisma.papeis.findUniqueOrThrow({ where: { codigo: papel } });
  await prisma.usuarios_papeis.create({ data: { usuario_id: u.id, papel_id: p.id } });
  return u;
}

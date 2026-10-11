/**
 * Cria (ou redefine a senha de) um usuário pelo terminal.
 * Uso:  npm run usuario:criar -- --email voce@empresa.com.br --nome "Seu Nome" --papel ADMINISTRADOR
 * A senha é pedida no terminal (não fica no histórico). Também aceita a variável SENHA_INICIAL.
 */
import { PrismaClient } from "@prisma/client";
import { createInterface } from "node:readline";
import { gerarHashSenha, validarForcaSenha } from "../src/servidor/senha";
import { PAPEIS } from "../src/servidor/permissoes";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function perguntarSenha(): Promise<string> {
  if (process.env.SENHA_INICIAL) return process.env.SENHA_INICIAL;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));
  const s1 = await ask("Senha (mín. 10 caracteres, letras e números): ");
  const s2 = await ask("Repita a senha: ");
  rl.close();
  if (s1 !== s2) throw new Error("As senhas não conferem.");
  return s1;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const nome = arg("nome") ?? email;
  const papel = (arg("papel") ?? "ADMINISTRADOR").toUpperCase();
  if (!email || !nome) throw new Error("Informe --email e --nome.");
  if (!PAPEIS[papel]) throw new Error(`Papel inválido. Use: ${Object.keys(PAPEIS).join(", ")}`);
  const senha = await perguntarSenha();
  const erro = validarForcaSenha(senha);
  if (erro) throw new Error(erro);
  const prisma = new PrismaClient();
  try {
    const p = await prisma.papeis.findUnique({ where: { codigo: papel } });
    if (!p) throw new Error("Papéis não encontrados. Rode antes: npm run db:seed");
    const senha_hash = await gerarHashSenha(senha);
    const u = await prisma.usuarios.upsert({
      where: { email },
      update: { senha_hash, nome, ativo: true, tentativas_falhas: 0, bloqueado_ate: null, senha_alterada_em: new Date() },
      create: { email, nome, senha_hash },
    });
    await prisma.usuarios_papeis.upsert({
      where: { usuario_id_papel_id: { usuario_id: u.id, papel_id: p.id } },
      update: {},
      create: { usuario_id: u.id, papel_id: p.id },
    });
    await prisma.auditoria.create({ data: { usuario_id: null, acao: "USUARIO_CRIADO_CLI", entidade: "usuarios", entidade_id: u.id, dados: { email, papel } } });
    console.log(`Usuário ${email} pronto com papel ${papel}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exitCode = 1;
});

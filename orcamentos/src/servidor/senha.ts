import { hash, verify } from "@node-rs/argon2";

// Argon2id com parâmetros da recomendação OWASP (m=19 MiB, t=2, p=1).
const OPCOES = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const SENHA_MINIMO = 10;

export function validarForcaSenha(senha: string): string | null {
  if (senha.length < SENHA_MINIMO) return `A senha deve ter pelo menos ${SENHA_MINIMO} caracteres.`;
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) return "A senha deve conter letras e números.";
  return null;
}

export async function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, OPCOES);
}

export async function conferirSenha(hashArmazenado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha);
  } catch {
    return false;
  }
}

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar contas válidas.
let hashFicticio: Promise<string> | null = null;
export function obterHashFicticio(): Promise<string> {
  hashFicticio ??= gerarHashSenha("senha-ficticia-para-tempo-constante-123");
  return hashFicticio;
}

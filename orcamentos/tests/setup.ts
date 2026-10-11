import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Carrega .env (sem dependência externa) e direciona o Prisma para o banco de TESTE.
const arquivo = path.resolve(__dirname, "..", ".env");
if (existsSync(arquivo)) {
  for (const linha of readFileSync(arquivo, "utf8").split("\n")) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(linha);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
}
process.env.TZ = "America/Sao_Paulo";

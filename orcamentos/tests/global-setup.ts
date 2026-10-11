import { execSync } from "node:child_process";
import "./setup";

/** Recria o banco de TESTE do zero (migrações) uma vez por execução. Nunca toca no banco real. */
export default function () {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("[testes] TEST_DATABASE_URL não definido: testes de integração serão pulados.");
    return;
  }
  if (!/teste|test/i.test(url)) throw new Error("Por segurança, TEST_DATABASE_URL deve conter 'teste' ou 'test' no nome.");
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  try {
    // Banco descartável de teste: recria o esquema e aplica as migrações versionadas.
    execSync("npx prisma db execute --stdin --schema prisma/schema.prisma", {
      env,
      input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
      stdio: ["pipe", "pipe", "pipe"],
    });
    execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  } catch (e) {
    console.warn("[testes] Não foi possível preparar o banco de teste:", (e as Error).message.split("\n")[0]);
  }
}

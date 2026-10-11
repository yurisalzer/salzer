/**
 * Dados iniciais idempotentes (também executados automaticamente na inicialização do servidor).
 * Uso: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { semear } from "../src/servidor/seed";

export { semear };

if (require.main === module) {
  const prisma = new PrismaClient();
  semear(prisma)
    .then(() => console.log("Seed concluído."))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

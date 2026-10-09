import { PrismaClient } from "@prisma/client";

// Uma única instância por processo (evita esgotar conexões no modo de desenvolvimento).
const global = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  global.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") global.prisma = prisma;

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

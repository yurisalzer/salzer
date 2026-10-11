import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";

export interface EventoAuditoria {
  usuarioId: string | null;
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  dados?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Grava um evento de auditoria (somente inserção — o banco bloqueia alterações). */
export async function auditar(evento: EventoAuditoria, tx: Tx = prisma): Promise<void> {
  await tx.auditoria.create({
    data: {
      usuario_id: evento.usuarioId,
      acao: evento.acao,
      entidade: evento.entidade,
      entidade_id: evento.entidadeId ?? null,
      dados: evento.dados ?? {},
      ip: evento.ip ?? null,
    },
  });
}

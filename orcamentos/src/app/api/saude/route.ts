import { prisma } from "@/servidor/db";

export const dynamic = "force-dynamic";

/** Verificação de saúde para a hospedagem (não expõe dados). */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}

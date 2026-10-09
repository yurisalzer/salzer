/**
 * Dados iniciais idempotentes: permissões, papéis e perfis de BDI oficiais da EMOP.
 * Fontes e regimes são criados pela própria migração.
 * Uso: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { PAPEIS, PERMISSOES } from "../src/servidor/permissoes";
import { DOCUMENTO_BDI_EMOP, perfisBdiEmop } from "../src/dominio/bdi-emop";
import { NOMES_PARCELA } from "../src/dominio/bdi";

export async function semear(prisma: PrismaClient): Promise<void> {
  for (const [codigo, descricao] of Object.entries(PERMISSOES)) {
    await prisma.permissoes.upsert({ where: { codigo }, update: { descricao }, create: { codigo, descricao } });
  }
  const permissoes = new Map((await prisma.permissoes.findMany()).map((p) => [p.codigo, p.id]));
  for (const [codigo, papel] of Object.entries(PAPEIS)) {
    const p = await prisma.papeis.upsert({
      where: { codigo },
      update: { nome: papel.nome, descricao: papel.descricao },
      create: { codigo, nome: papel.nome, descricao: papel.descricao },
    });
    await prisma.papeis_permissoes.deleteMany({ where: { papel_id: p.id } });
    await prisma.papeis_permissoes.createMany({ data: papel.permissoes.map((c) => ({ papel_id: p.id, permissao_id: permissoes.get(c)! })) });
  }

  for (const perfil of perfisBdiEmop()) {
    const existente = await prisma.perfis_bdi.findUnique({ where: { nome: perfil.nome } });
    if (existente) continue; // não sobrescreve ajustes feitos pelo usuário
    await prisma.perfis_bdi.create({
      data: {
        nome: perfil.nome,
        descricao: `Parcelas transcritas do quadro analítico oficial. Percentual publicado pela EMOP: ${perfil.percentualPublicado}%.`,
        tipo_obra: perfil.tipoObra,
        faixa: perfil.faixa,
        regime_codigo: perfil.regime,
        percentual_adotado: perfil.percentualPublicado,
        fonte_documento: DOCUMENTO_BDI_EMOP,
        parcelas_bdi: {
          create: perfil.parcelas.map((p, i) => ({ codigo: p.codigo, nome: NOMES_PARCELA[p.codigo], percentual: p.percentual, ordem: i + 1 })),
        },
      },
    });
  }
}

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

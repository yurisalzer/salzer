import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/servidor/db";
import { limparBanco, temBanco } from "./banco";

async function criarBasePublicavel(status: "VALIDADA" = "VALIDADA") {
  const fonte = await prisma.fontes.findUniqueOrThrow({ where: { sigla: "SINAPI" } });
  const base = await prisma.bases_referencia.create({ data: { fonte_id: fonte.id, uf: "RJ", competencia: new Date("2026-01-01") } });
  const rev = await prisma.revisoes_base.create({ data: { base_id: base.id, numero: 1, rotulo: "Original", status, regimes: ["SEM_DESONERACAO"] } });
  const item = await prisma.itens_referencia.create({ data: { fonte_id: fonte.id, tipo: "INSUMO", codigo: "00001", descricao: "ITEM", unidade: "UN" } });
  const desc = await prisma.descricoes_item.create({ data: { item_id: item.id, descricao: "ITEM", unidade: "UN", hash: "h" } });
  await prisma.precos_referencia.create({ data: { revisao_base_id: rev.id, regime_codigo: "SEM_DESONERACAO", item_id: item.id, descricao_id: desc.id, preco: "10.5", situacao: "INFORMADO" } });
  return { fonte, base, rev, item, desc };
}

describe.skipIf(!temBanco)("gatilhos de integridade do banco", () => {
  beforeAll(() => limparBanco(prisma));
  afterAll(() => prisma.$disconnect());

  it("preço ausente nunca é gravado como zero (CHECK)", async () => {
    const { rev, item, desc } = await criarBasePublicavel();
    await expect(
      prisma.precos_referencia.create({ data: { revisao_base_id: rev.id, regime_codigo: "COM_DESONERACAO", item_id: item.id, descricao_id: desc.id, preco: null, situacao: "INFORMADO" } }),
    ).rejects.toThrow();
    await expect(
      prisma.precos_referencia.create({ data: { revisao_base_id: rev.id, regime_codigo: "COM_DESONERACAO", item_id: item.id, descricao_id: desc.id, preco: "0", situacao: "AUSENTE" } }),
    ).rejects.toThrow();
  });

  it("base publicada: preços imutáveis e transições de status controladas", async () => {
    await limparBanco(prisma);
    const { rev, item } = await criarBasePublicavel();
    // não pode pular de VALIDADA para SUBSTITUIDA
    await expect(prisma.revisoes_base.update({ where: { id: rev.id }, data: { status: "SUBSTITUIDA" } })).rejects.toThrow(/Transição de status inválida/);
    await prisma.revisoes_base.update({ where: { id: rev.id }, data: { status: "PUBLICADA", publicada_em: new Date() } });
    await expect(
      prisma.precos_referencia.update({
        where: { item_id_revisao_base_id_regime_codigo: { revisao_base_id: rev.id, regime_codigo: "SEM_DESONERACAO", item_id: item.id } },
        data: { preco: "11" },
      }),
    ).rejects.toThrow(/publicada não pode ser alterada/);
    await expect(prisma.revisoes_base.delete({ where: { id: rev.id } })).rejects.toThrow(/não pode ser excluída/);
    // só uma publicada por base
    const rev2 = await prisma.revisoes_base.create({ data: { base_id: rev.base_id, numero: 2, rotulo: "Retificação 01", regimes: ["SEM_DESONERACAO"] } });
    await expect(prisma.revisoes_base.update({ where: { id: rev2.id }, data: { status: "PUBLICADA", publicada_em: new Date() } })).rejects.toThrow();
  });

  it("revisão de orçamento fechada é imutável, inclusive itens e etapas", async () => {
    await limparBanco(prisma);
    const { rev, item } = await criarBasePublicavel();
    await prisma.revisoes_base.update({ where: { id: rev.id }, data: { status: "PUBLICADA", publicada_em: new Date() } });
    const obra = await prisma.obras.create({ data: { nome: "Obra" } });
    const orc = await prisma.orcamentos.create({ data: { obra_id: obra.id, nome: "Orçamento" } });
    const r = await prisma.revisoes_orcamento.create({ data: { orcamento_id: orc.id, numero: 1 } });
    const etapa = await prisma.etapas.create({ data: { revisao_id: r.id, ordem: 1, titulo: "Serviços preliminares" } });
    const io = await prisma.itens_orcamento.create({
      data: {
        revisao_id: r.id, etapa_id: etapa.id, ordem: 1, tipo: "REFERENCIA", item_referencia_id: item.id, revisao_base_id: rev.id,
        regime_codigo: "SEM_DESONERACAO", fonte_sigla: "SINAPI", codigo: "00001", descricao: "ITEM", unidade: "UN",
        custo_unitario: "10.5", quantidade: "2", bdi_percentual: "0", preco_unitario: "10.5", total: "21",
      },
    });
    await prisma.revisoes_orcamento.update({
      where: { id: r.id },
      data: { status: "FECHADA", fechada_em: new Date(), total_geral: "21", total_custo: "21", total_bdi: "0", hash_fechamento: "x" },
    });
    await expect(prisma.itens_orcamento.update({ where: { id: io.id }, data: { quantidade: "3" } })).rejects.toThrow(/fechada não pode ser alterada/);
    await expect(prisma.itens_orcamento.delete({ where: { id: io.id } })).rejects.toThrow(/fechada/);
    await expect(prisma.etapas.create({ data: { revisao_id: r.id, ordem: 2, titulo: "Nova" } })).rejects.toThrow(/fechada/);
    await expect(prisma.revisoes_orcamento.update({ where: { id: r.id }, data: { descricao: "x" } })).rejects.toThrow(/fechada/);
    await expect(prisma.revisoes_orcamento.delete({ where: { id: r.id } })).rejects.toThrow(/fechada/);
  });

  it("item de orçamento não pode usar base ainda não publicada", async () => {
    await limparBanco(prisma);
    const { rev, item } = await criarBasePublicavel();
    const obra = await prisma.obras.create({ data: { nome: "Obra" } });
    const orc = await prisma.orcamentos.create({ data: { obra_id: obra.id, nome: "Orçamento" } });
    const r = await prisma.revisoes_orcamento.create({ data: { orcamento_id: orc.id, numero: 1 } });
    const etapa = await prisma.etapas.create({ data: { revisao_id: r.id, ordem: 1, titulo: "E" } });
    await expect(
      prisma.itens_orcamento.create({
        data: {
          revisao_id: r.id, etapa_id: etapa.id, ordem: 1, tipo: "REFERENCIA", item_referencia_id: item.id, revisao_base_id: rev.id,
          regime_codigo: "SEM_DESONERACAO", fonte_sigla: "SINAPI", codigo: "00001", descricao: "ITEM", unidade: "UN", quantidade: "1",
        },
      }),
    ).rejects.toThrow(/não publicada/);
  });

  it("versões de composição são imutáveis", async () => {
    await limparBanco(prisma);
    const { item, rev } = await criarBasePublicavel();
    const c = await prisma.composicoes.create({
      data: { item_id: item.id, origem: "OFICIAL", hash_conteudo: "abc", primeira_revisao_base_id: rev.id, composicao_itens: { create: [{ ordem: 1, tipo_item: "INSUMO", item_id: item.id, codigo_original: "00001", coeficiente: "1" }] } },
    });
    await expect(prisma.composicao_itens.updateMany({ where: { composicao_id: c.id }, data: { coeficiente: "2" } })).rejects.toThrow(/imutáveis/);
  });
});

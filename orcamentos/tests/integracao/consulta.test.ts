import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/servidor/db";
import { buscarItens, composicaoAnalitica, historicoPrecos, ondeEUsado } from "@/servidor/consultas";
import { copiarComoPropria, custoComposicaoPropria, salvarComposicaoPropria } from "@/servidor/composicoes-proprias";
import { limparBanco, temBanco } from "./banco";
import { publicarAmostras } from "./fixtures-bases";

describe.skipIf(!temBanco)("consulta e composições", () => {
  let rev: { emop: string; sinapi: string };
  beforeAll(async () => {
    await limparBanco(prisma);
    rev = await publicarAmostras();
  });
  afterAll(() => prisma.$disconnect());

  it("busca por código com e sem pontuação", async () => {
    const a = await buscarItens({ texto: "01.001.0001", revisoes: [rev.emop], regime: "SEM_DESONERACAO" });
    expect(a.map((x) => x.codigo)).toEqual(["01.001.0001-0"]);
    const b = await buscarItens({ texto: "010010001", revisoes: [rev.emop], regime: "COM_DESONERACAO" });
    expect(b.map((x) => x.codigo)).toEqual(["01.001.0001-A"]);
  });

  it("busca por palavras sem acento e em qualquer ordem, nas duas fontes", async () => {
    const r = await buscarItens({ texto: "podotatil piso", revisoes: [rev.emop, rev.sinapi], regime: "SEM_DESONERACAO" });
    expect(r.some((x) => x.codigo === "104658" && x.preco !== null && Number(x.preco) === 181.78 && x.tem_composicao)).toBe(true);
  });

  it("composição analítica SINAPI recalcula exatamente o custo publicado", async () => {
    const item = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "104658" } });
    const a = await composicaoAnalitica(item.id, rev.sinapi, "SEM_DESONERACAO");
    expect(a!.totalCalculado).toBe("181.78");
    expect(a!.linhas.length).toBeGreaterThan(1);
  });

  it("composição analítica EMOP com perdas fecha com o publicado", async () => {
    const item = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "59.003.0060-B" } });
    const a = await composicaoAnalitica(item.id, rev.emop, "COM_DESONERACAO");
    const p = await prisma.precos_referencia.findFirstOrThrow({ where: { item_id: item.id } });
    expect(a!.totalCalculado).toBe(p.preco!.toString());
  });

  it("serviço sem composição publicada não exibe composição", async () => {
    const item = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "01.050.9999-0" } });
    expect(await composicaoAnalitica(item.id, rev.emop, "SEM_DESONERACAO")).toBeNull();
  });

  it("histórico de preços e onde é usado", async () => {
    const item = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "00149", fontes: { sigla: "EMOP" } } });
    const h = await historicoPrecos(item.id);
    expect(h.map((x) => x.regime_codigo).sort()).toEqual(["COM_DESONERACAO", "SEM_DESONERACAO"]);
    const usos = await ondeEUsado(item.id, rev.emop);
    expect(usos.map((u) => u.codigo)).toContain("59.003.0060-B");
  });

  it("composição própria com múltiplos componentes (oficial + cotação) e custo pela regra TRUNC", async () => {
    const insumo = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "00149", fontes: { sigla: "EMOP" } } });
    const r = await salvarComposicaoPropria({
      codigo: "P-001", descricao: "Serviço próprio de teste", unidade: "M2",
      componentes: [
        { itemId: insumo.id, revisaoBaseId: rev.emop, regime: "SEM_DESONERACAO", coeficiente: "0.333" },
        { custoInformado: "12.345", descricaoInformada: "Cotação fornecedor X", unidadeInformada: "UN", coeficiente: "2" },
      ],
    }, null);
    const preco = await prisma.precos_referencia.findFirstOrThrow({ where: { item_id: insumo.id, regime_codigo: "SEM_DESONERACAO" } });
    const c = await custoComposicaoPropria(r.composicaoId);
    // TRUNC(0,333 × preço; 2) + TRUNC(2 × 12,345; 2) = ... + 24,69
    const l1 = preco.preco!.times("0.333").toDecimalPlaces(2, 1);
    expect(c.custo!.toString()).toBe(l1.plus("24.69").toString());
    // salvar igual não cria versão
    const r2 = await salvarComposicaoPropria({
      itemId: r.itemId, codigo: "P-001", descricao: "Serviço próprio de teste", unidade: "M2",
      componentes: [
        { itemId: insumo.id, revisaoBaseId: rev.emop, regime: "SEM_DESONERACAO", coeficiente: "0.333" },
        { custoInformado: "12.345", descricaoInformada: "Cotação fornecedor X", unidadeInformada: "UN", coeficiente: "2" },
      ],
    }, null);
    expect(r2.novaVersao).toBe(false);
  });

  it("detecta referência circular entre composições próprias", async () => {
    const a = await salvarComposicaoPropria({ codigo: "A", descricao: "A", unidade: "UN", componentes: [{ custoInformado: "1", descricaoInformada: "x", unidadeInformada: "UN", coeficiente: "1" }] }, null);
    const b = await salvarComposicaoPropria({ codigo: "B", descricao: "B", unidade: "UN", componentes: [{ itemId: a.itemId, coeficiente: "2" }] }, null);
    await expect(salvarComposicaoPropria({ itemId: a.itemId, codigo: "A", descricao: "A", unidade: "UN", componentes: [{ itemId: b.itemId, coeficiente: "1" }] }, null))
      .rejects.toThrow(/Referência circular: A → B → A/);
    await expect(salvarComposicaoPropria({ itemId: a.itemId, codigo: "A", descricao: "A", unidade: "UN", componentes: [{ itemId: a.itemId, coeficiente: "1" }] }, null))
      .rejects.toThrow(/circular/);
    // custo recursivo: B = TRUNC(2 × 1,00; 2)
    const vb = await prisma.composicoes.findFirstOrThrow({ where: { item_id: b.itemId } });
    expect((await custoComposicaoPropria(vb.id)).custo!.toString()).toBe("2");
  });

  it("não aceita preço inexistente ou não publicado em componente", async () => {
    const semPreco = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "45098" } });
    await expect(salvarComposicaoPropria({ codigo: "X", descricao: "X", unidade: "UN", componentes: [{ itemId: semPreco.id, revisaoBaseId: rev.sinapi, regime: "SEM_DESONERACAO", coeficiente: "1" }] }, null))
      .rejects.toThrow(/não publicou preço/);
  });

  it("composição oficial não pode ser editada; cópia vira PRÓPRIA identificada", async () => {
    const oficial = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "104658" } });
    await expect(salvarComposicaoPropria({ itemId: oficial.id, codigo: "104658", descricao: "x", unidade: "M2", componentes: [{ custoInformado: "1", descricaoInformada: "x", unidadeInformada: "UN", coeficiente: "1" }] }, null))
      .rejects.toThrow(/oficiais não podem ser alteradas/);
    const c = await copiarComoPropria(oficial.id, rev.sinapi, "SEM_DESONERACAO", "P-104658", null);
    const item = await prisma.itens_referencia.findUniqueOrThrow({ where: { id: c.itemId }, include: { fontes: true } });
    expect(item.fontes.sigla).toBe("PROPRIA");
    const custo = await custoComposicaoPropria(c.composicaoId);
    expect(custo.custo!.toString()).toBe("181.78");
  });
});

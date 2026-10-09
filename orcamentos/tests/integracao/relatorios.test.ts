import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/servidor/db";
import { adicionarEtapa, adicionarItemProprio, adicionarItemReferencia, criarObra, criarOrcamento, definirCronogramaEtapa, definirParametros, fecharRevisao, novaRevisao, alterarItem } from "@/servidor/orcamentos";
import { montarRelatorio, TIPOS_RELATORIO, type TipoRelatorio } from "@/relatorios/montadores";
import { gerarPdf } from "@/relatorios/pdf";
import { gerarXlsx } from "@/relatorios/xlsx";
import { limparBanco, temBanco } from "./banco";
import { publicarAmostras } from "./fixtures-bases";

const v = async (id: string) => (await prisma.revisoes_orcamento.findUniqueOrThrow({ where: { id } })).versao;

describe.skipIf(!temBanco)("relatórios PDF e XLSX", () => {
  let revisao = "";
  let revisao2 = "";
  beforeAll(async () => {
    await limparBanco(prisma);
    const rev = await publicarAmostras();
    const obra = await criarObra({ nome: "Unidade de Saúde — Relatórios" }, null);
    const o = await criarOrcamento({ obraId: obra.id, nome: "Construção", bdi: { nome: "BDI 22%", percentual: "22" }, prazoMeses: 2,
      bases: [{ fonteSigla: "EMOP", revisaoBaseId: rev.emop, regime: "SEM_DESONERACAO" }, { fonteSigla: "SINAPI", revisaoBaseId: rev.sinapi, regime: "SEM_DESONERACAO" }] }, null);
    revisao = o.revisaoId;
    const e1 = await adicionarEtapa(revisao, await v(revisao), "Fundações", null, null);
    const e11 = await adicionarEtapa(revisao, await v(revisao), "Concreto", e1.id, null);
    const e2 = await adicionarEtapa(revisao, await v(revisao), "Acabamentos", null, null);
    const id = async (c: string) => (await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: c } })).id;
    await adicionarItemReferencia(revisao, await v(revisao), { etapaId: e11.id, itemReferenciaId: await id("59.003.0060-1"), quantidade: "12.5" }, null);
    await adicionarItemReferencia(revisao, await v(revisao), { etapaId: e11.id, itemReferenciaId: await id("03.005.0034-0"), quantidade: "3" }, null);
    await adicionarItemReferencia(revisao, await v(revisao), { etapaId: e2.id, itemReferenciaId: await id("104658"), quantidade: "40" }, null);
    await adicionarItemReferencia(revisao, await v(revisao), { etapaId: e2.id, itemReferenciaId: await id("00149"), quantidade: "100" }, null);
    await adicionarItemProprio(revisao, await v(revisao), { etapaId: e2.id, descricao: "Comunicação visual", unidade: "VB", custoUnitario: "2500", quantidade: "1" }, null);
    await definirCronogramaEtapa(revisao, await v(revisao), e1.id, ["60", "40"], null);
    await definirCronogramaEtapa(revisao, await v(revisao), e2.id, ["0", "100"], null);
    await fecharRevisao(revisao, await v(revisao), null);
    revisao2 = (await novaRevisao(revisao, "Ajuste", null)).id;
    const it = await prisma.itens_orcamento.findFirstOrThrow({ where: { revisao_id: revisao2, codigo: "104658" } });
    await alterarItem(revisao2, await v(revisao2), it.id, { quantidade: "50" }, null);
    await definirParametros(revisao2, await v(revisao2), { descricao: "Ajuste de quantidades" }, null);
  });
  afterAll(() => prisma.$disconnect());

  const tipos = Object.keys(TIPOS_RELATORIO) as TipoRelatorio[];
  it.each(tipos)("%s: gera PDF válido e XLSX legível com cabeçalho de identificação", async (tipo) => {
    const r = await montarRelatorio(tipo, tipo === "comparativo" ? revisao : revisao, tipo === "comparativo" ? revisao2 : null);
    const chaves = r.cabecalho.map(([k]) => k);
    for (const k of ["Obra", "Versão", "Fontes de referência", "Competência", "Regime de encargos", "Emitido em"]) expect(chaves).toContain(k);
    const pdf = await gerarPdf(r);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-8).toString()).toContain("%%EOF");
    const xlsx = await gerarXlsx(r);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as never);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell("A1").value).toBe(TIPOS_RELATORIO[tipo]);
  });

  it("sintético: total, numeração hierárquica e formato monetário no XLSX", async () => {
    const r = await montarRelatorio("sintetico", revisao);
    const linhas = r.tabelas[0]!.linhas;
    expect(linhas.map((l) => l.celulas[0]).filter(Boolean)).toEqual(["1", "1.1", "1.1.1", "1.1.2", "2", "2.1", "2.2", "2.3"]);
    const rev = await prisma.revisoes_orcamento.findUniqueOrThrow({ where: { id: revisao } });
    const total = linhas.at(-1)!.celulas[8]!;
    expect(total.toString()).toBe(rev.total_geral!.toString());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await gerarXlsx(r)) as never);
    let achou = false;
    wb.worksheets[0]!.eachRow((row) => {
      if (row.getCell(4).value === "TOTAL GERAL") {
        expect(row.getCell(9).value).toBe(Number(rev.total_geral!.toString()));
        expect(row.getCell(9).numFmt).toContain("R$");
        achou = true;
      }
    });
    expect(achou).toBe(true);
  });

  it("curva ABC de insumos usa a explosão congelada e ordena por valor", async () => {
    const r = await montarRelatorio("abc-insumos", revisao);
    const l = r.tabelas[0]!.linhas.filter((x) => x.estilo !== "total");
    expect(l.length).toBeGreaterThan(5);
    const valores = l.map((x) => Number(x.celulas[7]!.toString()));
    expect([...valores].sort((a, b) => b - a)).toEqual(valores);
    expect(l[0]!.celulas[10]).toBe("A");
  });

  it("comparativo identifica item alterado", async () => {
    const r = await montarRelatorio("comparativo", revisao, revisao2);
    const alt = r.tabelas[0]!.linhas.find((x) => x.celulas[0] === "Alterado")!;
    expect(alt.celulas[2]).toBe("SINAPI 104658");
  });

  it("memória de cálculo mostra a conta do truncamento", async () => {
    const r = await montarRelatorio("memoria", revisao);
    const linha = r.tabelas[0]!.linhas.find((x) => String(x.celulas[1]).includes("104658"))!;
    expect(String(linha.celulas[3])).toMatch(/181,78 × 1,220000 = 221,7716 → 221,77 \(truncado\)/);
  });
});

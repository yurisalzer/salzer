import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { prisma } from "@/servidor/db";
import {
  ErroConcorrencia, adicionarBdiDiferenciado, adicionarEtapa, adicionarItemProprio, adicionarItemReferencia, alterarItem, atualizarCompetencia,
  criarObra, criarOrcamento, definirBdiPadrao, definirCronogramaEtapa, definirParametros, duplicarOrcamento, excluirItem, fecharRevisao, novaRevisao, pendenciasFechamento,
} from "@/servidor/orcamentos";
import { criarDiretorioTemporario } from "@/importacao/pacotes";
import { analisarImportacao, confirmarImportacao, publicarRevisaoBase } from "@/importacao/servico";
import { D } from "@/dominio/decimal";
import { limparBanco, temBanco } from "./banco";
import { publicarAmostras } from "./fixtures-bases";

const versao = async (id: string) => (await prisma.revisoes_orcamento.findUniqueOrThrow({ where: { id } })).versao;
const itemRef = (codigo: string) => prisma.itens_referencia.findFirstOrThrow({ where: { codigo } });

describe.skipIf(!temBanco)("orçamentos", () => {
  let rev: { emop: string; sinapi: string };
  let revisaoId = "";
  let etapa1 = "";
  let sub11 = "";
  beforeAll(async () => {
    await limparBanco(prisma);
    rev = await publicarAmostras();
  });
  afterAll(() => prisma.$disconnect());

  it("cria obra e orçamento com bases e BDI de perfil oficial (EMOP edifícios > R$ 1,5 mi, 18%)", async () => {
    const obra = await criarObra({ nome: "Escola Municipal Teste", municipio: "Niterói" }, null);
    const perfil = await prisma.perfis_bdi.findFirstOrThrow({ where: { nome: { contains: "edifícios" }, regime_codigo: "SEM_DESONERACAO", faixa: { startsWith: "acima" } } });
    const r = await criarOrcamento({
      obraId: obra.id, nome: "Reforma", bdi: { perfilId: perfil.id },
      bases: [{ fonteSigla: "EMOP", revisaoBaseId: rev.emop, regime: "SEM_DESONERACAO" }, { fonteSigla: "SINAPI", revisaoBaseId: rev.sinapi, regime: "SEM_DESONERACAO" }],
    }, null);
    revisaoId = r.revisaoId;
    const b = await prisma.bdi_aplicados.findFirstOrThrow({ where: { revisao_id: revisaoId } });
    expect(b.percentual_adotado.toString()).toBe("18");
    expect(b.percentual_calculado!.toFixed(2)).toBe("17.68");
  });

  it("etapas e subetapas", async () => {
    etapa1 = (await adicionarEtapa(revisaoId, await versao(revisaoId), "Serviços preliminares", null, null)).id;
    sub11 = (await adicionarEtapa(revisaoId, await versao(revisaoId), "Ensaios", etapa1, null)).id;
    await adicionarEtapa(revisaoId, await versao(revisaoId), "Pisos", null, null);
    expect(await prisma.etapas.count({ where: { revisao_id: revisaoId } })).toBe(3);
  });

  it("item EMOP: preço unitário e total truncados (208,83 × 1,18 = 246,4194 → 246,41; × 3,5 = 862,435 → 862,43)", async () => {
    const i = await adicionarItemReferencia(revisaoId, await versao(revisaoId), { etapaId: sub11, itemReferenciaId: (await itemRef("01.001.0001-0")).id, quantidade: "3.5" }, null);
    expect(i.custo_unitario!.toString()).toBe("208.83");
    expect(i.preco_unitario!.toString()).toBe("246.41");
    expect(i.total!.toString()).toBe("862.43");
    expect(i.fonte_sigla).toBe("EMOP");
    expect(i.competencia!.toISOString().slice(0, 7)).toBe("2026-01");
  });

  it("não aceita código de outro regime (código -A num orçamento sem desoneração)", async () => {
    await expect(adicionarItemReferencia(revisaoId, await versao(revisaoId), { etapaId: sub11, itemReferenciaId: (await itemRef("01.001.0001-A")).id, quantidade: "1" }, null))
      .rejects.toThrow(/não consta da base\/regime/);
  });

  it("item com regime escolhido individualmente (com desoneração)", async () => {
    const i = await adicionarItemReferencia(revisaoId, await versao(revisaoId), { etapaId: sub11, itemReferenciaId: (await itemRef("01.001.0001-A")).id, revisaoBaseId: rev.emop, regime: "COM_DESONERACAO", quantidade: "1" }, null);
    expect(i.custo_unitario!.toString()).toBe("199.93");
    await excluirItem(revisaoId, await versao(revisaoId), i.id, null);
  });

  let itemSinapi = "";
  it("item SINAPI e BDI individual por item", async () => {
    const i = await adicionarItemReferencia(revisaoId, await versao(revisaoId), { etapaId: etapa1, itemReferenciaId: (await itemRef("104658")).id, quantidade: "10" }, null);
    itemSinapi = i.id;

    expect(i.preco_unitario!.toString()).toBe("214.5"); // 181,78 × 1,18 = 214,5004 → 214,50
    const bdi = await adicionarBdiDiferenciado(revisaoId, await versao(revisaoId), { nome: "Fornecimento", percentual: "10" }, null);
    const a = await alterarItem(revisaoId, await versao(revisaoId), i.id, { bdiAplicadoId: bdi.id }, null);
    // 181,78 × 1,10 = 199,958 → 199,95 ; × 10 = 1999,50
    expect(a.bdi_percentual.toString()).toBe("10");
    expect(a.preco_unitario!.toString()).toBe("199.95");
    expect(a.total!.toString()).toBe("1999.5");
  });

  it("trocar BDI global recalcula só itens sem BDI individual", async () => {
    await definirBdiPadrao(revisaoId, await versao(revisaoId), { nome: "BDI 25%", percentual: "25" }, null);
    const itens = await prisma.itens_orcamento.findMany({ where: { revisao_id: revisaoId }, orderBy: { codigo: "asc" } });
    const emop = itens.find((i) => i.codigo === "01.001.0001-0")!;
    expect(emop.preco_unitario!.toString()).toBe("261.03"); // 208,83 × 1,25 = 261,0375
    expect(itens.find((i) => i.id === itemSinapi)!.bdi_percentual.toString()).toBe("10");
  });

  it("modo ARREDONDAR recalcula todos os itens", async () => {
    await definirParametros(revisaoId, await versao(revisaoId), { modo: "ARREDONDAR" }, null);
    const emop = await prisma.itens_orcamento.findFirstOrThrow({ where: { revisao_id: revisaoId, codigo: "01.001.0001-0" } });
    expect(emop.preco_unitario!.toString()).toBe("261.04");
    expect(emop.total!.toString()).toBe("913.64");
    await definirParametros(revisaoId, await versao(revisaoId), { modo: "TRUNCAR" }, null);
  });

  it("controle de concorrência: alteração com versão antiga é recusada", async () => {
    const v = await versao(revisaoId);
    await alterarItem(revisaoId, v, itemSinapi, { quantidade: "12" }, null);
    await expect(alterarItem(revisaoId, v, itemSinapi, { quantidade: "13" }, null)).rejects.toBeInstanceOf(ErroConcorrencia);
    const i = await prisma.itens_orcamento.findUniqueOrThrow({ where: { id: itemSinapi } });
    expect(i.quantidade.toString()).toBe("12");
  });

  it("serviço próprio avulso e composição própria", async () => {
    const a = await adicionarItemProprio(revisaoId, await versao(revisaoId), { etapaId: etapa1, codigo: "P-01", descricao: "Placa de obra (cotação)", unidade: "UN", custoUnitario: "1500.00", quantidade: "1" }, null);
    expect(a.fonte_sigla).toBe("PROPRIA");
    expect(a.total!.toString()).toBe("1875"); // BDI 25%
    await expect(alterarItem(revisaoId, await versao(revisaoId), itemSinapi, { custoUnitario: "1" }, null)).rejects.toThrow(/não pode ser editado/);
  });

  it("cronograma: soma acima de 100% é recusada", async () => {
    await definirParametros(revisaoId, await versao(revisaoId), { prazoMeses: 3 }, null);
    await expect(definirCronogramaEtapa(revisaoId, await versao(revisaoId), etapa1, ["50", "60"], null)).rejects.toThrow(/passa de 100%/);
    await definirCronogramaEtapa(revisaoId, await versao(revisaoId), etapa1, ["50", "30", "20"], null);
    const p = await pendenciasFechamento(revisaoId);
    expect(p.some((x) => /Pisos.*soma 0%/.test(x.mensagem))).toBe(true);
  });

  let hash = "";
  it("fechamento: congela totais, explosão analítica e hash; nada mais pode ser alterado", async () => {
    const pisos = await prisma.etapas.findFirstOrThrow({ where: { revisao_id: revisaoId, titulo: "Pisos" } });
    await definirCronogramaEtapa(revisaoId, await versao(revisaoId), pisos.id, ["0", "0", "100"], null);
    const r = await fecharRevisao(revisaoId, await versao(revisaoId), null);
    hash = r.hash;
    const fechada = await prisma.revisoes_orcamento.findUniqueOrThrow({ where: { id: revisaoId } });
    expect(fechada.status).toBe("FECHADA");
    // 862,43→ (BDI 25%) 913,60 + SINAPI 12 × 199,95 = 2399,40 + próprio 1875,00
    expect(fechada.total_geral!.toString()).toBe("5188");
    expect(fechada.hash_fechamento).toMatch(/^[0-9a-f]{64}$/);
    const ins = await prisma.fechamento_insumos.findMany({ where: { item_orcamento_id: itemSinapi } });
    expect(ins.length).toBeGreaterThan(1);
    const soma = ins.reduce((s, x) => s.plus(D(x.coeficiente).times(D(x.custo_unitario ?? 0))), D(0));
    expect(soma.minus("181.78").abs().lt("0.10")).toBe(true); // diferença só de truncamentos da fonte
    await expect(alterarItem(revisaoId, null, itemSinapi, { quantidade: "1" }, null)).rejects.toThrow(/FECHADA/);
    await expect(prisma.itens_orcamento.update({ where: { id: itemSinapi }, data: { quantidade: "1" } })).rejects.toThrow(/fechada/);
  });

  let rev2 = "";
  it("nova revisão a partir da fechada é editável e preserva a original", async () => {
    const n = await novaRevisao(revisaoId, "Ajustes", null);
    rev2 = n.id;
    expect(n.numero).toBe(2);
    const itens = await prisma.itens_orcamento.findMany({ where: { revisao_id: rev2 } });
    expect(itens).toHaveLength(3);
    const s = itens.find((i) => i.codigo === "104658")!;
    await alterarItem(rev2, await versao(rev2), s.id, { quantidade: "20" }, null);
    const original = await prisma.itens_orcamento.findUniqueOrThrow({ where: { id: itemSinapi } });
    expect(original.quantidade.toString()).toBe("12");
    expect((await prisma.revisoes_orcamento.findUniqueOrThrow({ where: { id: revisaoId } })).hash_fechamento).toBe(hash);
    // BDI individual continua apontando para a cópia do BDI na nova revisão
    expect(s.bdi_aplicado_id).not.toBeNull();
    expect((await prisma.bdi_aplicados.findUniqueOrThrow({ where: { id: s.bdi_aplicado_id! } })).revisao_id).toBe(rev2);
  });

  it("atualização de competência/retificação na nova revisão, sem alterar a anterior", async () => {
    // Retificação da base SINAPI: custo de 104658 alterado e composição 87398 sem custo
    const fix = path.resolve(__dirname, "..", "fixtures", "sinapi-202601");
    const z = await JSZip.loadAsync(await readFile(path.join(fix, "SINAPI_Referência_2026_01.xlsx")));
    for (const arq of Object.keys(z.files).filter((f) => /worksheets\/sheet6\.xml$/.test(f))) {
      const xml = await z.file(arq)!.async("string");
      z.file(arq, xml.replace(/(<c r="AO\d+"[^>]*>)<v>181\.78<\/v>/, "$1<v>190.00</v>"));
    }
    const dir = await criarDiretorioTemporario();
    const caminho = path.join(dir, "e0");
    await writeFile(caminho, await z.generateAsync({ type: "nodebuffer" }));
    const a = await analisarImportacao({ fonte: "SINAPI", uf: "RJ", competencia: new Date(Date.UTC(2026, 0, 1)), regimes: ["SEM_DESONERACAO"], rotuloRevisao: "Retificação 02", usuarioId: null, dir, enviados: [{ nomeOriginal: "SINAPI_Referência_2026_01.xlsx", caminho }] });
    expect(a.status).toBe("ANALISADO");
    const { revisaoBaseId } = await confirmarImportacao(a.loteId, null);
    await publicarRevisaoBase(revisaoBaseId, null);
    const r = await atualizarCompetencia(rev2, await versao(rev2), [{ fonteSigla: "SINAPI", revisaoBaseId, regime: "SEM_DESONERACAO" }], null);
    expect(r.atualizados).toBe(1);
    const s = await prisma.itens_orcamento.findFirstOrThrow({ where: { revisao_id: rev2, codigo: "104658" } });
    expect(s.custo_unitario!.toString()).toBe("190");
    expect(s.rotulo_revisao_base).toBe("Retificação 02");
    expect(s.preco_unitario!.toString()).toBe("209"); // 190 × 1,10
    const antigo = await prisma.itens_orcamento.findUniqueOrThrow({ where: { id: itemSinapi } });
    expect(antigo.custo_unitario!.toString()).toBe("181.78");
    // base antiga ficou SUBSTITUIDA, mas a revisão fechada continua íntegra
    expect((await prisma.revisoes_base.findUniqueOrThrow({ where: { id: rev.sinapi } })).status).toBe("SUBSTITUIDA");
  });

  it("duplicar orçamento", async () => {
    const d = await duplicarOrcamento(revisaoId, "Reforma — alternativa B", null);
    expect(await prisma.itens_orcamento.count({ where: { revisao_id: d.revisaoId } })).toBe(3);
    const r = await prisma.revisoes_orcamento.findUniqueOrThrow({ where: { id: d.revisaoId } });
    expect(r.status).toBe("ABERTA");
    expect(r.numero).toBe(1);
  });
});

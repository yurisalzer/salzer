import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { prisma } from "@/servidor/db";
import { criarDiretorioTemporario } from "@/importacao/pacotes";
import { analisarImportacao, cancelarImportacao, confirmarImportacao, publicarRevisaoBase, rejeitarRevisaoBase } from "@/importacao/servico";
import type { CodigoRegime } from "@/dominio/referencias";
import { limparBanco, temBanco } from "./banco";

const FIX = path.resolve(__dirname, "..", "fixtures");
const EMOP_DIR = path.join(FIX, "emop-012026");
const EMOP = ["EMOP0126.dbf", "DIPR0126.dbf", "COMP0126.dbf", "MAT0126.dbf", "REUT0126.dbf", "ELEM0126.dbf"];
const SINAPI_DIR = path.join(FIX, "sinapi-202601");
const SINAPI = ["SINAPI_Referência_2026_01.xlsx", "SINAPI_mao_de_obra_2026_01.xlsx", "SINAPI_Manutenções_2026_01.xlsx"];
const JAN = new Date(Date.UTC(2026, 0, 1));
const TODOS_SINAPI: CodigoRegime[] = ["SEM_DESONERACAO", "COM_DESONERACAO", "SEM_ENCARGOS"];

async function enviar(arquivos: Array<{ origem?: string; nome: string; conteudo?: Buffer }>) {
  const dir = await criarDiretorioTemporario();
  const enviados = [];
  for (const [i, a] of arquivos.entries()) {
    const caminho = path.join(dir, `envio-${i}`);
    if (a.conteudo) await writeFile(caminho, a.conteudo);
    else await copyFile(a.origem!, caminho);
    enviados.push({ nomeOriginal: a.nome, caminho });
  }
  return { dir, enviados };
}

async function zipar(arquivos: Array<{ nome: string; conteudo: Buffer }>): Promise<Buffer> {
  const z = new JSZip();
  for (const a of arquivos) z.file(a.nome, a.conteudo);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function analisarEmop(extra: Partial<Parameters<typeof analisarImportacao>[0]> = {}, arquivos = EMOP.map((n) => ({ origem: path.join(EMOP_DIR, n), nome: n }))) {
  const { dir, enviados } = await enviar(arquivos);
  return analisarImportacao({ fonte: "EMOP", uf: "RJ", competencia: JAN, regimes: ["SEM_DESONERACAO", "COM_DESONERACAO"], usuarioId: null, dir, enviados, ...extra });
}

/** Planilha SINAPI de referência com alterações pontuais no XML (para simular retificação/zeros). */
async function sinapiAlterado(trocas: Array<{ aba: string; de: string | RegExp; para: string }>): Promise<Buffer> {
  const z = await JSZip.loadAsync(await readFile(path.join(SINAPI_DIR, SINAPI[0]!)));
  const wb = await z.file("xl/workbook.xml")!.async("string");
  const rels = await z.file("xl/_rels/workbook.xml.rels")!.async("string");
  for (const t of trocas) {
    const rid = new RegExp(`name="${t.aba}"[^>]*r:id="([^"]+)"`).exec(wb)![1];
    const alvo = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)![1];
    const arq = `xl/${alvo}`;
    const xml = await z.file(arq)!.async("string");
    if (typeof t.de === "string" ? !xml.includes(t.de) : !t.de.test(xml)) throw new Error(`Trecho não encontrado em ${t.aba}: ${t.de}`);
    z.file(arq, xml.replace(t.de, t.para));
  }
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function preco(fonte: string, tipo: string, codigo: string, regime: string, revisaoId?: string) {
  return prisma.precos_referencia.findFirst({
    where: { regime_codigo: regime, itens_referencia: { codigo, tipo, fontes: { sigla: fonte } }, ...(revisaoId ? { revisao_base_id: revisaoId } : {}) },
    orderBy: { revisoes_base: { numero: "desc" } },
  });
}

describe.skipIf(!temBanco)("importação EMOP (amostra real de jan/2026)", () => {
  beforeAll(() => limparBanco(prisma));
  afterAll(() => prisma.$disconnect());

  it("arquivo inválido: nenhum arquivo reconhecido", async () => {
    const r = await analisarEmop({}, [{ nome: "qualquer.dbf", conteudo: Buffer.from("isto não é um DBF".repeat(10)) }]);
    expect(r.status).toBe("FALHOU");
    const lote = await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r.loteId } });
    expect(lote.erro).toMatch(/Nenhum arquivo reconhecido/);
  });

  it("DBF truncado é rejeitado pela assinatura (não é aceito como DBF)", async () => {
    const original = await readFile(path.join(EMOP_DIR, "COMP0126.dbf"));
    const r = await analisarEmop({}, [
      ...EMOP.filter((n) => n !== "COMP0126.dbf").map((n) => ({ origem: path.join(EMOP_DIR, n), nome: n })),
      { nome: "COMP0126.dbf", conteudo: original.subarray(0, original.length - 200) },
    ]);
    expect(r.status).toBe("FALHOU");
    expect((await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r.loteId } })).erro).toMatch(/ausentes:.*COMP/);
  });

  it("arquivo obrigatório ausente", async () => {
    const r = await analisarEmop({}, [{ origem: path.join(EMOP_DIR, "EMOP0126.dbf"), nome: "EMOP0126.dbf" }]);
    expect(r.status).toBe("FALHOU");
    expect((await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r.loteId } })).erro).toMatch(/ausentes/);
  });

  it("competência divergente da selecionada", async () => {
    const r = await analisarEmop({ competencia: new Date(Date.UTC(2026, 1, 1)) });
    expect(r.status).toBe("FALHOU");
    expect((await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r.loteId } })).erro).toMatch(/competência 2026-01/);
  });

  let revisaoEmop = "";
  it("importação válida em pacote ZIP (com cópia .xls idêntica e PDF): analisa, grava e publica", async () => {
    const conteudos = await Promise.all(EMOP.map(async (n) => ({ nome: `012026/${n}`, conteudo: await readFile(path.join(EMOP_DIR, n)) })));
    conteudos.push({ nome: "012026/EMOP0126 - Copia.xls", conteudo: conteudos[0]!.conteudo });
    conteudos.push({ nome: "012026/Capa Boletim.pdf", conteudo: Buffer.from("%PDF-1.4 teste") });
    const r = await analisarEmop({}, [{ nome: "EMOP_012026.zip", conteudo: await zipar(conteudos) }]);
    const lote = await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r.loteId } });
    expect(lote.erro).toBeNull();
    expect(r.status).toBe("ANALISADO");
    expect(r.erros).toBe(0);
    const verif = await prisma.verificacoes_importacao.findMany({ where: { lote_id: r.loteId } });
    expect(verif.some((v) => v.regra === "ARQUIVO_IGNORADO" && /Cópia idêntica/.test(v.mensagem))).toBe(true);
    // Reconciliação: 03.005.0034-0 é o caso real de diferença de R$ 0,01 da própria EMOP
    const rec = verif.find((v) => v.regra === "RECONCILIACAO_COMPOSICOES")!;
    expect(rec.detalhes).toMatchObject({ umCentavo: 1, divergentes: 0 });
    // SHA-256 registrado para o pacote e para cada arquivo extraído
    const arqs = await prisma.arquivos_importacao.findMany({ where: { lote_id: r.loteId } });
    expect(arqs.find((a) => a.nome === "EMOP_012026.zip")?.assinatura).toBe("ZIP");
    expect(arqs.filter((a) => a.assinatura === "DBF").every((a) => /^[0-9a-f]{64}$/.test(a.sha256) && a.pacote_sha256)).toBe(true);
    expect(lote.importador_versao).toBe("1.0.0");

    const { revisaoBaseId } = await confirmarImportacao(r.loteId, null);
    revisaoEmop = revisaoBaseId;
    const rev = await prisma.revisoes_base.findUniqueOrThrow({ where: { id: revisaoBaseId } });
    expect(rev.status).toBe("VALIDADA");
    // Ainda não publicada: indisponível para orçamentos
    await publicarRevisaoBase(revisaoBaseId, null);
    expect((await prisma.revisoes_base.findUniqueOrThrow({ where: { id: revisaoBaseId } })).status).toBe("PUBLICADA");
    // Staging limpo
    expect(await prisma.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM stg_precos WHERE lote_id = $1::uuid`, r.loteId)).toHaveLength(0);
  });

  it("preserva códigos com zeros à esquerda e o regime pelo dígito final", async () => {
    const i = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "02083", fontes: { sigla: "EMOP" } } });
    expect(i.tipo).toBe("INSUMO");
    expect((await preco("EMOP", "COMPOSICAO", "01.001.0001-0", "SEM_DESONERACAO"))!.preco!.toString()).toBe("208.83");
    expect((await preco("EMOP", "COMPOSICAO", "01.001.0001-A", "COM_DESONERACAO"))!.preco!.toString()).toBe("199.93");
    expect(await preco("EMOP", "COMPOSICAO", "01.001.0001-A", "SEM_DESONERACAO")).toBeNull();
    const reg = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "01.001.0001-A" } });
    expect(reg.regime_codigo).toBe("COM_DESONERACAO");
  });

  it("insumo (MAT) vale nos dois regimes; elementar reutilizado só no regime da composição vinculada", async () => {
    const mat = await prisma.precos_referencia.findMany({ where: { itens_referencia: { codigo: "00149", fontes: { sigla: "EMOP" } } } });
    expect(mat.map((p) => p.regime_codigo).sort()).toEqual(["COM_DESONERACAO", "SEM_DESONERACAO"]);
    const reut = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "02083", fontes: { sigla: "EMOP" } } });
    expect(reut.classe).toBe("COMPOSICAO_REUTILIZADA");
    expect(reut.codigo_composicao_vinculada).toMatch(/^\d{2}\.\d{3}\.\d{4}-[0-4]$/);
    const pr = await prisma.precos_referencia.findMany({ where: { item_id: reut.id } });
    expect(pr.map((p) => p.regime_codigo)).toEqual(["SEM_DESONERACAO"]);
  });

  it("descrições: campos cortados no meio da palavra e acentos em CP850", async () => {
    const d = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "13.196.0170-A" } });
    expect(d.descricao).toContain("(ESTRUTURA+CHAPA GESSO) ESTRUTURADA C/MONTANTES");
    expect(d.descricao).toContain("GUIAS HORIZ.90MM");
    expect(d.descricao).not.toMatch(/\s{2,}/);
    expect((await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "01.001.0160-0" } })).descricao).toContain("25°C");
  });

  it("composição com múltiplos componentes, percentual de perdas e coeficientes exatos", async () => {
    const pub = await prisma.composicoes_publicadas.findFirstOrThrow({
      where: { revisao_base_id: revisaoEmop, itens_referencia: { codigo: "59.003.0060-B" } },
      include: { composicoes: { include: { composicao_itens: { orderBy: { ordem: "asc" } } } } },
    });
    const itens = pub.composicoes.composicao_itens;
    expect(itens.length).toBeGreaterThan(1);
    expect(itens.map((i) => i.sequencia)).toEqual(itens.map((_i, k) => String(k + 1).padStart(3, "0")));
    expect(itens.every((i) => i.percentual_perda?.toString() === "5")).toBe(true);
    expect(itens.find((i) => i.codigo_original === "00149")!.coeficiente.toString()).toBe("244.5");
  });

  it("índices sem composição analítica não ganham composição inventada", async () => {
    const i = await prisma.itens_referencia.findFirstOrThrow({ where: { codigo: "01.050.9999-0" } });
    expect(await prisma.composicoes_publicadas.count({ where: { item_id: i.id } })).toBe(0);
  });

  it("reimportação do mesmo arquivo é bloqueada; com permissão e justificativa é permitida", async () => {
    const r1 = await analisarEmop();
    expect(r1.status).toBe("FALHOU");
    expect((await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r1.loteId } })).erro).toMatch(/já importado/);
    const r2 = await analisarEmop({ podeAutorizarDuplicidade: false, justificativaDuplicidade: "teste" });
    expect(r2.status).toBe("FALHOU");
    const r3 = await analisarEmop({ podeAutorizarDuplicidade: true, justificativaDuplicidade: "Conferência solicitada pela fiscalização" });
    expect(r3.status).toBe("ANALISADO");
    expect(await prisma.auditoria.count({ where: { acao: "DUPLICIDADE_AUTORIZADA", entidade_id: r3.loteId } })).toBe(1);
    await cancelarImportacao(r3.loteId, null);
  });
});

describe.skipIf(!temBanco)("importação SINAPI (amostra real de jan/2026, Retificação 01)", () => {
  beforeAll(() => limparBanco(prisma));
  afterAll(() => prisma.$disconnect());

  async function analisarSinapi(nomeZip = "SINAPI-2026-01-formato-xlsx_Retificacao01.zip", principal?: Buffer, regimes = TODOS_SINAPI, rotulo?: string) {
    const conteudos = await Promise.all(SINAPI.map(async (n) => ({ nome: `SINAPI-2026-01-formato-xlsx/${n}`, conteudo: await readFile(path.join(SINAPI_DIR, n)) })));
    if (principal) conteudos[0]!.conteudo = principal;
    const { dir, enviados } = await enviar([{ nome: nomeZip, conteudo: await zipar(conteudos) }]);
    return analisarImportacao({ fonte: "SINAPI", uf: "RJ", competencia: JAN, regimes, rotuloRevisao: rotulo, usuarioId: null, dir, enviados });
  }

  let rev1 = "";
  it("falha no meio da gravação desfaz tudo; nova tentativa funciona", async () => {
    const r = await analisarSinapi();
    expect(r.status).toBe("ANALISADO");
    expect(r.erros).toBe(0);
    await expect(confirmarImportacao(r.loteId, null, { falharApos: "composicoes" })).rejects.toThrow(/Falha simulada/);
    expect(await prisma.revisoes_base.count()).toBe(0);
    expect(await prisma.precos_referencia.count()).toBe(0);
    expect(await prisma.itens_referencia.count()).toBe(0);
    expect(await prisma.composicoes.count()).toBe(0);
    const lote = await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r.loteId } });
    expect(lote.status).toBe("ANALISADO");
    expect(lote.erro).toMatch(/nada foi gravado/);
    const { revisaoBaseId } = await confirmarImportacao(r.loteId, null);
    rev1 = revisaoBaseId;
    await publicarRevisaoBase(rev1, null);
  });

  it("rótulo de retificação sugerido pelo nome do pacote e data de emissão da planilha principal", async () => {
    const rev = await prisma.revisoes_base.findUniqueOrThrow({ where: { id: rev1 } });
    expect(rev.rotulo).toBe("Retificação 01");
    expect(rev.data_emissao?.toISOString().slice(0, 10)).toBe("2026-03-23");
    expect(rev.regimes).toEqual(TODOS_SINAPI);
  });

  it("código de composição extraído da fórmula HYPERLINK e custos por regime", async () => {
    const sd = await preco("SINAPI", "COMPOSICAO", "104658", "SEM_DESONERACAO");
    const cd = await preco("SINAPI", "COMPOSICAO", "104658", "COM_DESONERACAO");
    const se = await preco("SINAPI", "COMPOSICAO", "104658", "SEM_ENCARGOS");
    expect(sd!.preco!.toString()).toBe("181.78");
    expect(new Set([sd!.preco!.toString(), cd!.preco!.toString(), se!.preco!.toString()]).size).toBe(3);
    expect(sd!.percentual_mao_obra?.toString()).toBe("0.3707");
  });

  it("custo zerado (\"-\") vira SEM_CUSTO e insumo sem coleta vira AUSENTE — nunca zero", async () => {
    const semCusto = await preco("SINAPI", "COMPOSICAO", "104943", "SEM_DESONERACAO");
    expect(semCusto!.situacao).toBe("SEM_CUSTO");
    expect(semCusto!.preco).toBeNull();
    const ausentes = await prisma.precos_referencia.count({ where: { situacao: "AUSENTE", itens_referencia: { tipo: "INSUMO" } } });
    expect(ausentes).toBeGreaterThan(0);
    // Insumo "SEM PREÇO" presente só no Analítico: cadastrado, sem preço
    const sp = await preco("SINAPI", "INSUMO", "45098", "SEM_DESONERACAO");
    expect(sp!.situacao).toBe("SEM_PRECO");
  });

  it("composição com subcomposições e coeficientes do Analítico", async () => {
    const pub = await prisma.composicoes_publicadas.findFirstOrThrow({
      where: { revisao_base_id: rev1, itens_referencia: { codigo: "104658" } },
      include: { composicoes: { include: { composicao_itens: true } } },
    });
    expect(pub.situacao).toBe("COM CUSTO");
    const servente = pub.composicoes.composicao_itens.find((i) => i.codigo_original === "88316")!;
    expect(servente.tipo_item).toBe("COMPOSICAO");
    expect(servente.coeficiente.toString()).toBe("1.279");
  });

  it("verificação de consistência do custo das composições (regra oficial TRUNC)", async () => {
    const lote = await prisma.lotes_importacao.findFirstOrThrow({ where: { revisao_base_id: rev1 } });
    const rec = await prisma.verificacoes_importacao.findFirstOrThrow({ where: { lote_id: lote.id, regra: "RECONCILIACAO_COMPOSICOES" } });
    expect(rec.detalhes).toMatchObject({ divergentes: 0, umCentavo: 0 });
    expect((rec.detalhes as { exatas: number }).exatas).toBeGreaterThan(0);
  });

  it("preço zerado é aceito como INFORMADO com aviso", async () => {
    // Insumo 36178 custa R$ 15,88 (RJ, sem desoneração) no arquivo oficial; aqui é alterado para zero.
    // (coluna X = RJ na aba ISD)
    const alterado = await sinapiAlterado([{ aba: "ISD", de: /(<c r="X\d+"[^>]*>)<v>15\.88<\/v>/, para: "$1<v>0</v>" }]);
    const r = await analisarSinapi("SINAPI-2026-01-teste-zero.zip", alterado, TODOS_SINAPI, "Teste");
    expect(r.status).toBe("ANALISADO");
    const v = await prisma.verificacoes_importacao.findMany({ where: { lote_id: r.loteId, regra: "PRECO_ZERADO" } });
    expect(v.map((x) => x.codigo)).toContain("36178");
    await cancelarImportacao(r.loteId, null);
  });

  it("retificação: nova revisão substitui a anterior sem apagá-la; composições iguais são reaproveitadas", async () => {
    const alterado = await sinapiAlterado([{ aba: "CSD", de: /(<c r="AO\d+"[^>]*>)<v>181\.78<\/v>/, para: "$1<v>181.79</v>" }]);
    const r = await analisarSinapi("SINAPI-2026-01-formato-xlsx_Retificacao02.zip", alterado);
    expect(r.status).toBe("ANALISADO");
    // Arquivos auxiliares idênticos não bloqueiam (apenas informados)
    expect(await prisma.verificacoes_importacao.count({ where: { lote_id: r.loteId, regra: "ARQUIVO_JA_IMPORTADO" } })).toBe(2);
    const { revisaoBaseId: rev2 } = await confirmarImportacao(r.loteId, null);
    const lote = await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: r.loteId } });
    expect((lote.contagens as Record<string, number>).composicoes_novas_versoes).toBe(0);
    await publicarRevisaoBase(rev2, null);
    const revs = await prisma.revisoes_base.findMany({ orderBy: { numero: "asc" } });
    expect(revs.map((x) => [x.numero, x.rotulo, x.status])).toEqual([
      [1, "Retificação 01", "SUBSTITUIDA"],
      [2, "Retificação 02", "PUBLICADA"],
    ]);
    expect((await preco("SINAPI", "COMPOSICAO", "104658", "SEM_DESONERACAO", rev1))!.preco!.toString()).toBe("181.78");
    expect((await preco("SINAPI", "COMPOSICAO", "104658", "SEM_DESONERACAO", rev2))!.preco!.toString()).toBe("181.79");
  });

  it("importação de apenas um regime e rejeição libera os dados", async () => {
    const alterado = await sinapiAlterado([{ aba: "CSD", de: /(<c r="AO\d+"[^>]*>)<v>181\.78<\/v>/, para: "$1<v>181.80</v>" }]);
    const r = await analisarSinapi("SINAPI-2026-01-regime.zip", alterado, ["SEM_DESONERACAO"], "Teste de regime");
    expect(r.status).toBe("ANALISADO");
    const { revisaoBaseId } = await confirmarImportacao(r.loteId, null);
    const regimes = await prisma.precos_referencia.groupBy({ by: ["regime_codigo"], where: { revisao_base_id: revisaoBaseId } });
    expect(regimes.map((x) => x.regime_codigo)).toEqual(["SEM_DESONERACAO"]);
    await rejeitarRevisaoBase(revisaoBaseId, "teste", null);
    expect(await prisma.precos_referencia.count({ where: { revisao_base_id: revisaoBaseId } })).toBe(0);
    expect((await prisma.revisoes_base.findUniqueOrThrow({ where: { id: revisaoBaseId } })).status).toBe("REJEITADA");
  });
});

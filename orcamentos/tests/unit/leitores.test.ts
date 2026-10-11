import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lerCabecalhoDbf, lerRegistrosDbf, interpretarCabecalhoDbf } from "@/importacao/dbf";
import { detectarAssinatura } from "@/importacao/assinatura";
import { LeitorXlsx, colunaParaIndice, indiceParaColuna, normalizarRotulo } from "@/importacao/xlsx";
import { codigoDaFormulaHyperlink } from "@/importacao/adaptadores/sinapi-xlsx-2025";
import { competenciaPeloNome, montarDescricao } from "@/importacao/adaptadores/emop-dbf-v1";

const FIX = path.resolve(__dirname, "..", "fixtures");

describe("leitor DBF (amostra real EMOP)", () => {
  it("lê cabeçalho e campos do COMP", async () => {
    const c = await lerCabecalhoDbf(path.join(FIX, "emop-012026", "COMP0126.dbf"));
    expect(c.campos.map((x) => `${x.nome}:${x.tipo}${x.tamanho}`)).toEqual(["CODIGO:C13", "SEQUENCIA:C3", "ELEMENTAR:C5", "QUANTIDADE:N19", "PERCENTUAL:N19"]);
    expect(c.idioma).toBe(0);
  });
  it("devolve o texto original dos campos (zeros à esquerda e números sem perda)", async () => {
    const regs = [];
    for await (const r of lerRegistrosDbf(path.join(FIX, "emop-012026", "COMP0126.dbf"), { codificacao: "cp850" })) regs.push(r);
    const r = regs.find((x) => x.valores.CODIGO === "59.003.0060-B" && x.valores.ELEMENTAR === "00149")!;
    expect(r.valores.QUANTIDADE).toBe("       244.50000000");
    expect(r.valores.SEQUENCIA).toBe("002");
  });
  it("lê DBF com e sem marcador final 0x1A e recusa arquivo truncado", async () => {
    const tmp = path.join(os.tmpdir(), `dbf-${Date.now()}.dbf`);
    const { readFile } = await import("node:fs/promises");
    const original = await readFile(path.join(FIX, "emop-012026", "ELEM0126.dbf"));
    await writeFile(tmp, original.subarray(0, original.length - 1)); // sem 0x1A
    expect((await lerCabecalhoDbf(tmp)).registros).toBe(61);
    expect(() => interpretarCabecalhoDbf(original, original.length - 30)).toThrow(/truncado/);
  });
  it("descrição longa concatenada sem inserir espaços", () => {
    expect(montarDescricao(["REVESTIMENTO ... ESTR", "UTURADA C/MONT", "ANTES          "])).toBe("REVESTIMENTO ... ESTRUTURADA C/MONTANTES");
  });
  it("competência pelo nome do arquivo (MMAA)", () => {
    expect(competenciaPeloNome("COMP0126.dbf")!.competencia.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(competenciaPeloNome("EMOP0126 - Copia.xls")!.prefixo).toBe("EMOP");
    expect(competenciaPeloNome("outro.dbf")).toBeNull();
  });
});

describe("assinatura binária", () => {
  it("identifica pelo conteúdo, não pela extensão", async () => {
    const dir = os.tmpdir();
    const { readFile } = await import("node:fs/promises");
    const dbfComoXls = path.join(dir, `x-${Date.now()}.xls`);
    await writeFile(dbfComoXls, await readFile(path.join(FIX, "emop-012026", "EMOP0126.dbf")));
    expect((await detectarAssinatura(dbfComoXls)).assinatura).toBe("DBF");
    const legado = path.join(dir, `l-${Date.now()}.xls`);
    await writeFile(legado, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]));
    expect((await detectarAssinatura(legado)).assinatura).toBe("XLS_LEGADO");
    expect((await detectarAssinatura(path.join(FIX, "sinapi-202601", "SINAPI_Referência_2026_01.xlsx"))).assinatura).toBe("XLSX");
    const lixo = path.join(dir, `z-${Date.now()}.dbf`);
    await writeFile(lixo, Buffer.alloc(100, 7));
    expect((await detectarAssinatura(lixo)).assinatura).toBe("DESCONHECIDA");
  });
});

describe("leitor XLSX em fluxo (amostra real SINAPI)", () => {
  it("lê abas, fórmulas HYPERLINK e números como texto exato", async () => {
    const x = await LeitorXlsx.abrir(path.join(FIX, "sinapi-202601", "SINAPI_Referência_2026_01.xlsx"));
    try {
      expect(x.abas.map((a) => a.nome)).toContain("Analítico");
      let achou = false;
      for await (const l of x.linhas("CSD")) {
        const c = l.celulas.get(1);
        if (c?.formula && codigoDaFormulaHyperlink(c.formula) === "104658") {
          expect(c.valor).toBe("0"); // valor em cache sem significado
          expect(l.celulas.get(colunaParaIndice("AO"))!.valor).toBe("181.78");
          achou = true;
        }
      }
      expect(achou).toBe(true);
    } finally {
      x.fechar();
    }
  });
  it("utilitários", () => {
    expect(colunaParaIndice("A")).toBe(0);
    expect(colunaParaIndice("AO")).toBe(40);
    expect(indiceParaColuna(40)).toBe("AO");
    expect(normalizarRotulo("Código da\nComposição")).toBe("codigo da composicao");
    expect(codigoDaFormulaHyperlink('HYPERLINK("#"&CELL("address",OFFSET(Analítico!$B$1,MATCH(104658,Analítico!$B:$B,0)-1,3)),104658)')).toBe("104658");
    expect(codigoDaFormulaHyperlink("SUM(A1:A2)")).toBeNull();
  });
});

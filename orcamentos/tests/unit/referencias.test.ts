import { describe, expect, it } from "vitest";
import {
  codigoEmopComPontuacao, codigoEmopSemPontuacao, custoEmopReconstituido, custoSinapiReconstituido,
  lerCompetencia, regimeEmopPorCodigo,
} from "@/dominio/referencias";

describe("EMOP — regime pelo dígito final (Catálogo de Referência 13ª ed.)", () => {
  it.each([
    ["01.001.0001-0", "SEM_DESONERACAO"],
    ["01.001.0001-A", "COM_DESONERACAO"],
    ["59.003.0060-1", "SEM_DESONERACAO"],
    ["59.003.0060-B", "COM_DESONERACAO"],
    ["19.004.0012-3", "SEM_DESONERACAO"],
    ["19.004.0012-D", "COM_DESONERACAO"],
    ["19.004.0053-E", "COM_DESONERACAO"],
  ])("%s → %s", (codigo, regime) => expect(regimeEmopPorCodigo(codigo)).toBe(regime));
  it("formato inválido", () => expect(regimeEmopPorCodigo("123")).toBeNull());
  it("conversão de código REUT", () => {
    expect(codigoEmopSemPontuacao("01.001.0075-1")).toBe("0100100751");
    expect(codigoEmopComPontuacao("010010075B")).toBe("01.001.0075-B");
  });
});

describe("EMOP — reconstituição do custo (somente verificação)", () => {
  it("59.003.0060-B (jan/2026): componentes com 5% de perdas", () => {
    // Registro real do COMP0126: o resultado deve ficar a no máximo R$ 0,01 do publicado.
    // (O teste completo contra os 22.260 serviços roda na integração com a amostra real.)
    const v = custoEmopReconstituido([{ quantidade: "1", percentual: "0", precoElementar: "100.12345" }]);
    expect(v.toFixed(2)).toBe("100.12");
  });
  it("01.001.0149-A: caso real em que só o truncamento por linha em 4 casas fecha com o publicado (260,20)", () => {
    const v = custoEmopReconstituido([
      { quantidade: "0.5", percentual: "25", precoElementar: "27.5000" },
      { quantidade: "1.4", percentual: "25", precoElementar: "131.5125" },
      { quantidade: "0.17", percentual: "25", precoElementar: "60.5914" },
    ]);
    expect(v.toFixed(2)).toBe("260.20");
  });
});

describe("SINAPI — Σ TRUNC(coeficiente × custo; 2)", () => {
  it("trunca cada linha antes de somar", () => {
    const v = custoSinapiReconstituido([
      { coeficiente: "1.279", custoUnitario: "25.37" }, // 32,44823 → 32,44
      { coeficiente: "0.333", custoUnitario: "10.01" }, // 3,33333 → 3,33
    ]);
    expect(v.toFixed(2)).toBe("35.77");
  });
});

describe("competência", () => {
  it("formatos aceitos", () => {
    expect(lerCompetencia("01/2026")!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(lerCompetencia("2026-03")!.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(lerCompetencia("0126")!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(lerCompetencia("13/2026")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { D, ajustar, arredondar, decimalDeTextoBR, decimalDeTextoOficial, somar, truncar } from "@/dominio/decimal";
import { formatarMoeda, formatarNumero, formatarPercentual, formatarCompetencia } from "@/dominio/formato";

describe("precisão decimal", () => {
  it("soma 0,1 dez vezes resulta exatamente em 1 (ponto flutuante daria 0,9999999999999999)", () => {
    expect(somar(Array(10).fill("0.1")).toString()).toBe("1");
    let f = 0;
    for (let i = 0; i < 10; i++) f += 0.1;
    expect(f).not.toBe(1);
  });

  it("multiplica sem artefatos binários: 1,1965 × 160,3181", () => {
    expect(D("1.1965").times("160.3181").toString()).toBe("191.82060665");
  });

  it("truncar × arredondar em 2 casas", () => {
    expect(truncar("208.839", 2).toFixed(2)).toBe("208.83");
    expect(arredondar("208.835", 2).toFixed(2)).toBe("208.84");
    expect(arredondar("208.834999", 2).toFixed(2)).toBe("208.83");
    expect(ajustar("0.005", 2, "ARREDONDAR").toFixed(2)).toBe("0.01");
    expect(ajustar("0.009", 2, "TRUNCAR").toFixed(2)).toBe("0.00");
  });

  it("valores grandes mantêm centavos", () => {
    expect(D("987654321987.65").plus("0.01").toFixed(2)).toBe("987654321987.66");
  });

  it("lê texto numérico de arquivo oficial sem perda", () => {
    expect(decimalDeTextoOficial("           208.83")!.toString()).toBe("208.83");
    expect(decimalDeTextoOficial("         1.19650000")!.toString()).toBe("1.1965");
    expect(decimalDeTextoOficial("   ")).toBeNull();
    expect(() => decimalDeTextoOficial("*****")).toThrow();
  });

  it("lê número digitado no padrão brasileiro", () => {
    expect(decimalDeTextoBR("1.234,56")!.toString()).toBe("1234.56");
    expect(decimalDeTextoBR("R$ 10,5")!.toString()).toBe("10.5");
    expect(decimalDeTextoBR("1234.56")!.toString()).toBe("1234.56");
    expect(decimalDeTextoBR("1.234.567")!.toString()).toBe("1234567");
    expect(() => decimalDeTextoBR("12,3,4")).toThrow();
  });
});

describe("formatação brasileira", () => {
  it("moeda e números", () => {
    expect(formatarMoeda("1234567.8")).toBe("R$ 1.234.567,80");
    expect(formatarMoeda("0")).toBe("R$ 0,00");
    expect(formatarMoeda("-1500.5")).toBe("R$ -1.500,50");
    expect(formatarNumero("1.19650000", 4)).toBe("1,1965");
    expect(formatarPercentual("17.679245", 2)).toBe("17,68%");
    expect(formatarMoeda(null)).toBe("—");
  });
  it("competência", () => {
    expect(formatarCompetencia(new Date(Date.UTC(2026, 0, 1)))).toBe("jan/2026");
  });
});

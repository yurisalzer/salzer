import { describe, expect, it } from "vitest";
import { calcularBdi } from "@/dominio/bdi";

/**
 * Exemplos numéricos OFICIAIS: EMOP-RJ, Catálogo de Referência 13ª ed. (jan/2026),
 * item 2.3 "Quadro analítico dos percentuais de BDI por tipo de obra".
 * A EMOP publica o percentual arredondado ao inteiro; a fórmula deve chegar a ele.
 */
const edificios = {
  acimaDe1_5mi: { AC: "3.00", SG: "0.70", DF: "0.50", R: "0.90", L: "4.50" },
  ate150mil: { AC: "5.50", SG: "1.02", DF: "1.30", R: "1.00", L: "7.50" },
};
const tributos = { PIS: "0.65", COFINS: "3.00", ISS: "3.00" };

function parcelas(base: Record<string, string>, comDesoneracao: boolean) {
  const p = Object.entries({ ...base, ...tributos }).map(([codigo, percentual]) => ({ codigo: codigo as never, percentual }));
  if (comDesoneracao) p.push({ codigo: "CPRB" as never, percentual: "2.70" });
  return p;
}

describe("BDI — fórmula TCU 2622/2013 contra tabelas oficiais da EMOP", () => {
  it("Edifícios, custo direto acima de R$ 1,5 mi, sem desoneração: 17,68% (publicado 18%)", () => {
    const r = calcularBdi(parcelas(edificios.acimaDe1_5mi, false));
    expect(r.percentual2casas.toFixed(2)).toBe("17.68");
    expect(r.percentual.toDecimalPlaces(0).toString()).toBe("18");
  });

  it("Edifícios, acima de R$ 1,5 mi, com desoneração (CPRB 2,7%): 21,18% (publicado 21%)", () => {
    const r = calcularBdi(parcelas(edificios.acimaDe1_5mi, true));
    expect(r.percentual2casas.toFixed(2)).toBe("21.18");
    expect(r.percentual.toDecimalPlaces(0).toString()).toBe("21");
  });

  it("Edifícios, até R$ 150 mil: publicados 25% (sem) e 29% (com desoneração)", () => {
    expect(calcularBdi(parcelas(edificios.ate150mil, false)).percentual.toDecimalPlaces(0).toString()).toBe("25");
    expect(calcularBdi(parcelas(edificios.ate150mil, true)).percentual.toDecimalPlaces(0).toString()).toBe("29");
  });

  it("valor exato com muitas casas", () => {
    const r = calcularBdi(parcelas(edificios.acimaDe1_5mi, false));
    // (1,046 × 1,005 × 1,045) / 0,9335 − 1
    expect(r.fracao.toDecimalPlaces(10).toString()).toBe("0.1767920193");
  });

  it("rejeita parcelas repetidas, SG junto com S, e tributos ≥ 100%", () => {
    expect(() => calcularBdi([{ codigo: "AC", percentual: 1 }, { codigo: "AC", percentual: 2 }])).toThrow();
    expect(() => calcularBdi([{ codigo: "SG", percentual: 1 }, { codigo: "S", percentual: 2 }])).toThrow();
    expect(() => calcularBdi([{ codigo: "ISS", percentual: 100 }])).toThrow();
  });

  it("BDI zero sem parcelas", () => {
    expect(calcularBdi([]).percentual.toString()).toBe("0");
  });
});

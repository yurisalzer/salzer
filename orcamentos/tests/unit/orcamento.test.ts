import { describe, expect, it } from "vitest";
import { calcularItem, numerarEtapas, ordenarEtapasEmProfundidade, totalizar } from "@/dominio/orcamento";
import { curvaAbc } from "@/dominio/abc";
import { encontrarCiclo, encontrarCicloNoGrafo } from "@/dominio/ciclos";

describe("cálculo de item de orçamento", () => {
  it("TRUNCAR: custo 208,83 × BDI 25% = 261,0375 → 261,03; × 3,5 = 913,605 → 913,60", () => {
    const r = calcularItem({ custoUnitario: "208.83", quantidade: "3.5", bdiPercentual: "25", modo: "TRUNCAR" });
    expect(r.precoUnitario!.toFixed(2)).toBe("261.03");
    expect(r.total!.toFixed(2)).toBe("913.60");
    expect(r.custoTotal!.toFixed(2)).toBe("730.90");
    expect(r.valorBdi!.toFixed(2)).toBe("182.70");
  });

  it("ARREDONDAR: mesmo caso → 261,04 e 913,64", () => {
    const r = calcularItem({ custoUnitario: "208.83", quantidade: "3.5", bdiPercentual: "25", modo: "ARREDONDAR" });
    expect(r.precoUnitario!.toFixed(2)).toBe("261.04");
    expect(r.total!.toFixed(2)).toBe("913.64");
  });

  it("BDI individual por item diferente do global", () => {
    const global = calcularItem({ custoUnitario: "100", quantidade: "10", bdiPercentual: "25", modo: "TRUNCAR" });
    const individual = calcularItem({ custoUnitario: "100", quantidade: "10", bdiPercentual: "16", modo: "TRUNCAR" });
    expect(global.total!.toFixed(2)).toBe("1250.00");
    expect(individual.total!.toFixed(2)).toBe("1160.00");
    const t = totalizar([global, individual]);
    expect(t.custoDireto.toFixed(2)).toBe("2000.00");
    expect(t.total.toFixed(2)).toBe("2410.00");
    expect(t.bdi.toFixed(2)).toBe("410.00");
  });

  it("insumo EMOP com 4 casas no custo (ELEM 3,4979) e quantidade fracionária", () => {
    const r = calcularItem({ custoUnitario: "3.4979", quantidade: "0.333333", bdiPercentual: "17.68", modo: "TRUNCAR" });
    // 3,4979 × 1,1768 = 4,11632872 → 4,11 ; 0,333333 × 4,11 = 1,36999863 → 1,36
    expect(r.precoUnitario!.toFixed(2)).toBe("4.11");
    expect(r.total!.toFixed(2)).toBe("1.36");
  });

  it("item sem preço (ausente) não é tratado como zero", () => {
    const r = calcularItem({ custoUnitario: null, quantidade: "2", bdiPercentual: "25", modo: "TRUNCAR" });
    expect(r.total).toBeNull();
    const t = totalizar([r, calcularItem({ custoUnitario: "10", quantidade: "1", bdiPercentual: "0", modo: "TRUNCAR" })]);
    expect(t.itensSemPreco).toBe(1);
    expect(t.total.toFixed(2)).toBe("10.00");
  });

  it("rejeita quantidade negativa", () => {
    expect(() => calcularItem({ custoUnitario: "1", quantidade: "-1", bdiPercentual: "0", modo: "TRUNCAR" })).toThrow();
  });
});

describe("etapas", () => {
  const etapas = [
    { id: "b", pai_id: null, ordem: 2 },
    { id: "a", pai_id: null, ordem: 1 },
    { id: "a2", pai_id: "a", ordem: 2 },
    { id: "a1", pai_id: "a", ordem: 1 },
    { id: "a11", pai_id: "a1", ordem: 1 },
    { id: "b1", pai_id: "b", ordem: 1 },
  ];
  it("numeração hierárquica", () => {
    const n = numerarEtapas(etapas);
    expect(n.get("a")).toBe("1");
    expect(n.get("a1")).toBe("1.1");
    expect(n.get("a11")).toBe("1.1.1");
    expect(n.get("a2")).toBe("1.2");
    expect(n.get("b1")).toBe("2.1");
  });
  it("ordem de exibição em profundidade", () => {
    expect(ordenarEtapasEmProfundidade(etapas).map((e) => e.id)).toEqual(["a", "a1", "a11", "a2", "b", "b1"]);
  });
});

describe("curva ABC", () => {
  it("classifica por acumulado (80/95)", () => {
    const r = curvaAbc([
      { chave: "x", valor: "700" },
      { chave: "y", valor: "200" },
      { chave: "z", valor: "60" },
      { chave: "w", valor: "40" },
      { chave: "x", valor: "100" }, // mesmo insumo em outro serviço: soma
    ]);
    expect(r.map((l) => [l.entrada.chave, l.valor.toString(), l.classe])).toEqual([
      ["x", "800", "A"],
      ["y", "200", "B"],
      ["z", "60", "C"],
      ["w", "40", "C"],
    ]);
    expect(r[3]!.percentualAcumulado.toString()).toBe("100");
  });
});

describe("referências circulares", () => {
  it("detecta A → B → C → A", () => {
    const g = new Map([["A", ["B"]], ["B", ["C"]], ["C", ["A"]]]);
    expect(encontrarCiclo("A", (n) => g.get(n) ?? [])).toEqual(["A", "B", "C", "A"]);
  });
  it("auto-referência", () => {
    expect(encontrarCicloNoGrafo(new Map([["A", ["A"]]]))).toEqual(["A", "A"]);
  });
  it("grafo sem ciclo (diamante)", () => {
    const g = new Map([["A", ["B", "C"]], ["B", ["D"]], ["C", ["D"]], ["D", []]]);
    expect(encontrarCicloNoGrafo(g)).toBeNull();
  });
});

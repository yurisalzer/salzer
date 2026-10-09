import { describe, expect, it } from "vitest";
import { calcularBdi } from "@/dominio/bdi";
import { perfisBdiEmop } from "@/dominio/bdi-emop";

describe("36 perfis de BDI oficiais da EMOP (13ª ed.)", () => {
  const perfis = perfisBdiEmop();
  it("são 6 tipos × 3 faixas × 2 regimes", () => expect(perfis).toHaveLength(36));
  it.each(perfis.map((p) => [p.nome, p] as const))("%s", (_nome, p) => {
    const r = calcularBdi(p.parcelas);
    // A EMOP publica o percentual arredondado ao inteiro.
    expect(Number(r.percentual.toDecimalPlaces(0).toString())).toBe(p.percentualPublicado);
  });
});

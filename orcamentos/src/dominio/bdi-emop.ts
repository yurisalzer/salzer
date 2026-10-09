import type { CodigoParcela } from "./bdi";

/**
 * Perfis de BDI publicados pela EMOP-RJ — Catálogo de Referência 13ª edição (janeiro/2026),
 * item 2.3 "Quadro analítico dos percentuais de BDI por tipo de obra".
 * Valores transcritos do PDF oficial; parcelas em pontos percentuais.
 * Impostos sobre o faturamento: ISS 3%, COFINS 3%, PIS 0,65% (fornecimento: sem ISS).
 * Com desoneração: + INSS sobre a receita bruta 2,7% (Lei 14.973/2024, ano de 2026).
 */
export const DOCUMENTO_BDI_EMOP = "EMOP-RJ, Catálogo de Referência 13ª ed. (jan/2026), item 2.3";

export const FAIXAS_EMOP = ["acima de R$ 1.500.000,00", "entre R$ 150.000,00 e R$ 1.500.000,00", "até R$ 150.000,00"] as const;

interface TipoObraEmop {
  tipo: string;
  AC: [string, string, string];
  SG: [string, string, string];
  DF: [string, string, string];
  R: [string, string, string];
  L: [string, string, string];
  semIss?: boolean;
  publicadoSem: [number, number, number];
  publicadoCom: [number, number, number];
}

export const TIPOS_OBRA_EMOP: TipoObraEmop[] = [
  { tipo: "Construção de edifícios (novos e reformas)", AC: ["3.00", "4.50", "5.50"], SG: ["0.70", "1.00", "1.02"], DF: ["0.50", "1.20", "1.30"], R: ["0.90", "0.95", "1.00"], L: ["4.50", "6.00", "7.50"], publicadoSem: [18, 22, 25], publicadoCom: [21, 26, 29] },
  { tipo: "Construção de rodovias e ferrovias (inclusive conservação)", AC: ["3.80", "4.50", "5.00"], SG: ["0.35", "0.45", "0.70"], DF: ["0.85", "0.90", "1.50"], R: ["0.50", "0.55", "0.80"], L: ["5.00", "6.50", "7.50"], publicadoSem: [19, 21, 24], publicadoCom: [22, 25, 28] },
  { tipo: "Redes de abastecimento de água, coleta de esgoto e construções correlatas", AC: ["3.50", "5.00", "5.50"], SG: ["0.35", "0.50", "0.70"], DF: ["0.70", "0.75", "0.80"], R: ["1.00", "1.30", "1.50"], L: ["6.50", "8.00", "8.50"], publicadoSem: [20, 24, 26], publicadoCom: [24, 28, 30] },
  { tipo: "Obras portuárias, marítimas e fluviais", AC: ["4.50", "5.00", "6.00"], SG: ["0.80", "1.50", "1.50"], DF: ["0.70", "0.90", "1.10"], R: ["1.50", "2.50", "3.50"], L: ["6.30", "8.00", "9.00"], publicadoSem: [22, 27, 31], publicadoCom: [26, 31, 35] },
  { tipo: "Serviços com custos administrativos menores", AC: ["1.00", "2.50", "4.00"], SG: ["0.35", "0.55", "0.85"], DF: ["0.55", "0.65", "0.90"], R: ["0.35", "0.45", "0.75"], L: ["3.00", "4.00", "5.50"], publicadoSem: [13, 16, 20], publicadoCom: [16, 20, 24] },
  { tipo: "Fornecimento de materiais e equipamentos", AC: ["1.00", "2.50", "3.50"], SG: ["0.30", "0.50", "0.80"], DF: ["0.85", "0.85", "1.10"], R: ["0.55", "0.80", "0.90"], L: ["3.00", "4.00", "5.00"], semIss: true, publicadoSem: [10, 13, 16], publicadoCom: [13, 16, 19] },
];

export interface PerfilBdiOficial {
  nome: string;
  tipoObra: string;
  faixa: string;
  regime: "SEM_DESONERACAO" | "COM_DESONERACAO";
  percentualPublicado: number;
  parcelas: Array<{ codigo: CodigoParcela; percentual: string }>;
}

export function perfisBdiEmop(): PerfilBdiOficial[] {
  const lista: PerfilBdiOficial[] = [];
  for (const t of TIPOS_OBRA_EMOP) {
    for (const regime of ["SEM_DESONERACAO", "COM_DESONERACAO"] as const) {
      FAIXAS_EMOP.forEach((faixa, i) => {
        const parcelas: PerfilBdiOficial["parcelas"] = [
          { codigo: "AC", percentual: t.AC[i]! },
          { codigo: "SG", percentual: t.SG[i]! },
          { codigo: "R", percentual: t.R[i]! },
          { codigo: "DF", percentual: t.DF[i]! },
          { codigo: "L", percentual: t.L[i]! },
          { codigo: "PIS", percentual: "0.65" },
          { codigo: "COFINS", percentual: "3.00" },
        ];
        if (!t.semIss) parcelas.push({ codigo: "ISS", percentual: "3.00" });
        if (regime === "COM_DESONERACAO") parcelas.push({ codigo: "CPRB", percentual: "2.70" });
        const pub = regime === "SEM_DESONERACAO" ? t.publicadoSem[i]! : t.publicadoCom[i]!;
        lista.push({
          nome: `EMOP 13ª ed. — ${t.tipo} — ${regime === "SEM_DESONERACAO" ? "sem" : "com"} desoneração — custo direto ${faixa}`,
          tipoObra: t.tipo,
          faixa,
          regime,
          percentualPublicado: pub,
          parcelas,
        });
      });
    }
  }
  return lista;
}

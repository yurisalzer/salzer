import { copyFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/servidor/db";
import { criarDiretorioTemporario } from "@/importacao/pacotes";
import { analisarImportacao, confirmarImportacao, publicarRevisaoBase } from "@/importacao/servico";

const FIX = path.resolve(__dirname, "..", "fixtures");

/** Importa e publica as amostras reais (EMOP e SINAPI jan/2026). Retorna os ids das revisões. */
export async function publicarAmostras(): Promise<{ emop: string; sinapi: string }> {
  const importar = async (fonte: "EMOP" | "SINAPI", dirFix: string, nomes: string[], regimes: string[]) => {
    const dir = await criarDiretorioTemporario();
    const enviados = [];
    for (const [i, n] of nomes.entries()) {
      const c = path.join(dir, `e${i}`);
      await copyFile(path.join(FIX, dirFix, n), c);
      enviados.push({ nomeOriginal: n, caminho: c });
    }
    const r = await analisarImportacao({ fonte, uf: "RJ", competencia: new Date(Date.UTC(2026, 0, 1)), regimes: regimes as never, usuarioId: null, dir, enviados });
    if (r.status !== "ANALISADO" || r.erros > 0) {
      const l = await prisma.lotes_importacao.findUnique({ where: { id: r.loteId } });
      throw new Error(`Falha ao importar amostra ${fonte}: ${l?.erro}`);
    }
    const { revisaoBaseId } = await confirmarImportacao(r.loteId, null);
    await publicarRevisaoBase(revisaoBaseId, null);
    return revisaoBaseId;
  };
  const emop = await importar("EMOP", "emop-012026", ["EMOP0126.dbf", "DIPR0126.dbf", "COMP0126.dbf", "MAT0126.dbf", "REUT0126.dbf", "ELEM0126.dbf"], ["SEM_DESONERACAO", "COM_DESONERACAO"]);
  const sinapi = await importar("SINAPI", "sinapi-202601", ["SINAPI_Referência_2026_01.xlsx", "SINAPI_mao_de_obra_2026_01.xlsx", "SINAPI_Manutenções_2026_01.xlsx"], ["SEM_DESONERACAO", "COM_DESONERACAO", "SEM_ENCARGOS"]);
  return { emop, sinapi };
}

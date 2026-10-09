"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigir } from "@/servidor/autenticacao";
import { usuarioAtual } from "@/servidor/sessao";
import { copiarComoPropria, salvarComposicaoPropria } from "@/servidor/composicoes-proprias";
import { ErroDeNegocio } from "@/importacao/servico";
import type { EstadoAcao } from "@/componentes/botao-acao";

const decimal = z.string().trim().regex(/^\d+(\.\d+)?$/, "Número inválido");
const Esquema = z.object({
  itemId: z.string().uuid().nullable().optional(),
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(2000),
  unidade: z.string().min(1).max(20),
  observacao: z.string().max(2000).nullable().optional(),
  componentes: z.array(z.object({
    itemId: z.string().uuid().nullable().optional(),
    revisaoBaseId: z.string().uuid().nullable().optional(),
    regime: z.string().nullable().optional(),
    coeficiente: decimal,
    custoInformado: decimal.nullable().optional(),
    descricaoInformada: z.string().max(500).nullable().optional(),
    unidadeInformada: z.string().max(20).nullable().optional(),
  })).min(1).max(300),
});

export async function acaoSalvarComposicao(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  let destino = "";
  try {
    const u = await usuarioAtual();
    exigir(u, "composicoes.editar");
    const dados = Esquema.parse(JSON.parse(String(f.get("dados") ?? "{}")));
    const r = await salvarComposicaoPropria(dados, u.id);
    revalidatePath("/composicoes");
    destino = `/referencias/${r.itemId}`;
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { erro: e.message };
    if (e instanceof z.ZodError) return { erro: "Dados inválidos: " + e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    console.error(e);
    return { erro: "Não foi possível salvar a composição." };
  }
  redirect(destino);
}

export async function acaoCopiarComoPropria(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  let destino = "";
  try {
    const u = await usuarioAtual();
    exigir(u, "composicoes.editar");
    const r = await copiarComoPropria(String(f.get("itemId")), String(f.get("revisaoId")), String(f.get("regime")), String(f.get("codigo") ?? ""), u.id);
    destino = `/referencias/${r.itemId}`;
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível copiar a composição." };
  }
  redirect(destino);
}

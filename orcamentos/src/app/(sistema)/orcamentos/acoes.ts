"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { exigir, type UsuarioSessao } from "@/servidor/autenticacao";
import { usuarioAtual } from "@/servidor/sessao";
import * as O from "@/servidor/orcamentos";
import { ErroDeNegocio } from "@/importacao/servico";
import { decimalDeTextoBR } from "@/dominio/decimal";
import type { EstadoAcao } from "@/componentes/botao-acao";
import type { Permissao } from "@/servidor/permissoes";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return v === null ? "" : String(v);
};
const versao = (f: FormData) => (f.get("versao") ? Number(f.get("versao")) : null);
/** Número digitado no padrão brasileiro → texto decimal com ponto. */
function numeroBR(f: FormData, k: string, obrigatorio = true): string | null {
  const t = s(f, k);
  if (!t.trim()) {
    if (obrigatorio) throw new ErroDeNegocio(`Informe ${k}.`);
    return null;
  }
  try {
    return decimalDeTextoBR(t)!.toString();
  } catch {
    throw new ErroDeNegocio(`Número inválido: "${t}"`);
  }
}

async function executar(permissao: Permissao, fn: (u: UsuarioSessao) => Promise<string | void>, caminho?: string): Promise<EstadoAcao> {
  try {
    const u = await usuarioAtual();
    exigir(u, permissao);
    const ok = await fn(u);
    if (caminho) revalidatePath(caminho);
    return { ok: ok || undefined };
  } catch (e) {
    if (e instanceof ErroDeNegocio) return { erro: e.message };
    if (e instanceof Error && /permissão/.test(e.message)) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível concluir a operação." };
  }
}

const caminhoRevisao = (f: FormData) => `/orcamentos/${s(f, "orcamentoId")}/revisoes/${s(f, "revisaoId")}`;

// Obras e orçamentos -------------------------------------------------------------------------

export async function acaoCriarObra(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  let id = "";
  const r = await executar("orcamentos.editar", async (u) => {
    id = (await O.criarObra({ nome: s(f, "nome"), cliente: s(f, "cliente"), municipio: s(f, "municipio"), endereco: s(f, "endereco"), descricao: s(f, "descricao") }, u.id)).id;
  });
  if (r.erro) return r;
  redirect(`/obras/${id}`);
}

export async function acaoCriarOrcamento(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  let destino = "";
  const r = await executar("orcamentos.editar", async (u) => {
    const bases: O.BasePadrao[] = [];
    if (s(f, "emop")) bases.push({ fonteSigla: "EMOP", revisaoBaseId: s(f, "emop"), regime: s(f, "regime_emop") });
    if (s(f, "sinapi")) bases.push({ fonteSigla: "SINAPI", revisaoBaseId: s(f, "sinapi"), regime: s(f, "regime_sinapi") });
    const bdi: O.EntradaBdi = s(f, "perfil") ? { perfilId: s(f, "perfil") } : { nome: "BDI informado", percentual: numeroBR(f, "bdi_percentual")! };
    const prazo = s(f, "prazo") ? Number(s(f, "prazo")) : null;
    const o = await O.criarOrcamento({
      obraId: s(f, "obraId"), nome: s(f, "nome"), codigo: s(f, "codigo"), descricao: s(f, "descricao"), bases, bdi,
      modoArredondamento: s(f, "modo") === "ARREDONDAR" ? "ARREDONDAR" : "TRUNCAR", prazoMeses: prazo,
    }, u.id);
    destino = `/orcamentos/${o.orcamentoId}/revisoes/${o.revisaoId}`;
  });
  if (r.erro) return r;
  redirect(destino);
}

// Etapas ---------------------------------------------------------------------------------------

export async function acaoAdicionarEtapa(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.adicionarEtapa(s(f, "revisaoId"), versao(f), s(f, "titulo"), s(f, "paiId") || null, u.id);
  }, caminhoRevisao(f));
}

export async function acaoRenomearEtapa(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.renomearEtapa(s(f, "revisaoId"), versao(f), s(f, "etapaId"), s(f, "titulo"), u.id);
  }, caminhoRevisao(f));
}

export async function acaoExcluirEtapa(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.excluirEtapa(s(f, "revisaoId"), versao(f), s(f, "etapaId"), u.id);
  }, caminhoRevisao(f));
}

export async function acaoMoverEtapa(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.moverEtapa(s(f, "revisaoId"), versao(f), s(f, "etapaId"), s(f, "direcao") === "acima" ? "acima" : "abaixo", u.id);
  }, caminhoRevisao(f));
}

// Itens ----------------------------------------------------------------------------------------

export async function acaoAdicionarItem(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    const quantidade = numeroBR(f, "quantidade")!;
    if (s(f, "fonte") === "PROPRIA") {
      await O.adicionarItemProprio(s(f, "revisaoId"), versao(f), { etapaId: s(f, "etapaId"), composicaoItemId: s(f, "itemId"), quantidade }, u.id);
    } else {
      await O.adicionarItemReferencia(s(f, "revisaoId"), versao(f), {
        etapaId: s(f, "etapaId"), itemReferenciaId: s(f, "itemId"), revisaoBaseId: s(f, "revisaoBaseId") || null, regime: s(f, "regime") || null, quantidade,
      }, u.id);
    }
    return "Item adicionado.";
  }, caminhoRevisao(f));
}

export async function acaoAdicionarServicoProprio(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.adicionarItemProprio(s(f, "revisaoId"), versao(f), {
      etapaId: s(f, "etapaId"), codigo: s(f, "codigo"), descricao: s(f, "descricao"), unidade: s(f, "unidade"),
      custoUnitario: numeroBR(f, "custo"), quantidade: numeroBR(f, "quantidade")!, observacao: s(f, "observacao"),
    }, u.id);
    return "Serviço próprio adicionado.";
  }, caminhoRevisao(f));
}

export async function acaoAlterarItem(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    const a: O.AlteracaoItem = {};
    if (f.has("quantidade")) a.quantidade = numeroBR(f, "quantidade")!;
    if (f.has("bdi")) a.bdiAplicadoId = s(f, "bdi") || null;
    if (f.has("custo")) a.custoUnitario = numeroBR(f, "custo")!;
    await O.alterarItem(s(f, "revisaoId"), versao(f), s(f, "itemId"), a, u.id);
  }, caminhoRevisao(f));
}

export async function acaoExcluirItem(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.excluirItem(s(f, "revisaoId"), versao(f), s(f, "itemId"), u.id);
  }, caminhoRevisao(f));
}

export async function acaoMoverItem(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.moverItem(s(f, "revisaoId"), versao(f), s(f, "itemId"), s(f, "direcao") === "acima" ? "acima" : "abaixo", u.id);
  }, caminhoRevisao(f));
}

// BDI, parâmetros e cronograma ------------------------------------------------------------------

function entradaBdi(f: FormData): O.EntradaBdi {
  return s(f, "perfil") ? { perfilId: s(f, "perfil") } : { nome: s(f, "nome") || "BDI informado", percentual: numeroBR(f, "percentual")! };
}

export async function acaoDefinirBdiPadrao(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.definirBdiPadrao(s(f, "revisaoId"), versao(f), entradaBdi(f), u.id);
    return "BDI padrão atualizado e itens recalculados.";
  }, caminhoRevisao(f));
}

export async function acaoAdicionarBdi(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.adicionarBdiDiferenciado(s(f, "revisaoId"), versao(f), entradaBdi(f), u.id);
    return "BDI diferenciado criado; selecione-o nos itens.";
  }, caminhoRevisao(f));
}

export async function acaoParametros(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    await O.definirParametros(s(f, "revisaoId"), versao(f), {
      modo: s(f, "modo") === "ARREDONDAR" ? "ARREDONDAR" : "TRUNCAR",
      prazoMeses: s(f, "prazo") ? Number(s(f, "prazo")) : null,
      descricao: s(f, "descricao"),
    }, u.id);
    return "Parâmetros salvos.";
  }, caminhoRevisao(f));
}

export async function acaoCronograma(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.editar", async (u) => {
    const meses = Number(s(f, "meses"));
    const valores = Array.from({ length: meses }, (_x, i) => {
      const t = s(f, `m${i + 1}`);
      return t.trim() ? decimalDeTextoBR(t)!.toString() : "0";
    });
    await O.definirCronogramaEtapa(s(f, "revisaoId"), versao(f), s(f, "etapaId"), valores, u.id);
    return "Cronograma salvo.";
  }, caminhoRevisao(f));
}

// Revisões ---------------------------------------------------------------------------------------

export async function acaoFechar(_e: EstadoAcao, f: FormData) {
  return executar("orcamentos.fechar", async (u) => {
    const r = await O.fecharRevisao(s(f, "revisaoId"), versao(f), u.id);
    return `Revisão fechada. Código de integridade: ${r.hash.slice(0, 16)}…`;
  }, caminhoRevisao(f));
}

export async function acaoNovaRevisao(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  let destino = "";
  const r = await executar("orcamentos.editar", async (u) => {
    const nova = await O.novaRevisao(s(f, "revisaoId"), s(f, "descricao"), u.id);
    const bases: O.BasePadrao[] = [];
    if (s(f, "emop")) bases.push({ fonteSigla: "EMOP", revisaoBaseId: s(f, "emop"), regime: s(f, "regime_emop") });
    if (s(f, "sinapi")) bases.push({ fonteSigla: "SINAPI", revisaoBaseId: s(f, "sinapi"), regime: s(f, "regime_sinapi") });
    if (bases.length) await O.atualizarCompetencia(nova.id, null, bases, u.id);
    destino = `/orcamentos/${s(f, "orcamentoId")}/revisoes/${nova.id}`;
  });
  if (r.erro) return r;
  redirect(destino);
}

export async function acaoDuplicar(_e: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  let destino = "";
  const r = await executar("orcamentos.editar", async (u) => {
    const d = await O.duplicarOrcamento(s(f, "revisaoId"), s(f, "nome"), u.id);
    destino = `/orcamentos/${d.orcamentoId}/revisoes/${d.revisaoId}`;
  });
  if (r.erro) return r;
  redirect(destino);
}

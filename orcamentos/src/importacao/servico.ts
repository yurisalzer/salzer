import { Prisma } from "@prisma/client";
import { prisma } from "@/servidor/db";
import { auditar } from "@/servidor/auditoria";
import type { CodigoRegime } from "@/dominio/referencias";
import { adaptadorEmopDbfV1 } from "./adaptadores/emop-dbf-v1";
import { adaptadorSinapiXlsx2025 } from "./adaptadores/sinapi-xlsx-2025";
import { prepararArquivos, removerDiretorio } from "./pacotes";
import { gravarRevisaoBase } from "./publicacao";
import { GravadorStaging, limparStaging } from "./staging";
import { IMPORTADOR_VERSAO, type Adaptador, type ArquivoEntrada, type SiglaFonteOficial, type Verificacao } from "./tipos";
import { validarStaging } from "./validacao";

/** Adaptadores disponíveis por fonte (o primeiro que reconhecer os arquivos é usado). */
export const ADAPTADORES: Record<SiglaFonteOficial, Adaptador[]> = {
  EMOP: [adaptadorEmopDbfV1],
  SINAPI: [adaptadorSinapiXlsx2025],
};

export const TIMEOUT_TRANSACAO_MS = 20 * 60 * 1000;

export class ErroDeNegocio extends Error {}

export interface PedidoImportacao {
  fonte: SiglaFonteOficial;
  uf: string;
  competencia: Date;
  regimes: CodigoRegime[];
  rotuloRevisao?: string | null;
  usuarioId: string | null;
  /** Arquivos já gravados no diretório temporário `dir` */
  dir: string;
  enviados: Array<{ nomeOriginal: string; caminho: string }>;
  /** Justificativa para reimportar arquivo já importado (exige permissão) */
  justificativaDuplicidade?: string | null;
  podeAutorizarDuplicidade?: boolean;
  ip?: string | null;
}

export interface ResultadoAnalise {
  loteId: string;
  status: string;
  erros: number;
  avisos: number;
}

/**
 * Passos 4 a 7 do assistente: recebe os arquivos, identifica o layout, grava no staging,
 * valida e deixa o lote "ANALISADO" para pré-visualização. Nada vai às tabelas definitivas.
 */
export async function analisarImportacao(p: PedidoImportacao): Promise<ResultadoAnalise> {
  const fonte = await prisma.fontes.findUniqueOrThrow({ where: { sigla: p.fonte } });
  const lote = await prisma.lotes_importacao.create({
    data: {
      fonte_id: fonte.id, uf: p.uf, competencia: p.competencia, regimes: p.regimes,
      rotulo_revisao: p.rotuloRevisao?.trim() || "Original", importador_versao: IMPORTADOR_VERSAO,
      usuario_id: p.usuarioId, duplicidade_justificativa: p.justificativaDuplicidade?.trim() || null,
    },
  });
  await auditar({ usuarioId: p.usuarioId, acao: "IMPORTACAO_INICIADA", entidade: "lotes_importacao", entidadeId: lote.id, dados: { fonte: p.fonte, uf: p.uf, competencia: p.competencia.toISOString().slice(0, 10), arquivos: p.enviados.map((e) => e.nomeOriginal) }, ip: p.ip });

  try {
    // 4–5) Arquivos: hash, assinatura real, expansão de ZIP/RAR
    const preparados = await prepararArquivos(p.dir, p.enviados);
    const entradas: ArquivoEntrada[] = [];
    for (const a of preparados) {
      const reg = await prisma.arquivos_importacao.create({
        data: {
          lote_id: lote.id, nome: a.nome, caminho: a.caminhoNoPacote, pacote_sha256: a.pacoteSha256, tamanho: BigInt(a.tamanho),
          sha256: a.sha256 ?? "0".repeat(64), assinatura: a.assinatura,
        },
      });
      if (a.caminhoDisco && a.sha256 && a.assinatura !== "ZIP" && a.assinatura !== "RAR") {
        entradas.push({ id: reg.id, nome: a.nome, caminhoNoPacote: a.caminhoNoPacote, caminhoDisco: a.caminhoDisco, sha256: a.sha256, assinatura: a.assinatura as ArquivoEntrada["assinatura"], tamanho: a.tamanho });
      }
    }

    const adaptador = ADAPTADORES[p.fonte][0]!;
    const ident = await adaptador.identificar(entradas);
    if (ident.reconhecidos.length === 0) {
      throw new ErroDeNegocio(`Nenhum arquivo reconhecido como ${p.fonte}. Envie os arquivos oficiais (${adaptador.descricao}).`);
    }
    if (ident.faltando.length > 0) throw new ErroDeNegocio(`Arquivos obrigatórios ausentes: ${ident.faltando.join("; ")}.`);
    if (ident.sugestoes.competencia && ident.sugestoes.competencia.getTime() !== p.competencia.getTime()) {
      throw new ErroDeNegocio(`Os arquivos são da competência ${ident.sugestoes.competencia.toISOString().slice(0, 7)}, mas foi selecionada ${p.competencia.toISOString().slice(0, 7)}.`);
    }

    // Duplicidade: os arquivos PRINCIPAIS já foram importados (e não rejeitados)? Numa retificação é
    // normal que arquivos auxiliares sejam idênticos ao original; isso só é informado.
    const principais = p.fonte === "SINAPI" ? ident.reconhecidos.filter((r) => r.papel === "SINAPI_REFERENCIA") : ident.reconhecidos;
    const jaImportados = await prisma.arquivos_importacao.findMany({
      where: {
        sha256: { in: ident.reconhecidos.map((r) => r.arquivo.sha256) }, lote_id: { not: lote.id },
        lotes_importacao: { status: "IMPORTADO", revisao_base_criada: { status: { not: "REJEITADA" } } },
      },
    });
    const shasRepetidos = new Set(jaImportados.map((r) => r.sha256));
    const verificacoesDuplicidade: Verificacao[] = [];
    if (principais.every((r) => shasRepetidos.has(r.arquivo.sha256))) {
      const lista = principais.map((r) => r.arquivo.nome).join(", ");
      if (!p.podeAutorizarDuplicidade || !p.justificativaDuplicidade?.trim()) {
        throw new ErroDeNegocio(`Arquivo(s) já importado(s) anteriormente: ${lista}. A reimportação exige permissão específica e justificativa.`);
      }
      await auditar({ usuarioId: p.usuarioId, acao: "DUPLICIDADE_AUTORIZADA", entidade: "lotes_importacao", entidadeId: lote.id, dados: { arquivos: lista, justificativa: p.justificativaDuplicidade }, ip: p.ip });
      verificacoesDuplicidade.push({ regra: "DUPLICIDADE_AUTORIZADA", severidade: "AVISO", mensagem: `Reimportação autorizada de ${lista}. Justificativa: ${p.justificativaDuplicidade}` });
    } else {
      for (const r of ident.reconhecidos.filter((x) => shasRepetidos.has(x.arquivo.sha256))) {
        verificacoesDuplicidade.push({ regra: "ARQUIVO_JA_IMPORTADO", severidade: "INFO", arquivo: r.arquivo.nome, mensagem: "Arquivo idêntico (mesmo SHA-256) a um já importado; normal em retificações quando o arquivo não mudou." });
      }
    }

    // Revisão pendente para a mesma base bloqueia nova importação
    const pendente = await prisma.revisoes_base.findFirst({
      where: { status: "VALIDADA", bases_referencia: { fonte_id: fonte.id, uf: p.uf, competencia: p.competencia } },
    });
    if (pendente) throw new ErroDeNegocio(`Já existe uma importação desta competência aguardando publicação ("${pendente.rotulo}"). Publique ou rejeite antes de importar outra.`);

    // 6) Leitura para o staging
    const gravador = new GravadorStaging(lote.id);
    await adaptador.ler({ loteId: lote.id, fonte: p.fonte, uf: p.uf, competencia: p.competencia, regimes: p.regimes }, ident, gravador);
    const contagens = await gravador.finalizar();
    // Estatísticas atualizadas evitam planos ruins nas validações sobre o staging recém-carregado.
    await prisma.$executeRawUnsafe(`ANALYZE stg_itens, stg_precos, stg_componentes, stg_composicoes, stg_atributos`);

    // 6) Validações de consistência
    const verificacoes: Verificacao[] = [...verificacoesDuplicidade, ...gravador.verificacoes];
    for (const [regra, total] of gravador.totaisPorRegra) {
      const detalhadas = gravador.verificacoes.filter((v) => v.regra === regra).length;
      if (total > detalhadas) verificacoes.push({ regra, severidade: "INFO", mensagem: `Regra ${regra}: ${total} ocorrências no total (${detalhadas} detalhadas acima).` });
    }
    verificacoes.push(...(await validarStaging(prisma, lote.id, p.fonte)));
    for (const ig of ident.ignorados) {
      verificacoes.push({ regra: "ARQUIVO_IGNORADO", severidade: "INFO", arquivo: ig.arquivo.caminhoNoPacote, mensagem: ig.motivo });
    }
    await prisma.verificacoes_importacao.createMany({
      data: verificacoes.map((v) => ({
        lote_id: lote.id, regra: v.regra, severidade: v.severidade, mensagem: v.mensagem.slice(0, 2000),
        arquivo: v.arquivo ?? null, linha: v.linha ?? null, codigo: v.codigo ?? null,
        detalhes: v.detalhes === undefined ? Prisma.JsonNull : (v.detalhes as Prisma.InputJsonValue),
      })),
    });
    const erros = verificacoes.filter((v) => v.severidade === "ERRO").length;
    const avisos = verificacoes.filter((v) => v.severidade === "AVISO").length;
    await prisma.lotes_importacao.update({
      where: { id: lote.id },
      data: {
        status: "ANALISADO", adaptador: adaptador.id, analisado_em: new Date(),
        rotulo_revisao: p.rotuloRevisao?.trim() || ident.sugestoes.rotuloRevisao || "Original",
        contagens: { ...contagens, erros, avisos },
        metadados: gravador.metadados as Prisma.InputJsonValue,
      },
    });
    await auditar({ usuarioId: p.usuarioId, acao: "IMPORTACAO_ANALISADA", entidade: "lotes_importacao", entidadeId: lote.id, dados: { erros, avisos, contagens }, ip: p.ip });
    return { loteId: lote.id, status: "ANALISADO", erros, avisos };
  } catch (e) {
    await limparStaging(lote.id).catch(() => undefined);
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.lotes_importacao.update({ where: { id: lote.id }, data: { status: "FALHOU", erro: msg.slice(0, 4000), concluido_em: new Date() } });
    await auditar({ usuarioId: p.usuarioId, acao: "IMPORTACAO_FALHOU", entidade: "lotes_importacao", entidadeId: lote.id, dados: { erro: msg.slice(0, 1000) }, ip: p.ip });
    return { loteId: lote.id, status: "FALHOU", erros: 1, avisos: 0 };
  } finally {
    await removerDiretorio(p.dir).catch(() => undefined);
  }
}

/**
 * Passos 8–9: confirmação e gravação transacional. Cria a revisão da base com status VALIDADA
 * (ainda indisponível para orçamentos até a publicação).
 */
export async function confirmarImportacao(
  loteId: string,
  usuarioId: string | null,
  opcoes: { falharApos?: "itens" | "precos" | "composicoes"; ip?: string | null } = {},
): Promise<{ revisaoBaseId: string }> {
  const lote = await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: loteId } });
  if (lote.status !== "ANALISADO") throw new ErroDeNegocio(`O lote não pode ser confirmado (situação: ${lote.status}).`);
  const erros = await prisma.verificacoes_importacao.count({ where: { lote_id: loteId, severidade: "ERRO" } });
  if (erros > 0) throw new ErroDeNegocio(`O lote tem ${erros} erro(s) de validação e não pode ser gravado.`);
  const metadados = (lote.metadados ?? {}) as Record<string, unknown>;
  const emissao = typeof metadados.data_emissao === "string" ? new Date(metadados.data_emissao) : null;

  try {
    const r = await prisma.$transaction(
      async (tx) => {
        // Trava o lote: impede confirmação dupla simultânea.
        const travado = await tx.$queryRawUnsafe<Array<{ status: string }>>(`SELECT status FROM lotes_importacao WHERE id = $1::uuid FOR UPDATE`, loteId);
        if (travado[0]?.status !== "ANALISADO") throw new ErroDeNegocio("O lote já foi processado por outra operação.");
        const g = await gravarRevisaoBase(tx, {
          loteId, fonteId: lote.fonte_id, uf: lote.uf, competencia: lote.competencia, regimes: lote.regimes,
          rotulo: lote.rotulo_revisao, dataEmissao: emissao, falharApos: opcoes.falharApos,
        });
        const contagens = { ...((lote.contagens ?? {}) as Record<string, number>), ...g.contagens };
        await tx.lotes_importacao.update({
          where: { id: loteId },
          data: { status: "IMPORTADO", revisao_base_id: g.revisaoBaseId, concluido_em: new Date(), contagens },
        });
        await limparStaging(loteId, tx);
        await auditar({ usuarioId, acao: "IMPORTACAO_GRAVADA", entidade: "revisoes_base", entidadeId: g.revisaoBaseId, dados: { lote: loteId, numero: g.numero, contagens }, ip: opcoes.ip }, tx);
        return g;
      },
      { timeout: TIMEOUT_TRANSACAO_MS, maxWait: 30_000 },
    );
    await compactarStaging();
    return { revisaoBaseId: r.revisaoBaseId };
  } catch (e) {
    // A transação foi desfeita. O staging continua disponível para nova tentativa.
    const msg = e instanceof Error ? e.message : String(e);
    if (!(e instanceof ErroDeNegocio)) {
      await prisma.lotes_importacao.update({ where: { id: loteId }, data: { erro: `Falha na gravação (nada foi gravado): ${msg}`.slice(0, 4000) } });
    }
    await auditar({ usuarioId, acao: "IMPORTACAO_GRAVACAO_FALHOU", entidade: "lotes_importacao", entidadeId: loteId, dados: { erro: msg.slice(0, 1000) }, ip: opcoes.ip });
    throw e;
  }
}

/** Sem lotes pendentes, TRUNCATE devolve ao disco o espaço do staging (importante no plano gratuito). */
async function compactarStaging(): Promise<void> {
  const pendentes = await prisma.lotes_importacao.count({ where: { status: { in: ["RECEBIDO", "ANALISADO"] } } });
  if (pendentes === 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE stg_itens, stg_precos, stg_componentes, stg_composicoes, stg_atributos, stg_manutencoes`);
  }
}

export async function cancelarImportacao(loteId: string, usuarioId: string | null): Promise<void> {
  const lote = await prisma.lotes_importacao.findUniqueOrThrow({ where: { id: loteId } });
  if (lote.status !== "ANALISADO" && lote.status !== "RECEBIDO") throw new ErroDeNegocio("Somente lotes ainda não gravados podem ser cancelados.");
  await limparStaging(loteId);
  await prisma.lotes_importacao.update({ where: { id: loteId }, data: { status: "CANCELADO", concluido_em: new Date() } });
  await auditar({ usuarioId, acao: "IMPORTACAO_CANCELADA", entidade: "lotes_importacao", entidadeId: loteId });
  await compactarStaging();
}

/** Publica a revisão: passa a ser a vigente para novos orçamentos; a anterior vira SUBSTITUIDA. */
export async function publicarRevisaoBase(revisaoId: string, usuarioId: string | null, ip?: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rev = await tx.revisoes_base.findUniqueOrThrow({ where: { id: revisaoId } });
    if (rev.status !== "VALIDADA") throw new ErroDeNegocio(`Somente revisões validadas podem ser publicadas (situação: ${rev.status}).`);
    const anteriores = await tx.revisoes_base.findMany({ where: { base_id: rev.base_id, status: "PUBLICADA" } });
    for (const a of anteriores) {
      if (a.numero > rev.numero) throw new ErroDeNegocio(`Já há uma revisão mais nova publicada (${a.rotulo}).`);
      await tx.revisoes_base.update({ where: { id: a.id }, data: { status: "SUBSTITUIDA", substituida_em: new Date() } });
    }
    await tx.revisoes_base.update({ where: { id: revisaoId }, data: { status: "PUBLICADA", publicada_em: new Date(), publicada_por: usuarioId } });
    await auditar({ usuarioId, acao: "BASE_PUBLICADA", entidade: "revisoes_base", entidadeId: revisaoId, dados: { substituidas: anteriores.map((a) => a.id) }, ip }, tx);
  });
}

export async function rejeitarRevisaoBase(revisaoId: string, motivo: string, usuarioId: string | null, ip?: string | null): Promise<void> {
  if (!motivo.trim()) throw new ErroDeNegocio("Informe o motivo da rejeição.");
  await prisma.$transaction(async (tx) => {
    const rev = await tx.revisoes_base.findUniqueOrThrow({ where: { id: revisaoId } });
    if (rev.status !== "VALIDADA") throw new ErroDeNegocio("Somente revisões ainda não publicadas podem ser rejeitadas.");
    await tx.revisoes_base.update({ where: { id: revisaoId }, data: { status: "REJEITADA", rejeitada_em: new Date(), motivo_rejeicao: motivo.trim() } });
    // Libera espaço: dados de uma revisão rejeitada não serão usados (o lote e o relatório permanecem).
    await tx.precos_referencia.deleteMany({ where: { revisao_base_id: revisaoId } });
    await tx.composicoes_publicadas.deleteMany({ where: { revisao_base_id: revisaoId } });
    await tx.manutencoes_sinapi.deleteMany({ where: { revisao_base_id: revisaoId } });
    await tx.$executeRawUnsafe(
      `DELETE FROM composicoes c WHERE c.primeira_revisao_base_id = $1::uuid
         AND NOT EXISTS (SELECT 1 FROM composicoes_publicadas p WHERE p.composicao_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM itens_orcamento i WHERE i.composicao_id = c.id)`,
      revisaoId,
    );
    await auditar({ usuarioId, acao: "BASE_REJEITADA", entidade: "revisoes_base", entidadeId: revisaoId, dados: { motivo }, ip }, tx);
  });
}

import { prisma } from "./db";
import { auditar } from "./auditoria";
import { CODIGOS_PARCELA, NOMES_PARCELA, calcularBdi, type CodigoParcela } from "@/dominio/bdi";
import { D } from "@/dominio/decimal";
import { ErroDeNegocio } from "@/importacao/servico";

export interface DadosPerfilBdi {
  nome: string;
  descricao?: string | null;
  tipoObra?: string | null;
  regime?: string | null;
  percentualAdotado?: string | null;
  fonteDocumento?: string | null;
  parcelas: Array<{ codigo: string; percentual: string }>;
}

/** Cria perfil de BDI. Perfis existentes não são editados (orçamentos guardam cópia congelada). */
export async function criarPerfilBdi(d: DadosPerfilBdi, usuarioId: string | null) {
  if (!d.nome.trim()) throw new ErroDeNegocio("Informe o nome do perfil.");
  const parcelas = d.parcelas.filter((p) => p.percentual.trim() !== "");
  for (const p of parcelas) if (!CODIGOS_PARCELA.includes(p.codigo as CodigoParcela)) throw new ErroDeNegocio(`Parcela inválida: ${p.codigo}`);
  const calc = calcularBdi(parcelas.map((p) => ({ codigo: p.codigo as CodigoParcela, percentual: p.percentual })));
  const adotado = d.percentualAdotado?.trim() ? D(d.percentualAdotado) : calc.percentual2casas;
  if (await prisma.perfis_bdi.findUnique({ where: { nome: d.nome.trim() } })) throw new ErroDeNegocio("Já existe perfil com este nome.");
  const p = await prisma.perfis_bdi.create({
    data: {
      nome: d.nome.trim(), descricao: d.descricao?.trim() || null, tipo_obra: d.tipoObra?.trim() || null, regime_codigo: d.regime || null,
      percentual_adotado: adotado.toString(), fonte_documento: d.fonteDocumento?.trim() || null, criado_por: usuarioId,
      parcelas_bdi: { create: parcelas.map((x, i) => ({ codigo: x.codigo, nome: NOMES_PARCELA[x.codigo as CodigoParcela], percentual: D(x.percentual).toString(), ordem: i + 1 })) },
    },
  });
  await auditar({ usuarioId, acao: "PERFIL_BDI_CRIADO", entidade: "perfis_bdi", entidadeId: p.id, dados: { nome: p.nome, calculado: calc.percentual.toString(), adotado: adotado.toString() } });
  return p;
}

export async function alternarPerfilBdi(id: string, ativo: boolean, usuarioId: string | null) {
  await prisma.perfis_bdi.update({ where: { id }, data: { ativo, atualizado_em: new Date() } });
  await auditar({ usuarioId, acao: ativo ? "PERFIL_BDI_ATIVADO" : "PERFIL_BDI_DESATIVADO", entidade: "perfis_bdi", entidadeId: id });
}

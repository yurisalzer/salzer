import { prisma } from "./db";
import { auditar } from "./auditoria";
import { conferirSenha, gerarHashSenha, validarForcaSenha } from "./senha";
import { PAPEIS } from "./permissoes";
import { ErroDeNegocio } from "@/importacao/servico";

export async function criarUsuario(d: { nome: string; email: string; papel: string; senha: string }, adminId: string) {
  const email = d.email.trim().toLowerCase();
  if (!d.nome.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErroDeNegocio("Informe nome e e-mail válidos.");
  if (!PAPEIS[d.papel]) throw new ErroDeNegocio("Papel inválido.");
  const erro = validarForcaSenha(d.senha);
  if (erro) throw new ErroDeNegocio(erro);
  if (await prisma.usuarios.findUnique({ where: { email } })) throw new ErroDeNegocio("Já existe usuário com este e-mail.");
  const papel = await prisma.papeis.findUniqueOrThrow({ where: { codigo: d.papel } });
  const u = await prisma.usuarios.create({ data: { nome: d.nome.trim(), email, senha_hash: await gerarHashSenha(d.senha), usuarios_papeis: { create: { papel_id: papel.id } } } });
  await auditar({ usuarioId: adminId, acao: "USUARIO_CRIADO", entidade: "usuarios", entidadeId: u.id, dados: { email, papel: d.papel } });
  return u;
}

export async function definirPapel(usuarioId: string, papelCodigo: string, adminId: string) {
  if (!PAPEIS[papelCodigo]) throw new ErroDeNegocio("Papel inválido.");
  if (usuarioId === adminId && papelCodigo !== "ADMINISTRADOR") throw new ErroDeNegocio("Você não pode retirar o próprio papel de administrador.");
  const papel = await prisma.papeis.findUniqueOrThrow({ where: { codigo: papelCodigo } });
  await prisma.$transaction([
    prisma.usuarios_papeis.deleteMany({ where: { usuario_id: usuarioId } }),
    prisma.usuarios_papeis.create({ data: { usuario_id: usuarioId, papel_id: papel.id } }),
  ]);
  await auditar({ usuarioId: adminId, acao: "PAPEL_ALTERADO", entidade: "usuarios", entidadeId: usuarioId, dados: { papel: papelCodigo } });
}

export async function definirAtivo(usuarioId: string, ativo: boolean, adminId: string) {
  if (usuarioId === adminId && !ativo) throw new ErroDeNegocio("Você não pode desativar o próprio usuário.");
  await prisma.usuarios.update({ where: { id: usuarioId }, data: { ativo, tentativas_falhas: 0, bloqueado_ate: null } });
  if (!ativo) await prisma.sessoes.deleteMany({ where: { usuario_id: usuarioId } });
  await auditar({ usuarioId: adminId, acao: ativo ? "USUARIO_ATIVADO" : "USUARIO_DESATIVADO", entidade: "usuarios", entidadeId: usuarioId });
}

export async function redefinirSenha(usuarioId: string, senha: string, adminId: string) {
  const erro = validarForcaSenha(senha);
  if (erro) throw new ErroDeNegocio(erro);
  await prisma.usuarios.update({ where: { id: usuarioId }, data: { senha_hash: await gerarHashSenha(senha), senha_alterada_em: new Date(), tentativas_falhas: 0, bloqueado_ate: null } });
  await prisma.sessoes.deleteMany({ where: { usuario_id: usuarioId } });
  await auditar({ usuarioId: adminId, acao: "SENHA_REDEFINIDA", entidade: "usuarios", entidadeId: usuarioId });
}

export async function trocarPropriaSenha(usuarioId: string, atual: string, nova: string, sessaoAtualId: string) {
  const u = await prisma.usuarios.findUniqueOrThrow({ where: { id: usuarioId } });
  if (!(await conferirSenha(u.senha_hash, atual))) throw new ErroDeNegocio("Senha atual incorreta.");
  const erro = validarForcaSenha(nova);
  if (erro) throw new ErroDeNegocio(erro);
  await prisma.usuarios.update({ where: { id: usuarioId }, data: { senha_hash: await gerarHashSenha(nova), senha_alterada_em: new Date() } });
  // Encerra as outras sessões (mantém a atual)
  await prisma.sessoes.deleteMany({ where: { usuario_id: usuarioId, id: { not: sessaoAtualId } } });
  await auditar({ usuarioId, acao: "SENHA_ALTERADA", entidade: "usuarios", entidadeId: usuarioId });
}

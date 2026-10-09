import { prisma } from "@/servidor/db";
import { exigirUsuario } from "@/servidor/sessao";
import { PAPEIS } from "@/servidor/permissoes";
import { formatarDataHora } from "@/dominio/formato";
import { FormAcao } from "@/componentes/form-acao";
import { BotaoAcao } from "@/componentes/botao-acao";
import { acaoAtivo, acaoCriarUsuario, acaoPapel, acaoRedefinirSenha } from "../acoes";

export const dynamic = "force-dynamic";

export default async function Usuarios() {
  const eu = await exigirUsuario("usuarios.gerenciar");
  const usuarios = await prisma.usuarios.findMany({ include: { usuarios_papeis: { include: { papeis: true } } }, orderBy: { nome: "asc" } });
  return (
    <div className="space-y-4">
      <h1 className="titulo-pagina">Usuários e permissões</h1>
      <section className="cartao overflow-x-auto">
        <table className="tabela">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Último acesso</th><th>Redefinir senha</th></tr></thead>
          <tbody>
            {usuarios.map((u) => {
              const papel = u.usuarios_papeis[0]?.papeis.codigo ?? "";
              return (
                <tr key={u.id} className={u.ativo ? "" : "text-slate-400"}>
                  <td>{u.nome}</td>
                  <td>{u.email}</td>
                  <td>
                    <FormAcao acao={acaoPapel} campos={{ usuarioId: u.id }} enviarAoAlterar>
                      <select name="papel" defaultValue={papel} className="rounded border border-slate-200 text-sm" disabled={u.id === eu.id}>
                        {Object.entries(PAPEIS).map(([k, p]) => <option key={k} value={k}>{p.nome}</option>)}
                      </select>
                    </FormAcao>
                  </td>
                  <td>
                    {u.ativo ? "Ativo" : "Inativo"}{u.bloqueado_ate && u.bloqueado_ate > new Date() ? " (bloqueado)" : ""}{" "}
                    {u.id !== eu.id && <BotaoAcao acao={acaoAtivo} campos={{ usuarioId: u.id, ativo: u.ativo ? "0" : "1" }} rotulo={u.ativo ? "desativar" : "ativar"} classe="btn-link text-xs" />}
                  </td>
                  <td className="text-xs">{formatarDataHora(u.ultimo_login_em)}</td>
                  <td>
                    <FormAcao acao={acaoRedefinirSenha} campos={{ usuarioId: u.id }} className="flex gap-1">
                      <input name="senha" type="password" className="campo w-40" placeholder="nova senha" autoComplete="new-password" required minLength={10} />
                      <button className="btn-secundario text-xs">ok</button>
                    </FormAcao>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="cartao">
        <h2 className="mb-3 font-semibold">Novo usuário</h2>
        <FormAcao acao={acaoCriarUsuario} className="grid gap-3 md:grid-cols-5">
          <div><label className="rotulo">Nome</label><input name="nome" className="campo" required /></div>
          <div><label className="rotulo">E-mail</label><input name="email" type="email" className="campo" required /></div>
          <div><label className="rotulo">Papel</label><select name="papel" className="campo" defaultValue="ORCAMENTISTA">{Object.entries(PAPEIS).map(([k, p]) => <option key={k} value={k}>{p.nome}</option>)}</select></div>
          <div><label className="rotulo">Senha inicial</label><input name="senha" type="password" className="campo" required minLength={10} autoComplete="new-password" /></div>
          <div className="flex items-end"><button className="btn-primario">Criar</button></div>
        </FormAcao>
        <ul className="mt-3 text-xs text-slate-500">{Object.values(PAPEIS).map((p) => <li key={p.nome}><strong>{p.nome}:</strong> {p.descricao}</li>)}</ul>
      </section>
    </div>
  );
}

import { exigirUsuario } from "@/servidor/sessao";
import { FormAcao } from "@/componentes/form-acao";
import { acaoTrocarSenha } from "../admin/acoes";

export default async function Conta() {
  const u = await exigirUsuario();
  return (
    <div className="max-w-md space-y-4">
      <h1 className="titulo-pagina">Minha conta</h1>
      <p className="text-sm text-slate-600">{u.nome} — {u.email}</p>
      <FormAcao acao={acaoTrocarSenha} className="cartao space-y-3">
        <div><label className="rotulo">Senha atual</label><input name="atual" type="password" className="campo" required autoComplete="current-password" /></div>
        <div><label className="rotulo">Nova senha (mín. 10 caracteres, letras e números)</label><input name="nova" type="password" className="campo" required minLength={10} autoComplete="new-password" /></div>
        <div><label className="rotulo">Confirmação</label><input name="confirmacao" type="password" className="campo" required autoComplete="new-password" /></div>
        <button className="btn-primario">Alterar senha</button>
      </FormAcao>
    </div>
  );
}

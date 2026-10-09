"use client";

import { useActionState } from "react";
import { acaoEntrar, type EstadoLogin } from "../acoes-sessao";

export function FormularioLogin() {
  const [estado, acao, pendente] = useActionState<EstadoLogin, FormData>(acaoEntrar, {});
  return (
    <form action={acao} className="space-y-4">
      <div>
        <label className="rotulo" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="campo" defaultValue={estado.email} key={estado.email} />
      </div>
      <div>
        <label className="rotulo" htmlFor="senha">Senha</label>
        <input id="senha" name="senha" type="password" autoComplete="current-password" required className="campo" />
      </div>
      {estado.erro && <p className="alerta-erro" role="alert">{estado.erro}</p>}
      <button type="submit" className="btn-primario w-full" disabled={pendente}>{pendente ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}

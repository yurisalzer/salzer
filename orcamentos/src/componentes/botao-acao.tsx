"use client";

import { useActionState } from "react";

export interface EstadoAcao {
  erro?: string;
  ok?: string;
}

/** Formulário com um botão que executa uma Server Action e mostra o resultado. */
export function BotaoAcao({
  acao, rotulo, rotuloPendente, classe = "btn-primario", campos = {}, confirmar, children, desabilitado,
}: {
  acao: (estado: EstadoAcao, form: FormData) => Promise<EstadoAcao>;
  rotulo: string;
  rotuloPendente?: string;
  classe?: string;
  campos?: Record<string, string | number>;
  confirmar?: string;
  children?: React.ReactNode;
  desabilitado?: boolean;
}) {
  const [estado, executar, pendente] = useActionState(acao, {});
  return (
    <form
      action={executar}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
      className="inline-flex flex-col gap-1"
    >
      {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      {children}
      <button type="submit" className={classe} disabled={pendente || desabilitado}>{pendente ? rotuloPendente ?? "Aguarde…" : rotulo}</button>
      {estado.erro && <span className="max-w-md text-xs text-red-700">{estado.erro}</span>}
      {estado.ok && <span className="max-w-md text-xs text-emerald-700">{estado.ok}</span>}
    </form>
  );
}

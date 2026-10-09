"use client";

import { useActionState, useRef } from "react";
import type { EstadoAcao } from "./botao-acao";

/**
 * Formulário genérico ligado a uma Server Action, com mensagem de erro/sucesso.
 * `enviarAoAlterar`: envia sozinho quando um campo muda (ex.: seleção de BDI do item).
 */
export function FormAcao({
  acao, campos = {}, children, className = "", enviarAoAlterar = false, confirmar, id,
}: {
  id?: string;
  acao: (e: EstadoAcao, f: FormData) => Promise<EstadoAcao>;
  campos?: Record<string, string | number>;
  children: React.ReactNode;
  className?: string;
  enviarAoAlterar?: boolean;
  confirmar?: string;
}) {
  const [estado, executar, pendente] = useActionState(acao, {});
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      id={id}
      action={executar}
      className={`${className} ${pendente ? "opacity-60" : ""}`}
      onChange={enviarAoAlterar ? () => ref.current?.requestSubmit() : undefined}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
    >
      {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      {children}
      {estado.erro && <span className="block text-xs text-red-700" role="alert">{estado.erro}</span>}
      {estado.ok && <span className="block text-xs text-emerald-700">{estado.ok}</span>}
    </form>
  );
}

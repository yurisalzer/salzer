import { redirect } from "next/navigation";
import { usuarioAtual } from "@/servidor/sessao";
import { FormularioLogin } from "./formulario";

export default async function PaginaLogin() {
  if (await usuarioAtual()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="cartao w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold text-marca-800">Orçamentos de Obras</h1>
        <p className="mb-6 text-sm text-slate-500">Bases EMOP-RJ e SINAPI</p>
        <FormularioLogin />
      </div>
    </main>
  );
}

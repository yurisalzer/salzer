import Link from "next/link";

export default function SemPermissao() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="cartao max-w-md text-center">
        <h1 className="mb-2 text-lg font-semibold">Acesso não permitido</h1>
        <p className="mb-4 text-sm text-slate-600">Seu usuário não tem permissão para acessar esta página. Fale com o administrador.</p>
        <Link href="/" className="btn-secundario">Voltar ao início</Link>
      </div>
    </main>
  );
}

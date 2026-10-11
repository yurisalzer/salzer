import { NextResponse, type NextRequest } from "next/server";

const PUBLICAS = ["/login"];

// Filtro rápido: sem cookie de sessão → tela de login. A validação real da sessão
// (no banco) acontece no servidor, em cada página e ação.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICAS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("orc_sessao")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// As rotas /api ficam fora do middleware: cada uma valida a sessão (autorizarApi) e assim o
// upload de arquivos grandes não passa pelo limite de corpo de requisição do middleware.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"] };

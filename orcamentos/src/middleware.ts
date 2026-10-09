import { NextResponse, type NextRequest } from "next/server";

const PUBLICAS = ["/login", "/api/saude"];

// Filtro rápido: sem cookie de sessão → tela de login. A validação real da sessão
// (no banco) acontece no servidor, em cada página e ação.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICAS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("orc_sessao")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

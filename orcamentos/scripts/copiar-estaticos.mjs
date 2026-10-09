// O modo "standalone" do Next.js não copia os arquivos estáticos; este passo completa o pacote.
import { cpSync, existsSync } from "node:fs";
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
console.log("Arquivos estáticos copiados para .next/standalone");

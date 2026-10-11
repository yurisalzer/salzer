import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orçamentos de Obras — EMOP e SINAPI",
  description: "Elaboração de orçamentos de obras com bases EMOP-RJ e SINAPI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

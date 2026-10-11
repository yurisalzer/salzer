import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Bibliotecas com binários nativos ou WebAssembly ficam fora do bundle do servidor.
  serverExternalPackages: ["@node-rs/argon2", "node-unrar-js", "pdfmake", "exceljs"],
  // Arquivos carregados em tempo de execução que o rastreamento automático não detecta
  outputFileTracingIncludes: {
    "/api/importacoes": ["./node_modules/node-unrar-js/dist/js/unrar.wasm"],
    "/api/relatorios/[tipo]": ["./node_modules/pdfmake/build/vfs_fonts.js", "./node_modules/generator-function/**", "./node_modules/async-function/**"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;

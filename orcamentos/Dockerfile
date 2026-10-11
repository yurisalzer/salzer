# Imagem de produção (Render, Google Cloud Run, Koyeb ou qualquer servidor com Docker).
# Construção: docker build -t orcamentos .
ARG IMAGEM_NODE=node:22-bookworm-slim
FROM ${IMAGEM_NODE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencias
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS construcao
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build && node scripts/copiar-estaticos.mjs

FROM base AS execucao
# Heap limitado: importação completa EMOP + SINAPI medida com pico de ~360 MB de memória total
# (cabe no plano gratuito de 512 MB).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_TMP_DIR=/tmp/orcamentos-upload \
    NODE_OPTIONS=--max-old-space-size=256
# CLI do Prisma apenas para aplicar migrações na inicialização
RUN npm install --no-save --no-audit --no-fund prisma@6.19.3 && npm cache clean --force
COPY --from=construcao /app/.next/standalone ./
COPY --from=construcao /app/prisma ./prisma
COPY scripts/iniciar.sh ./scripts/iniciar.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/iniciar.sh"]

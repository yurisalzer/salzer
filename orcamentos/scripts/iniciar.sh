#!/bin/sh
# Inicialização em produção: aplica migrações pendentes (idempotente) e sobe o servidor.
set -e
if [ -z "$DATABASE_URL" ]; then
  echo "ERRO: variável DATABASE_URL não configurada." >&2
  exit 1
fi
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
echo "Aplicando migrações do banco..."
./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
echo "Iniciando servidor na porta ${PORT:-3000}"
exec node server.js

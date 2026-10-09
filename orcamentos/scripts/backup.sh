#!/usr/bin/env bash
# Backup completo do banco (formato custom do pg_dump), cifrado com AES-256 (gpg).
# Uso: DATABASE_URL=... BACKUP_SENHA=... bash scripts/backup.sh [diretorio]
set -euo pipefail
DESTINO="${1:-backups}"
: "${DATABASE_URL:?Defina DATABASE_URL (conexão direta, sem -pooler)}"
: "${BACKUP_SENHA:?Defina BACKUP_SENHA}"
PG_DUMP="${PG_DUMP:-pg_dump}"
mkdir -p "$DESTINO"
ARQ="$DESTINO/orcamentos-$(date -u +%Y%m%d-%H%M%S).dump"
# Tabelas de staging (temporárias) ficam de fora; o restante, completo.
"$PG_DUMP" --format=custom --no-owner --no-privileges \
  --exclude-table-data='stg_*' --file="$ARQ" "$DATABASE_URL"
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_SENHA" \
  --symmetric --cipher-algo AES256 --output "$ARQ.gpg" "$ARQ"
rm -f "$ARQ"
sha256sum "$ARQ.gpg"
echo "Backup gerado: $ARQ.gpg"

#!/usr/bin/env bash
# Restaura um backup cifrado em um banco VAZIO (ex.: um novo branch/projeto do Neon).
# Uso: DATABASE_URL=... BACKUP_SENHA=... bash scripts/restaurar.sh arquivo.dump.gpg
# Nunca restaure por cima do banco em uso: crie um banco novo, confira e só então troque a conexão.
set -euo pipefail
ARQ="${1:?Informe o arquivo .dump.gpg}"
: "${DATABASE_URL:?Defina DATABASE_URL do banco de DESTINO (vazio)}"
: "${BACKUP_SENHA:?Defina BACKUP_SENHA}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_SENHA" --decrypt --output "$TMP" "$ARQ"
"$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname="$DATABASE_URL" "$TMP"
echo "Restauração concluída. Confira: tabelas, contagens e login antes de usar."

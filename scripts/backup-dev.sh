#!/usr/bin/env bash
# Encrypted backup of the DEVELOPMENT database only: the `budget` database of the
# dev compose `mariadb` container, with the dev credentials. For a production
# install, follow docs/self-hosting.md#backup-and-restore instead.
#
# Encrypts the dump stream with AES-256 (openssl, PBKDF2) into
# backups/bilan-dev-<timestamp>.sql.enc. Nothing plaintext ever touches disk.
#
# Usage:
#   BACKUP_PASSPHRASE='…' npm run db:backup-dev
#
# Restore (decrypt → pipe back into the DB):
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE \
#     -in backups/bilan-dev-<timestamp>.sql.enc \
#     | docker compose exec -T mariadb mariadb -uapp -papp_password budget
set -euo pipefail

if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "error: BACKUP_PASSPHRASE is not set — refusing to write an unencrypted backup." >&2
  exit 1
fi

mkdir -p backups
out="backups/bilan-dev-$(date +%F-%H%M).sql.enc"

docker compose exec -T mariadb mariadb-dump -uapp -papp_password budget \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE \
  > "$out"

echo "wrote $out ($(du -h "$out" | cut -f1))"

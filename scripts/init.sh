#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

KEYRING_DIR="docker/mariadb/keyring"
KEYRING_FILE="$KEYRING_DIR/keyfile"

gen_secret() { openssl rand -base64 32; }

# 1. Generate .env from .env.example with random secrets if missing.
if [[ ! -f .env ]]; then
  echo "==> Generating .env from .env.example"
  cp .env.example .env
  for key in AUTH_SECRET DATA_ENCRYPTION_KEY SEARCH_TOKEN_KEY; do
    secret="$(gen_secret)"
    # Replace "KEY=...optional comment" with "KEY=<secret>", preserving nothing after.
    sed -i "s|^${key}=.*|${key}=${secret}|" .env
  done
else
  echo "==> .env already exists, keeping it"
fi

# 2. Generate the MariaDB keyring file if missing.
if [[ ! -f "$KEYRING_FILE" ]]; then
  echo "==> Generating MariaDB keyring"
  mkdir -p "$KEYRING_DIR"
  echo "1;$(openssl rand -hex 32)" > "$KEYRING_FILE"
  # Readable by the mysql user (uid 999) inside the container; local dev only, gitignored.
  chmod 644 "$KEYRING_FILE"
else
  echo "==> MariaDB keyring already exists, keeping it"
fi

# 3. Start the database containers and wait for health.
echo "==> Starting mariadb + mariadb-test"
docker compose up -d mariadb mariadb-test

echo "==> Waiting for mariadb to be healthy"
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q mariadb)" 2>/dev/null || echo "starting")"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done

# 4. Run migrations and seed (only once Prisma exists — added in scope 0.3).
if [[ -f prisma/schema.prisma ]]; then
  echo "==> Running prisma migrate deploy + seed"
  npx prisma migrate deploy
  npx prisma db seed
else
  echo "==> No prisma/schema.prisma yet — skipping migrate/seed (added in scope 0.3)"
fi

echo "==> Setup complete. Run 'npm run dev'."

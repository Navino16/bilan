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

# Prisma Migrate creates a shadow database next to the target DB; the default
# MARIADB_USER only has rights on its own database, so grant it global perms in dev.
echo "==> Granting migration privileges to 'app' user"
for svc in mariadb mariadb-test; do
  docker compose exec -T "$svc" mariadb -uroot -proot_password \
    -e "GRANT ALL PRIVILEGES ON *.* TO 'app'@'%'; FLUSH PRIVILEGES;" 2>/dev/null || true
done

# 4. Run migrations and seed.
echo "==> Running prisma migrate deploy on budget"
npx prisma migrate deploy

echo "==> Running prisma migrate deploy on budget_test"
DATABASE_URL="mysql://app:app_password@localhost:3307/budget_test" \
  npx prisma migrate deploy

echo "==> Running prisma db seed on budget"
npx prisma db seed

echo "==> Setup complete. Run 'npm run dev'."

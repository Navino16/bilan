#!/usr/bin/env bash
# Rebuilds `budget_docs`, the clean data set of the docs screenshots: see docs/development.md.
set -euo pipefail
DB=budget_docs

[ -f .env ] || { echo "No .env: run npm run setup first." >&2; exit 1; }
docker compose ps --status running mariadb-test | grep -q mariadb-test ||
  { echo "Start the test database first: docker compose up -d mariadb-test" >&2; exit 1; }

docker compose exec -T mariadb-test sh -c \
  "mariadb -uroot -p\"\$MARIADB_ROOT_PASSWORD\" -e 'DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB; GRANT ALL ON $DB.* TO \`app\`@\`%\`;'"

set -a
. ./.env
set +a
export DATABASE_URL="mysql://app:app_password@localhost:3307/$DB"

npx prisma migrate deploy
NODE_ENV=test npx tsx scripts/seed-e2e.ts
npx tsx scripts/seed-dev-user.ts

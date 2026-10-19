#!/usr/bin/env bash
# Rebuilds `budget_docs` on the dev compose `mariadb-test` container: the clean data set
# the docs screenshots are taken on (e2e users + the dev@bilan.local demo account).
#
# Usage:
#   npm run docs:db
#   # serve a production build with DATABASE_URL=mysql://app:app_password@localhost:3307/budget_docs, then
#   DOCS_BASE_URL=http://localhost:<port> npm run docs:screenshots
set -euo pipefail
DB=budget_docs

docker compose exec -T mariadb-test sh -c \
  "mariadb -uroot -p\"\$MARIADB_ROOT_PASSWORD\" -e 'DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB; GRANT ALL ON $DB.* TO \`app\`@\`%\`;'"

set -a
. ./.env
set +a
export DATABASE_URL="mysql://app:app_password@localhost:3307/$DB"

npx prisma migrate deploy
NODE_ENV=test npx tsx scripts/seed-e2e.ts
npx tsx scripts/seed-dev-user.ts

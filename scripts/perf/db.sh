#!/usr/bin/env bash
# Rebuilds `budget_perf`, the synthetic data set of the performance benchmark: see docs/development.md.
# Usage: scripts/perf/db.sh [realistic|stress]... (default: both)
set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/perf/env.sh

DB=budget_perf
PROFILES=("$@")
[ ${#PROFILES[@]} -gt 0 ] || PROFILES=(realistic stress)

docker compose ps --status running mariadb-test | grep -q mariadb-test ||
  { echo "Start the test database first: docker compose up -d mariadb-test" >&2; exit 1; }

docker compose exec -T mariadb-test sh -c \
  "mariadb -uroot -p\"\$MARIADB_ROOT_PASSWORD\" -e 'DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB; GRANT ALL ON $DB.* TO \`app\`@\`%\`;'"

set -a
. "$PERF_ENV"
set +a
npx prisma migrate deploy
for profile in "${PROFILES[@]}"; do
  NODE_ENV=development npx tsx scripts/perf/seed-perf.ts "$profile"
done

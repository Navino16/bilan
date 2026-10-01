#!/usr/bin/env bash
# End-to-end check of the prod image and compose (spec §9). Own project, env file and
# port, so it can run next to a dev stack.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT=3100
BASE="http://localhost:$PORT"
ENV_FILE="$(mktemp)"
KEYFILE="docker/mariadb/keyring/keyfile"
secret() { openssl rand -base64 32; }
CRON_SECRET="$(secret)"
DB_PASSWORD="$(openssl rand -hex 16)"

cat >"$ENV_FILE" <<EOF
BILAN_VERSION=smoke
BILAN_PORT=$PORT
BILAN_ENV_FILE=$ENV_FILE
APP_URL=$BASE
AUTH_SECRET=$(secret)
DATA_ENCRYPTION_KEY=$(secret)
SEARCH_TOKEN_KEY=$(secret)
CRON_SECRET=$CRON_SECRET
MARIADB_PASSWORD=$DB_PASSWORD
MARIADB_ROOT_PASSWORD=$(openssl rand -hex 16)
EOF

if [[ ! -f "$KEYFILE" ]]; then
  mkdir -p "$(dirname "$KEYFILE")"
  echo "1;$(openssl rand -hex 32)" >"$KEYFILE"
  chmod 644 "$KEYFILE"
fi

dc() { docker compose -p bilan-smoke --env-file "$ENV_FILE" -f docker-compose.prod.yml "$@"; }
fail() {
  echo "FAIL: $*" >&2
  exit 1
}
cleanup() {
  local code=$?
  if [[ $code -ne 0 ]]; then dc logs --no-color --tail 200 || true; fi
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  exit "$code"
}
trap cleanup EXIT

echo "==> compose config"
dc config -q

echo "==> build and boot"
dc up -d --build --wait --wait-timeout 300

echo "==> a fresh install lands on the setup page"
final="$(curl -fsS -L -o /dev/null -w '%{http_code} %{url_effective}' "$BASE/fr/login")"
[[ "$final" == "200 "*"/fr/setup" ]] || fail "expected 200 on /fr/setup, got: $final"

echo "==> the cron route accepts the secret"
res="$(curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" -w $'\n%{http_code}' "$BASE/api/cron/purge-imports")"
[[ "${res##*$'\n'}" == 200 && "${res%$'\n'*}" == *'"purged"'* ]] || fail "purge-imports with the secret: $res"

echo "==> the cron route rejects a wrong secret"
code="$(curl -sS -o /dev/null -X POST -H "Authorization: Bearer wrong" -w '%{http_code}' "$BASE/api/cron/purge-imports")"
[[ "$code" == 401 ]] || fail "purge-imports with a wrong secret: $code"

echo "==> a second boot keeps the data and an admin-changed setting"
sql() { dc exec -T mariadb mariadb -ubilan -p"$DB_PASSWORD" bilan -N -e "$1"; }
sql "UPDATE AppSetting SET value = '\"OPEN\"' WHERE \`key\` = 'registration_mode'"
dc restart app
dc up -d --wait --wait-timeout 180 app
[[ "$(sql "SELECT value FROM AppSetting WHERE \`key\` = 'registration_mode'")" == '"OPEN"' ]] ||
  fail "the seed overwrote registration_mode on restart"
[[ "$(sql "SELECT COUNT(*) FROM Role WHERE \`key\` = 'SUPER_ADMIN'")" == 1 ]] || fail "SUPER_ADMIN role missing"

echo "OK prod smoke"

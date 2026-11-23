#!/usr/bin/env bash
# End-to-end check of the prod image and compose. Runs from a temp directory
# holding only the runtime files (no checkout needed), with its own project and port.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT=3100
BASE="http://localhost:$PORT"
RUN_DIR="$(mktemp -d)"
secret() { openssl rand -base64 32; }
CRON_SECRET="$(secret)"
DB_PASSWORD="$(openssl rand -hex 16)"

cp docker-compose.prod.yml "$RUN_DIR/"
cat >"$RUN_DIR/.env" <<EOF2
BILAN_VERSION=smoke
BILAN_PORT=$PORT
EOF2
cat >"$RUN_DIR/app.env" <<EOF2
APP_URL=$BASE
AUTH_SECRET=$(secret)
DATA_ENCRYPTION_KEY=$(secret)
SEARCH_TOKEN_KEY=$(secret)
CRON_SECRET=$CRON_SECRET
DATABASE_URL=mysql://bilan:$DB_PASSWORD@mariadb:3306/bilan
EOF2
cat >"$RUN_DIR/db.env" <<EOF2
MARIADB_ROOT_PASSWORD=$(openssl rand -hex 16)
MARIADB_PASSWORD=$DB_PASSWORD
EOF2
mkdir "$RUN_DIR/keyring"
echo "1;$(openssl rand -hex 32)" >"$RUN_DIR/keyring/keyfile"
chmod 644 "$RUN_DIR/keyring/keyfile"

dc() { docker compose -p bilan-smoke --project-directory "$RUN_DIR" -f "$RUN_DIR/docker-compose.prod.yml" "$@"; }
fail() {
  echo "FAIL: $*" >&2
  exit 1
}
cleanup() {
  local code=$?
  if [[ $code -ne 0 ]]; then dc logs --no-color --tail 200 || true; fi
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$RUN_DIR"
  exit "$code"
}
trap cleanup EXIT

echo "==> compose config"
dc config -q

echo "==> build the image"
docker build --target prod -t ghcr.io/navino16/bilan:smoke .

echo "==> boot"
dc up -d --wait --wait-timeout 300

echo "==> a fresh install lands on the setup page"
final="$(curl -fsS -L -o /dev/null -w '%{http_code} %{url_effective}' "$BASE/fr/login")"
[[ "$final" == "200 "*"/fr/setup" ]] || fail "expected 200 on /fr/setup, got: $final"

sql() { dc exec -T mariadb mariadb -ubilan -p"$DB_PASSWORD" bilan -N -e "$1"; }

echo "==> the database is encrypted at rest"
[[ "$(sql "SHOW VARIABLES LIKE 'innodb_encrypt_tables'")" == *ON ]] || fail "innodb_encrypt_tables is not ON"

echo "==> the app does not get the MariaDB root password"
if dc exec -T app printenv MARIADB_ROOT_PASSWORD >/dev/null; then fail "MARIADB_ROOT_PASSWORD leaked into app"; fi

echo "==> the cron route accepts the secret"
res="$(curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" -w $'\n%{http_code}' "$BASE/api/cron/purge-imports")"
[[ "${res##*$'\n'}" == 200 && "${res%$'\n'*}" == *'"purged"'* ]] || fail "purge-imports with the secret: $res"

echo "==> the cron route rejects a wrong secret"
code="$(curl -sS -o /dev/null -X POST -H "Authorization: Bearer wrong" -w '%{http_code}' "$BASE/api/cron/purge-imports")"
[[ "$code" == 401 ]] || fail "purge-imports with a wrong secret: $code"

echo "==> a second boot keeps the data and an admin-changed setting"
sql "UPDATE AppSetting SET value = '\"OPEN\"' WHERE \`key\` = 'registration_mode'"
dc restart app
dc up -d --wait --wait-timeout 180 app
[[ "$(sql "SELECT value FROM AppSetting WHERE \`key\` = 'registration_mode'")" == '"OPEN"' ]] ||
  fail "registration_mode not kept on restart (missing or overwritten by the seed)"
[[ "$(sql "SELECT COUNT(*) FROM Role WHERE \`key\` = 'SUPER_ADMIN'")" == 1 ]] || fail "SUPER_ADMIN role missing"

echo "==> the cron service is running and made its start-up call"
dc ps --status running --services | grep -qx cron || fail "cron service not running"
dc logs cron | grep -q "OK purge-imports" || fail "no 'OK purge-imports' in the cron logs"

echo "==> every route of the crontab answers through run.sh"
for route in $(dc exec -T cron sh -c "awk '!/^#/ && NF { print \$8 }' /opt/cron/crontab"); do
  dc exec -T cron sh /opt/cron/run.sh "$route" | grep -q "^OK $route " || fail "run.sh $route failed"
done

echo "==> the cron service exits on an empty secret"
if out="$(dc run --rm --no-deps -e CRON_SECRET= cron 2>&1)"; then
  fail "the cron service started with an empty secret"
fi
grep -q "CRON_SECRET is empty" <<<"$out" || fail "no 'CRON_SECRET is empty' line: $out"

echo "==> the cron service exits on a wrong secret"
if out="$(dc run --rm --no-deps -e CRON_SECRET=wrong cron 2>&1)"; then
  fail "the cron service started with a wrong secret"
fi
grep -q "ERROR purge-imports" <<<"$out" || fail "no 'ERROR purge-imports' line: $out"

echo "OK prod smoke"

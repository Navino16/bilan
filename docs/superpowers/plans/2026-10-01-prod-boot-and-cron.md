# Production boot and scheduled jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose -f docker-compose.prod.yml up -d` on a fresh host gives a migrated, seeded app and a cron sidecar calling the three cron routes, and CI proves it.

**Architecture:** The prod image gets a self-contained migrate + seed toolkit in `/opt/migrate` and an entrypoint that runs `prisma migrate deploy`, the seed, then `node server.js`. A prod compose adds MariaDB (encrypted at rest, no published port) and an `alpine:3` sidecar running busybox `crond` + `wget`. `scripts/prod-smoke.sh` boots the whole stack under its own project name and checks it end to end; a path-filtered workflow runs it on PRs.

**Tech Stack:** Docker (BuildKit, compose v2), alpine/busybox `sh`, bash, Prisma 7.8 CLI, Node 24 type stripping, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-prod-boot-and-cron-design.md`

## Global Constraints

- Nothing in `src/` changes. The `dev` stage of the `Dockerfile` and `docker-compose.yml` stay as they are.
- Scripts that run inside alpine containers (`docker/entrypoint.sh`, `docker/cron/*.sh`) are POSIX `sh` (busybox). `scripts/prod-smoke.sh` is bash (host / GitHub runner).
- Schedules are UTC: `roll-budgets` `5 0 * * *`, `purge-audit` `0 3 * * *`, `purge-imports` `0 * * * *` (spec D7).
- Package versions installed in `/opt/migrate` are read from `package-lock.json`, never hard-coded.
- The cron routes answer 404 when `CRON_SECRET` is unset and 401 on a wrong bearer (existing route code, unchanged).
- Code comments: only to explain complex code or a debatable decision, 1–3 lines, never restating the code, no reasoning or counterfactuals; prefer a spec reference (`spec §7`).
- Run `npx prettier --write` on every hand-written YAML / Markdown / JSON file (`prettier --check .` is part of `npm run lint`).
- Commits: one line, English, conventional (`feat:`, `chore:`, `docs:`, `ci:`), GPG-signed, no co-authored-by. Check the signature with `git log -1 --format='%G? %s'` (rtk prints "ok" even when signing fails).
- Branch: `feature/130-prod-compose-cron` (already created, spec committed on it).

## Review Focus

1. **Second boot of an existing install**: `migrate deploy` is a no-op, the seed re-runs, and a setting an admin changed is kept. Pinned in Task 1 (Step 6: restart after an `UPDATE AppSetting`).
2. **Wrong `CRON_SECRET` in the sidecar**: the container must exit non-zero with an `ERROR purge-imports` line, not idle silently. Pinned in Task 2 (one-off `cron` run with a wrong secret).
3. **Missing `CRON_SECRET`**: compose must refuse the stack instead of starting an inert sidecar. Pinned in Task 2 (`CRON_SECRET= … config` fails).
4. **A crontab line names a route that does not exist** (typo): only noticed at 00:05 or 03:00. Pinned in Task 2 (every route of the crontab is called through `run.sh` inside the running sidecar).
5. **Host files leaking into the image** (`node_modules` built for glibc, `.env`): breaks a local build and copies secrets into a build layer. Pinned in Task 1 (`.dockerignore`, and the smoke build runs from a working copy that has both).

---

### Task 1: The prod image boots on an empty database

**Files:**
- Create: `.dockerignore`
- Create: `docker-compose.prod.yml` (services `mariadb`, `app`)
- Create: `scripts/prod-smoke.sh` (executable)
- Create: `docker/entrypoint.sh` (executable)
- Modify: `Dockerfile` (stage `base`: add `openssl`; new stage `migrator`; stage `prod`: copy toolkit, `ENTRYPOINT`)

**Interfaces:**
- Produces: compose services `mariadb` and `app` (app reachable on `http://app:3000` inside the compose network); compose variables `BILAN_VERSION`, `BILAN_PORT`, `BILAN_ENV_FILE`, `MARIADB_PASSWORD`, `MARIADB_ROOT_PASSWORD`, `CRON_SECRET`; database `bilan`, user `bilan`. `scripts/prod-smoke.sh` defines the bash helpers `dc` (compose with project `bilan-smoke`), `fail`, the variables `BASE`, `ENV_FILE`, `CRON_SECRET`, `DB_PASSWORD`, and ends with `echo "OK prod smoke"`. Task 2 appends checks before that last line.

- [ ] **Step 1: Write `.dockerignore`**

```gitignore
.git
node_modules
.next
.env
.env.*
!.env.example
!.env.prod.example
test-results
.reports
.playwright-mcp
docker/mariadb/keyring
tsconfig.tsbuildinfo
```

- [ ] **Step 2: Write `docker-compose.prod.yml` (mariadb + app)**

```yaml
# Production stack (README "Self-hosting"). Settings come from .env, see .env.prod.example.
name: bilan

services:
  mariadb:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PASSWORD:?set MARIADB_ROOT_PASSWORD in .env}
      MARIADB_DATABASE: bilan
      MARIADB_USER: bilan
      MARIADB_PASSWORD: ${MARIADB_PASSWORD:?set MARIADB_PASSWORD in .env}
    volumes:
      - mariadb_data:/var/lib/mysql
      - ./docker/mariadb/conf.d:/etc/mysql/conf.d:ro
      - ./docker/mariadb/keyring:/etc/mysql/keyring:ro
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 20

  app:
    image: ghcr.io/navino16/bilan:${BILAN_VERSION:-latest}
    build:
      context: .
      target: prod
    restart: unless-stopped
    env_file:
      - ${BILAN_ENV_FILE:-.env}
    environment:
      DATABASE_URL: mysql://bilan:${MARIADB_PASSWORD:?set MARIADB_PASSWORD in .env}@mariadb:3306/bilan
    ports:
      - "${BILAN_PORT:-3000}:3000"
    depends_on:
      mariadb:
        condition: service_healthy
    healthcheck:
      # Fresh install: /fr/login redirects to /fr/setup; either answer needs the database.
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3000/fr/login"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 90s

volumes:
  mariadb_data:
```

- [ ] **Step 3: Write `scripts/prod-smoke.sh` (the failing test)**

```bash
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
```

Then make it executable: `chmod +x scripts/prod-smoke.sh`.

- [ ] **Step 4: Run the smoke test to verify it fails**

Run: `bash scripts/prod-smoke.sh`
Expected: FAIL. The current image builds but runs `node server.js` against an empty database: the `app` healthcheck never passes, so `up --wait` fails, and the printed `app` logs show a Prisma `TableDoesNotExist` / `P2021` error. (If it fails earlier on the build with a native-binding error such as `lightningcss` or `@tailwindcss/oxide`, the `.dockerignore` from Step 1 is missing or wrong.)

- [ ] **Step 5: Write `docker/entrypoint.sh` and change the `Dockerfile`**

`docker/entrypoint.sh` (then `chmod +x docker/entrypoint.sh`):

```sh
#!/bin/sh
# Prod image entrypoint (spec §5): migrate, seed, then hand PID 1 to the server.
set -eu

cd /opt/migrate
echo "bilan: applying database migrations"
node_modules/.bin/prisma migrate deploy
echo "bilan: seeding roles, permissions and default settings"
node prisma/seed.ts

cd /app
exec node server.js
```

`Dockerfile`, stage `base` — replace the `apk add` line:

```dockerfile
RUN apk add --no-cache libc6-compat openssl
```

`Dockerfile`, new stage between `builder` and `prod`:

```dockerfile
# Self-contained migrate + seed toolkit (spec §4): independent of what Next copies
# into the standalone node_modules.
FROM base AS migrator
WORKDIR /opt/migrate
COPY package-lock.json /tmp/package-lock.json
RUN locked() { node -p "require('/tmp/package-lock.json').packages['node_modules/$1'].version"; } \
  && echo '{"private":true,"type":"module"}' > package.json \
  && npm install --no-audit --no-fund \
    "prisma@$(locked prisma)" \
    "dotenv@$(locked dotenv)" \
    "@prisma/client@$(locked @prisma/client)" \
    "@prisma/adapter-mariadb@$(locked @prisma/adapter-mariadb)" \
  && npm cache clean --force
COPY prisma.config.ts ./
COPY prisma/schema.prisma prisma/seed.ts ./prisma/
COPY prisma/migrations ./prisma/migrations
RUN DATABASE_URL=mysql://build:build@localhost:3306/build node_modules/.bin/prisma generate
```

`Dockerfile`, stage `prod` — after the three existing `COPY --from=builder` lines, add:

```dockerfile
COPY --from=migrator --chown=nextjs:nodejs /opt/migrate /opt/migrate
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/bilan-entrypoint
```

and replace the last line `CMD ["node", "server.js"]` with:

```dockerfile
ENTRYPOINT ["bilan-entrypoint"]
```

- [ ] **Step 6: Run the smoke test to verify it passes**

Run: `bash scripts/prod-smoke.sh`
Expected: every `==>` step passes and the last line is `OK prod smoke`. The `app` logs (visible with `docker compose -p bilan-smoke logs app` if you comment out the trap) show `bilan: applying database migrations`, `All migrations have been successfully applied.`, then `bilan: seeding …`.

If the seed step fails in the image:
- `ERR_MODULE_NOT_FOUND` for `@prisma/client` or `.prisma/client`: `prisma generate` did not run in `/opt/migrate` (check the last `RUN` of `migrator`);
- a syntax error on a type annotation: Node is older than 23.6 (the base image must stay `node:24-alpine`).

If `migrate deploy` cannot find a schema engine: `openssl` is missing from `base`, or `npm install` ran without network access to download the musl engine.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write docker-compose.prod.yml
git add .dockerignore Dockerfile docker-compose.prod.yml docker/entrypoint.sh scripts/prod-smoke.sh
git commit -m "feat(docker): migrate and seed on boot of the prod image, with a prod compose and smoke test (#130)"
git log -1 --format='%G? %s'
```

Expected: `G feat(docker): …`. Check the modes went in: `git ls-files -s scripts/prod-smoke.sh docker/entrypoint.sh` shows `100755` for both.

---

### Task 2: Cron sidecar

**Files:**
- Create: `docker/cron/start.sh`
- Create: `docker/cron/run.sh`
- Create: `docker/cron/crontab`
- Modify: `docker-compose.prod.yml` (add service `cron`)
- Modify: `scripts/prod-smoke.sh` (checks before `echo "OK prod smoke"`)

**Interfaces:**
- Consumes: compose service `app` (healthcheck, `http://app:3000`), variable `CRON_SECRET`, smoke helpers `dc`, `fail`, `ENV_FILE`.
- Produces: compose service `cron`; `run.sh <route>` prints `OK <route> <body>` on stdout or `ERROR <route> <wget error>` on stderr and exits 1; `start.sh` exits 1 when `CRON_SECRET` is empty or the first `purge-imports` call fails.

- [ ] **Step 1: Add the sidecar checks to `scripts/prod-smoke.sh`**

Insert before the final `echo "OK prod smoke"`:

```bash
echo "==> compose refuses a missing CRON_SECRET"
if CRON_SECRET= dc config -q 2>/dev/null; then fail "compose accepted an empty CRON_SECRET"; fi

echo "==> the cron sidecar is running and made its start-up call"
dc ps --status running --services | grep -qx cron || fail "cron sidecar not running"
dc logs cron | grep -q "OK purge-imports" || fail "no 'OK purge-imports' in the cron logs"

echo "==> every route of the crontab answers through run.sh"
for route in $(dc exec -T cron sh -c "awk '!/^#/ && NF { print \$8 }' /opt/cron/crontab"); do
  dc exec -T cron sh /opt/cron/run.sh "$route" | grep -q "^OK $route " || fail "run.sh $route failed"
done

echo "==> the cron sidecar exits on a wrong secret"
if out="$(dc run --rm --no-deps -e CRON_SECRET=wrong cron 2>&1)"; then
  fail "the cron sidecar started with a wrong secret"
fi
grep -q "ERROR purge-imports" <<<"$out" || fail "no 'ERROR purge-imports' line: $out"
```

The `awk` prints field 8 of each crontab line (`5 0 * * * sh /opt/cron/run.sh roll-budgets …`: fields 1–5 are the schedule, 6 is `sh`, 7 is the script, 8 the route).

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `bash scripts/prod-smoke.sh`
Expected: FAIL at `==> compose refuses a missing CRON_SECRET` (no service interpolates `CRON_SECRET` with `:?` yet, so `config` succeeds) — `FAIL: compose accepted an empty CRON_SECRET`.

- [ ] **Step 3: Write the sidecar scripts and crontab**

`docker/cron/run.sh`:

```sh
#!/bin/sh
# Calls one cron route on the app (spec §7). Non-zero exit on any HTTP error.
set -u
route="$1"
if body="$(wget -q -O - --post-data "" \
  --header "Authorization: Bearer $(cat /run/cron-secret)" \
  "http://app:3000/api/cron/$route" 2>&1)"; then
  echo "OK $route $body"
else
  echo "ERROR $route $body" >&2
  exit 1
fi
```

`docker/cron/start.sh`:

```sh
#!/bin/sh
# Cron sidecar entrypoint (spec §7, D6): a failing first call exits, so a wrong secret
# shows as a restart loop.
set -eu
if [ -z "${CRON_SECRET:-}" ]; then
  echo "ERROR CRON_SECRET is empty" >&2
  exit 1
fi
# busybox crond does not pass the container environment to its jobs.
umask 077
printf '%s' "$CRON_SECRET" >/run/cron-secret

sh /opt/cron/run.sh purge-imports
cp /opt/cron/crontab /etc/crontabs/root
exec crond -f -l 8
```

`docker/cron/crontab`:

```
# UTC (spec D7). Job output goes to the container log: PID 1 is crond.
5 0 * * * sh /opt/cron/run.sh roll-budgets >/proc/1/fd/1 2>/proc/1/fd/2
0 3 * * * sh /opt/cron/run.sh purge-audit >/proc/1/fd/1 2>/proc/1/fd/2
0 * * * * sh /opt/cron/run.sh purge-imports >/proc/1/fd/1 2>/proc/1/fd/2
```

- [ ] **Step 4: Add the `cron` service to `docker-compose.prod.yml`**

Under `services:`, after `app`:

```yaml
  cron:
    image: alpine:3
    restart: unless-stopped
    environment:
      CRON_SECRET: ${CRON_SECRET:?set CRON_SECRET in .env}
    volumes:
      - ./docker/cron:/opt/cron:ro
    command: ["sh", "/opt/cron/start.sh"]
    depends_on:
      app:
        condition: service_healthy
```

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `bash scripts/prod-smoke.sh`
Expected: all steps pass, last line `OK prod smoke`.

If `==> the cron sidecar exits on a wrong secret` fails with no `ERROR purge-imports` line: busybox `wget -q` printed nothing on the 401. Drop `-q` from `run.sh` (its progress output then lands in `$body`, which is fine for an error line) and re-run.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write docker-compose.prod.yml
git add docker/cron docker-compose.prod.yml scripts/prod-smoke.sh
git commit -m "feat(docker): cron sidecar calling the three cron routes in the prod compose (#130)"
git log -1 --format='%G? %s'
```

---

### Task 3: CI workflow, env examples and README

**Files:**
- Create: `.github/workflows/prod-smoke.yml`
- Create: `.env.prod.example`
- Modify: `.env.example` (add `CRON_SECRET`)
- Modify: `README.md` (sections "Self-hosting" and "Scheduled jobs")

**Interfaces:**
- Consumes: `scripts/prod-smoke.sh`, compose variables from Tasks 1–2.

- [ ] **Step 1: Write `.github/workflows/prod-smoke.yml`**

```yaml
name: Prod smoke

# A separate workflow: GitHub Actions cannot path-filter one job inside ci.yml (spec §9).
on:
  pull_request:
    branches: [main, develop]
    paths:
      - Dockerfile
      - .dockerignore
      - "docker/**"
      - docker-compose.prod.yml
      - "prisma/**"
      - package.json
      - package-lock.json
      - scripts/prod-smoke.sh
      - .github/workflows/prod-smoke.yml

concurrency:
  group: prod-smoke-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  smoke:
    name: Prod smoke
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v6

      - name: Boot the prod compose and check it
        run: bash scripts/prod-smoke.sh
```

- [ ] **Step 2: Write `.env.prod.example` and update `.env.example`**

`.env.prod.example`:

```bash
# Settings for docker-compose.prod.yml (README "Self-hosting"). Copy to .env and fill in.

# Image tag on ghcr.io/navino16/bilan ("develop" until the first release is tagged).
BILAN_VERSION=latest
APP_URL=https://bilan.example.com

# openssl rand -base64 32 (one value each)
AUTH_SECRET=
DATA_ENCRYPTION_KEY=
SEARCH_TOKEN_KEY=
CRON_SECRET=

# openssl rand -hex 24 — hex because the password goes into DATABASE_URL
MARIADB_PASSWORD=
MARIADB_ROOT_PASSWORD=
```

`.env.example` — after the `SEARCH_TOKEN_KEY=` line, add:

```bash
CRON_SECRET=                  # openssl rand -base64 32 (unset: the /api/cron routes 404)
```

- [ ] **Step 3: Add the README sections**

In `README.md`, insert after the `## Demo data` section and before `## Scripts`:

````markdown
## Self-hosting

`docker-compose.prod.yml` runs the app, MariaDB (encrypted at rest, not exposed) and a
cron sidecar.

```bash
cp .env.prod.example .env          # then fill in every value
mkdir -p docker/mariadb/keyring
echo "1;$(openssl rand -hex 32)" > docker/mariadb/keyring/keyfile
chmod 644 docker/mariadb/keyring/keyfile
docker compose -f docker-compose.prod.yml up -d
```

On every start the app container applies pending migrations (`prisma migrate deploy`)
and seeds roles, permissions and default settings (settings changed in the admin UI are
kept), then serves on port 3000. Open `APP_URL`: a fresh install lands on the setup
wizard, which creates the first (super admin) account.

Keep `.env` and the keyring file safe: without the keyring the database files can't be
read, and without `DATA_ENCRYPTION_KEY` the transaction labels can't be decrypted.

To upgrade, change `BILAN_VERSION` in `.env`, then
`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`.

## Scheduled jobs

Three token-guarded routes do the periodic work. The `cron` sidecar of the prod compose
calls them (UTC); it calls `purge-imports` once at start and exits if that fails, so a
wrong or missing `CRON_SECRET` shows up as a restart loop in `docker compose ps`.

| Route                          | Schedule (UTC) | Effect                                                                     |
| ------------------------------ | -------------- | -------------------------------------------------------------------------- |
| `POST /api/cron/roll-budgets`  | 00:05 daily    | Creates the next period of every ended recurring budget                    |
| `POST /api/cron/purge-audit`   | 03:00 daily    | Deletes audit-log entries older than 12 months                             |
| `POST /api/cron/purge-imports` | hourly         | Deletes abandoned import batches older than 24 h (and their partial rows) |

Without the compose, call them from the host crontab:

```cron
5 0 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/roll-budgets
0 3 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/purge-audit
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/purge-imports
```

Check the secret: `curl -i -X POST -H "Authorization: Bearer <secret>" <APP_URL>/api/cron/purge-imports`
answers `200 {"purged":…}`; `401` means a wrong secret, `404` that `CRON_SECRET` is
unset in the app.
````

Also add a row to the `## Scripts` table:

```markdown
| `bash scripts/prod-smoke.sh`         | Boot and check the prod compose |
```

- [ ] **Step 4: Format and lint**

Run:

```bash
npx prettier --write README.md .github/workflows/prod-smoke.yml
npm run lint
```

Expected: no Prettier diff left and no ESLint error (the known `_actor` warning in `src/server/services/rgpd/index.ts` stays).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/prod-smoke.yml .env.prod.example .env.example README.md
git commit -m "docs: self-hosting and scheduled jobs, prod smoke workflow (#130)"
git log -1 --format='%G? %s'
```

---

### Task 4: Final verification

- [ ] **Step 1: Full local suite**

Run: `npm run ci`
Expected: lint (only the known `_actor` warning), typecheck and tests pass. The local test database (`mariadb-test`, tmpfs) loses its schema whenever the container restarts; if integration tests fail on missing tables, run `DATABASE_URL=mysql://app:app_password@localhost:3307/budget_test npx prisma migrate deploy` and `DATABASE_URL=… node prisma/seed.ts`, then re-run.

- [ ] **Step 2: Smoke test from a clean state**

Run: `docker compose -p bilan-smoke down -v 2>/dev/null; bash scripts/prod-smoke.sh`
Expected: `OK prod smoke`.

- [ ] **Step 3: Dev stack still works**

Run: `docker compose ps` (dev `app`, `mariadb`, `mariadb-test` still up) and `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/fr/login`.
Expected: `200` — the smoke test ran under its own project and port and did not touch the dev stack.

---

## Addendum (2026-10-02): simplified boot

After review the user asked for a simpler image (spec D1–D3, §4–§5 updated):

- `docker/entrypoint.sh` removed; the prod `CMD` runs `prisma migrate deploy` then `exec node server.js`.
- The seed runs inside the app, from `src/instrumentation.ts` (`register()`), with the app's Prisma client.
- `docker/migrate` keeps only `prisma` + `dotenv`; no second client, no `prisma generate` in the image.
- Image 557 MB → 463 MB (`/opt/migrate` 318 MB → 226 MB). Pruning the CLI was judged over-engineering.

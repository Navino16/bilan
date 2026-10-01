# Production boot and scheduled jobs (#130)

> **Status**: Approved in brainstorming — pending written-spec review
> **Date**: 2026-09-30
> **Issue**: #130 (scope widened to the first boot of the production image)

## 1. Problem

The three cron jobs are token-guarded Route Handlers meant to be called by host cron (phase-8 plan, design decision 6), but nothing schedules them:

- the prod image only runs `node server.js`;
- `docker-compose.yml` is dev-only and there is no production compose;
- `CRON_SECRET` is missing from `.env.example`, so the routes answer 404 and stay inert.

Scoping found a blocking gap underneath: **the prod image cannot boot on an empty database.** It ships neither the Prisma CLI nor `prisma/migrations`, so no migration is ever applied, and it has no way to run `prisma/seed.ts` (roles, permissions, default app settings). The setup wizard needs that seed: `completeSetup` grants `SUPER_ADMIN`, a role that only exists once seeded.

## 2. Goal

- `docker compose -f docker-compose.prod.yml up -d` on a fresh host gives a working app: migrated and seeded database, setup wizard reachable, cron jobs scheduled.
- A missing or wrong `CRON_SECRET` is visible right away.
- CI proves it on every PR that touches the image or the schema.

Out of scope:

- an in-app scheduler (`instrumentation.ts`): it breaks phase-8 decision 6 and needs a guard against several instances running the same job;
- several app instances migrating at once (`prisma migrate deploy` already takes a lock);
- automatic rollback of a failed migration.

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | The **prod image migrates and seeds on every start**, from an entrypoint script, before `node server.js`. | User choice. One image, which also works outside the compose (`docker run`, Kubernetes). The alternative, a separate `migrate` service, needs a second published image and is easy to forget without the compose. |
| D2 | Migrations and seed run from a **self-contained toolkit in `/opt/migrate`**, built in a separate alpine stage: `prisma` CLI, `dotenv`, `@prisma/client`, `@prisma/adapter-mariadb`, a generated client, the schema, the migrations and `seed.ts`. | Same libc as the prod stage (musl schema engine), versions pinned by `package-lock.json`. It does not depend on what Next copies into the standalone `node_modules` (the MariaDB adapter is likely bundled, not copied). Costs tens of MB. |
| D3 | The seed runs with `node prisma/seed.ts` (Node 24 native type stripping), not `tsx`. | `seed.ts` only uses erasable TypeScript syntax. Checked on the host (Node 24.19): it runs and exits 0. |
| D4 | The seed is safe to run on every start. | Every write is an `upsert`, and app settings use `update: {}`, so a value an admin changed is never overwritten. |
| D5 | Scheduling is a **`cron` sidecar** (plain `alpine:3`: busybox `crond` + `wget`) in the prod compose; still no in-app scheduler. | Issue scope. The routes stay host-driven; installs without the compose use the crontab lines from the README. |
| D6 | The sidecar calls `purge-imports` once at start and **exits non-zero on failure**. | A wrong or missing secret shows up as a restart loop in `docker compose ps`, not as silent log lines. `purge-imports` is idempotent and harmless. |
| D7 | Schedules, **in UTC**: `roll-budgets` 00:05 daily, `purge-audit` 03:00 daily, `purge-imports` hourly. | Issue scope. Plain `alpine:3` has no `tzdata`, so a `TZ` name would be ignored. |
| D8 | The prod compose keeps MariaDB **encryption at rest** (same `encryption.cnf` and keyring layout as dev) and does **not publish** the database port. | Main spec requirement; the database is only reached from the compose network. |
| D9 | CI gets a **`prod-smoke` workflow** that builds the image and boots the prod compose, filtered on the paths that can break it. It runs `scripts/prod-smoke.sh`, which also runs locally. | User choice. The entrypoint only fails at a real first boot; config validation alone would not catch a missing file or module. |

## 4. Image — `Dockerfile`

- A new `.dockerignore` keeps the host `node_modules` (built for glibc), `.next`, `.env*` and the keyring out of the build context.
- Stage `base` adds `openssl` (needed by the Prisma schema engine on alpine).
- New stage `migrator` (FROM `base`), working directory `/opt/migrate`:
  - a minimal `package.json` (`{"private": true, "type": "module"}`; `type` silences Node's typeless-module warning for `seed.ts`);
  - `npm install` of `prisma`, `dotenv`, `@prisma/client` and `@prisma/adapter-mariadb`, at the versions read from `package-lock.json`;
  - `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts`;
  - `prisma generate`.
- Stage `prod` adds `/opt/migrate` from `migrator`, and `docker/entrypoint.sh` as `ENTRYPOINT`, replacing `CMD ["node", "server.js"]`.
- The `dev` stage and `docker-compose.yml` are unchanged.

## 5. First boot — `docker/entrypoint.sh`

POSIX `sh`, `set -eu`:

1. `prisma migrate deploy`, run from `/opt/migrate`. On failure (database unreachable, broken migration) the script exits non-zero, `restart: unless-stopped` retries, and the error is in `docker compose logs app`.
2. `node prisma/seed.ts`, run from `/opt/migrate` (D3, D4).
3. `cd /app && exec node server.js`, so signals reach Node directly.

## 6. Compose — `docker-compose.prod.yml`

| Service | Definition |
|---------|------------|
| `mariadb` | `mariadb:11`; named volume for data; `./docker/mariadb/conf.d` and `./docker/mariadb/keyring` mounted read-only; no published port; healthcheck as in dev; `MARIADB_PASSWORD` and `MARIADB_ROOT_PASSWORD` required (`${VAR:?}`). |
| `app` | `image: ghcr.io/navino16/bilan:${BILAN_VERSION:-latest}` with `build: { context: ., target: prod }` as a fallback; `env_file: ${BILAN_ENV_FILE:-.env}`; `DATABASE_URL` built from `MARIADB_PASSWORD` on the `mariadb` host; published port `${BILAN_PORT:-3000}`; `depends_on: mariadb (healthy)`; healthcheck `wget -q --spider http://127.0.0.1:3000/fr/login` (on a fresh install the proxy redirects to `/fr/setup`, which `wget` follows; either way the answer needs the database). |
| `cron` | plain `alpine:3`, nothing installed (busybox ships `crond` and `wget`, so a restart needs no network); `docker/cron/` mounted read-only; `CRON_SECRET` from the environment; `depends_on: app (healthy)`; `restart: unless-stopped`. |

## 7. Cron sidecar — `docker/cron/`

- `crontab`: the three lines of D7, each running `run.sh <route>`.
- `run.sh <route>`: busybox `wget -q -O - --post-data "" --header "Authorization: Bearer …" http://app:3000/api/cron/<route>`, which exits non-zero on any HTTP error. It logs one line per call to the container output, `OK <route> <body>` or `ERROR <route> <wget error, which carries the HTTP status>`, and exits non-zero on failure.
- `start.sh`:
  - fails at once if `CRON_SECRET` is empty;
  - writes the secret to a file only root can read (busybox `crond` does not pass the container environment to jobs); `run.sh` reads it back;
  - runs `run.sh purge-imports` once and exits non-zero if it fails (D6);
  - then `exec crond -f` with the crontab.

## 8. Configuration and docs

- `.env.example`: add `CRON_SECRET=  # openssl rand -base64 32`.
- New `.env.prod.example`: `APP_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `CRON_SECRET`, `MARIADB_PASSWORD`, `MARIADB_ROOT_PASSWORD`, `BILAN_VERSION`, each with its generation command. `BILAN_PORT` and `BILAN_ENV_FILE` stay optional (they let the smoke test run next to a dev stack).
- README:
  - **Self-hosting**: create `.env` from `.env.prod.example`, generate the keyring, `docker compose -f docker-compose.prod.yml up -d`, what the first boot does (migrations, seed, setup wizard), how to upgrade (change `BILAN_VERSION`, `pull`, `up -d`).
  - **Scheduled jobs**: the three routes and their effect, the crontab lines for installs without the compose, and a `curl` command to check the secret (200 expected, 401 means a wrong secret, 404 an unset one).

## 9. CI — `prod-smoke` workflow

- `scripts/prod-smoke.sh` (bash) runs the whole check, locally or in CI, under its own compose project (`bilan-smoke`), a throwaway env file and port 3100, so it never touches a dev stack or its `.env`:
  1. `docker compose config` (fast validation);
  2. generate the throwaway env file (and the keyring if missing);
  3. `up -d --build --wait`;
  4. `/fr/login` answers 200 after redirects, on the setup page (migrations and seed ran on an empty database);
  5. `POST /api/cron/purge-imports`: 200 with `{ "purged": … }` with the secret, 401 with a wrong one;
  6. the `cron` container is running and its logs contain `OK purge-imports`;
  7. a one-off `cron` container started with a wrong secret exits non-zero and logs `ERROR purge-imports` (D6).
  - On failure it prints the compose logs; it always runs `down -v`.
- `.github/workflows/prod-smoke.yml` runs the script on pull requests to `develop`/`main` that change `Dockerfile`, `docker/**`, `docker-compose.prod.yml`, `prisma/**`, `package.json`, `package-lock.json`, `scripts/prod-smoke.sh` or the workflow itself. A separate workflow, because GitHub Actions cannot path-filter a single job inside `ci.yml`.

## 10. Tests

- `scripts/prod-smoke.sh` (§9) covers the entrypoint, the seed, the compose and the sidecar end to end, including the wrong-secret restart (D6). It is the failing test written before the implementation.
- The existing suites are unchanged: nothing in `src/` changes.

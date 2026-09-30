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
| D2 | The Prisma CLI is installed in a separate **alpine** stage and copied into the prod stage. | Same libc as the prod stage (musl schema engine), and the version is pinned by `package-lock.json`. Costs about 30–60 MB. |
| D3 | The seed runs with `node prisma/seed.ts` (Node 24 native type stripping), not `tsx`. | `seed.ts` only uses erasable TypeScript syntax. Fallback if it does not resolve in the image: compile it to JS at build time. |
| D4 | The seed is safe to run on every start. | Every write is an `upsert`, and app settings use `update: {}`, so a value an admin changed is never overwritten. |
| D5 | Scheduling is a **`cron` sidecar** (plain `alpine:3`: busybox `crond` + `wget`) in the prod compose; still no in-app scheduler. | Issue scope. The routes stay host-driven; installs without the compose use the crontab lines from the README. |
| D6 | The sidecar calls `purge-imports` once at start and **exits non-zero on failure**. | A wrong or missing secret shows up as a restart loop in `docker compose ps`, not as silent log lines. `purge-imports` is idempotent and harmless. |
| D7 | Schedules, in UTC by default (`TZ` overrides): `roll-budgets` 00:05 daily, `purge-audit` 03:00 daily, `purge-imports` hourly. | Issue scope. |
| D8 | The prod compose keeps MariaDB **encryption at rest** (same `encryption.cnf` and keyring layout as dev) and does **not publish** the database port. | Main spec requirement; the database is only reached from the compose network. |
| D9 | CI gets a **`prod-smoke` job** that builds the image and boots the prod compose, filtered on the paths that can break it. | User choice. The entrypoint only fails at a real first boot; config validation alone would not catch a missing file or module. |

## 4. Image — `Dockerfile`

New stage `migrator` (FROM `base`, alpine): installs the `prisma` CLI at the version locked in `package-lock.json`, plus the modules `prisma.config.ts` loads (`prisma/config`, `dotenv`).

Stage `prod` adds:

- `prisma/` (schema, migrations, `seed.ts`) and `prisma.config.ts`;
- the CLI and its dependencies from `migrator`;
- `docker/entrypoint.sh`, as `ENTRYPOINT`, replacing `CMD ["node", "server.js"]`.

The `dev` stage and `docker-compose.yml` are unchanged.

## 5. First boot — `docker/entrypoint.sh`

POSIX `sh`, `set -eu`:

1. `prisma migrate deploy`. On failure (database unreachable, broken migration) the script exits non-zero, `restart: unless-stopped` retries, and the error is in `docker compose logs app`.
2. `node prisma/seed.ts` (D3, D4).
3. `exec node server.js`, so signals reach Node directly.

Checked first during implementation, before anything else is built on it:

- `node prisma/seed.ts` runs in the image, and `@prisma/client` and `@prisma/adapter-mariadb` resolve from the standalone `node_modules`;
- the CLI loads `prisma.config.ts` (`dotenv/config`, `prisma/config` resolvable).

## 6. Compose — `docker-compose.prod.yml`

| Service | Definition |
|---------|------------|
| `mariadb` | `mariadb:11`; named volume for data; `./docker/mariadb/conf.d` and `./docker/mariadb/keyring` mounted read-only; no published port; healthcheck as in dev; `MARIADB_PASSWORD` and `MARIADB_ROOT_PASSWORD` required (`${VAR:?}`). |
| `app` | `image: ghcr.io/navino16/bilan:${BILAN_VERSION:-latest}` with `build: { context: ., target: prod }` as a fallback; `env_file: .env`; `DATABASE_URL` built from `MARIADB_PASSWORD` on the `mariadb` host; port `3000`; `depends_on: mariadb (healthy)`; healthcheck `wget -q --spider http://127.0.0.1:3000/fr/login` (on a fresh install the proxy redirects to `/fr/setup`, which `wget` follows; either way the answer needs the database). |
| `cron` | plain `alpine:3`, nothing installed (busybox ships `crond` and `wget`, so a restart needs no network); `docker/cron/` mounted read-only; `CRON_SECRET` and `TZ` from the environment; `depends_on: app (healthy)`; `restart: unless-stopped`. |

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
- New `.env.prod.example`: `APP_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `CRON_SECRET`, `MARIADB_PASSWORD`, `MARIADB_ROOT_PASSWORD`, `BILAN_VERSION`, `TZ`, each with its generation command.
- README:
  - **Self-hosting**: create `.env` from `.env.prod.example`, generate the keyring, `docker compose -f docker-compose.prod.yml up -d`, what the first boot does (migrations, seed, setup wizard), how to upgrade (change `BILAN_VERSION`, `pull`, `up -d`).
  - **Scheduled jobs**: the three routes and their effect, the crontab lines for installs without the compose, and a `curl` command to check the secret (200 expected, 401 means a wrong secret, 404 an unset one).

## 9. CI — `prod-smoke` job in `ci.yml`

- Runs only when the PR changes `Dockerfile`, `docker/**`, `docker-compose.prod.yml`, `prisma/**`, `package.json`, `package-lock.json` or `.github/workflows/ci.yml`.
- Steps:
  1. `docker compose -f docker-compose.prod.yml config` (fast validation);
  2. generate a throwaway `.env` and keyring;
  3. `docker compose -f docker-compose.prod.yml up -d --build --wait`;
  4. `/fr/login` answers 200 after redirects, i.e. the setup page (migrations and seed ran on an empty database);
  5. `POST /api/cron/purge-imports`: 200 with `{ "purged": … }` with the secret, 401 with a wrong one;
  6. the `cron` container is running and its logs contain `OK purge-imports`.
- On failure: print `docker compose logs`. Always: `docker compose down -v`.

## 10. Tests

- CI: the `prod-smoke` job (§9) covers the entrypoint, the seed, the compose and the sidecar end to end.
- The existing suites are unchanged: nothing in `src/` changes.
- Manual, once before the PR: the same scenario locally, plus a sidecar started with a wrong secret, to check it restarts in a loop with an `ERROR purge-imports … 401` line in its logs.

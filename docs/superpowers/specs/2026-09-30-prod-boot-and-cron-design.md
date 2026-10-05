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
| D1 | The **prod image migrates on every start** (`prisma migrate deploy` then `node server.js`, in the image `CMD`); the **app seeds itself** on every server start from `src/instrumentation.ts`, with its own Prisma client. | User choice, kept simple: one image, no entrypoint script, no second client. Overriding the command (`docker compose run --rm app sh`) skips the migration, which is the way in to repair a failed one. |
| D2 | The image carries only the **Prisma CLI** (`prisma` + `dotenv`, own `docker/migrate/package.json` and lockfile, `npm ci` in an alpine stage), the schema and the migrations, in `/opt/migrate`. | Same libc as the prod stage (musl schema engine), reproducible build. The CLI and its dependencies weigh about 240 MB; pruning it was judged over-engineering. |
| D3 | The seed functions stay in `prisma/seed.ts` (still used by `prisma db seed`, the dev/e2e seed scripts and the tests); `src/instrumentation.ts` imports them. | No code moves; Next bundles the file into the server. |
| D4 | The seed is safe to run on every start. | Every write is an `upsert`, and app settings use `update: {}`, so a value an admin changed is never overwritten. |
| D5 | Scheduling is a **`cron` service running the app image** with another command (`sh /opt/cron/start.sh`, as root): busybox `crond` + `wget` are already in `node:24-alpine`, the scripts are copied into the image. Still no in-app scheduler. | User choice: **running the project must not need a repo checkout**, so everything the cron needs ships in an image; reusing the app image keeps one image to publish and app/cron versions in lockstep. |
| D6 | The sidecar calls `purge-imports` once at start and **exits non-zero on failure**. | A wrong or missing secret shows up as a restart loop in `docker compose ps`, not as silent log lines. `purge-imports` is idempotent and harmless. |
| D7 | Schedules, **in UTC**: `roll-budgets` 00:05 daily, `purge-audit` 03:00 daily, `purge-imports` hourly. | Issue scope. Plain `alpine:3` has no `tzdata`, so a `TZ` name would be ignored. |
| D8 | The prod compose keeps MariaDB **encryption at rest**, configured by `command:` flags (no mounted `conf.d`), with a user-generated `./keyring/keyfile`, and does **not publish** the database port. | Main spec requirement, without depending on repo files. |
| D9 | CI gets a **`prod-smoke` workflow** that builds the image and boots the prod compose, filtered on the paths that can break it. It runs `scripts/prod-smoke.sh`, which also runs locally. | User choice. The boot command only fails at a real first boot; config validation alone would not catch a missing file or module. |

## 4. Image — `Dockerfile`

- A `.dockerignore` keeps the host `node_modules` (built for glibc), `.next`, `.env*` and the keyring out of the build context.
- Stage `base` adds `openssl` (needed by the Prisma schema engine on alpine).
- Stage `migrator` (FROM `base`), working directory `/opt/migrate`: `npm ci` from `docker/migrate/package.json` + `package-lock.json` (`prisma`, `dotenv`, versions equal to the app lockfile, checked by a unit test), then `prisma.config.ts`, `prisma/schema.prisma` and `prisma/migrations/`.
- Stage `prod` adds `/opt/migrate` and sets `CMD ["sh", "-c", "cd /opt/migrate && node_modules/.bin/prisma migrate deploy && cd /app && exec node server.js"]`.
- The `dev` stage and `docker-compose.yml` are unchanged.

## 5. First boot

1. `prisma migrate deploy`. On failure (database unreachable, broken migration) the container exits non-zero, `restart: unless-stopped` retries, and the error is in `docker compose logs app`.
2. `exec node server.js`, so signals reach Node directly.
3. Next calls `register()` in `src/instrumentation.ts` before serving: it runs `seedRolesAndPermissions` and `seedAppSettings` (D4) with the app's Prisma client, on the Node runtime only. It runs in dev too, where it is equally harmless.

## 6. Compose — `docker-compose.prod.yml`

Running the project needs only four files next to each other: `docker-compose.prod.yml`, `app.env`, `db.env`, `keyring/keyfile`. No `build:`, no bind mount of repo files.

| Service | Definition |
|---------|------------|
| `mariadb` | `mariadb:11`; `env_file: db.env` (`MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`); database and user `bilan`; encryption flags in `command:`; named data volume; `./keyring` mounted read-only; no published port; healthcheck as in dev. |
| `app` | `image: ghcr.io/navino16/bilan:${BILAN_VERSION:-latest}`; `env_file: app.env` (`APP_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `CRON_SECRET`, `DATABASE_URL`); `init: true`; published port `${BILAN_PORT:-3000}`; `depends_on: mariadb (healthy)`; healthcheck `wget -q -O /dev/null http://127.0.0.1:3000/fr/login`. |
| `cron` | same image; `command: ["sh", "/opt/cron/start.sh"]` (overriding the command skips the migration); `user: root`; `init: true`; `env_file: app.env` (same trust domain as the app; only `CRON_SECRET` is read); `depends_on: app (healthy)`. |

Two env files keep the MariaDB root password out of the app and cron containers. Variables are not checked by compose (`:?`): the README lists the mandatory ones. `BILAN_VERSION` / `BILAN_PORT` are optional, read from the shell or a `.env` next to the compose file.

## 7. Cron — `docker/cron/` (copied to `/opt/cron` in the image)

- `crontab`: the three lines of D7, each running `run.sh <route>`, output redirected to the container log (`/proc/1/fd/1`).
- `run.sh <route>`: busybox `wget -q -T 60 -O - --post-data "" --header "Authorization: Bearer …" http://app:3000/api/cron/<route>`. One log line per call, `OK <route> <body>` or `ERROR <route> <wget error>`, non-zero exit on failure.
- `start.sh`: fails at once if `CRON_SECRET` is empty; writes the secret to a root-only file (busybox `crond` does not pass the environment to jobs); runs `run.sh purge-imports` once and exits non-zero if it fails (D6); then copies the crontab and `exec crond -f`.

## 8. Configuration and docs

- `.env.example`: `CRON_SECRET=  # openssl rand -base64 32`.
- `app.env.example` and `db.env.example` (replace `.env.prod.example`); `app.env`, `db.env` and `keyring/` are git- and docker-ignored.
- README **Self-hosting**: download `docker-compose.prod.yml` (no checkout), create `app.env` / `db.env` with the mandatory variables, generate the keyring (never overwrite an existing one), TLS reverse proxy and `https://` `APP_URL`, `up -d`, failed-migration repair, upgrade. **Scheduled jobs**: routes, host crontab lines, secret check, the transient errors after a host reboot.

## 9. CI — `prod-smoke` workflow

- `scripts/prod-smoke.sh` (bash) builds the image, then runs the whole check from a **temporary directory holding only the four runtime files** (proving no checkout is needed), under its own compose project (`bilan-smoke`) and port 3100, so it never touches a dev stack:
  1. `docker compose config` (fast validation);
  2. generate the throwaway `app.env`, `db.env`, `.env` and keyring;
  3. `docker build --target prod`, then `up -d --wait` (compose has no `build:`);
  4. `/fr/login` answers 200 after redirects, on the setup page (migrations and seed ran on an empty database), and `innodb_encrypt_tables` is `ON`;
  5. `POST /api/cron/purge-imports`: 200 with `{ "purged": … }` with the secret, 401 with a wrong one;
  6. the `cron` container is running and its logs contain `OK purge-imports`;
  7. a one-off `cron` container started with a wrong secret exits non-zero and logs `ERROR purge-imports` (D6); with an empty one it exits with `CRON_SECRET is empty`.
  - On failure it prints the compose logs; it always runs `down -v`.
- `.github/workflows/prod-smoke.yml` runs the script on pull requests to `develop`/`main` that change `Dockerfile`, `docker/**`, `docker-compose.prod.yml`, `prisma/**`, `package.json`, `package-lock.json`, `scripts/prod-smoke.sh` or the workflow itself. A separate workflow, because GitHub Actions cannot path-filter a single job inside `ci.yml`.

## 10. Tests

- `scripts/prod-smoke.sh` (§9) covers the boot command, the seed, the compose and the sidecar end to end, including the wrong-secret restart (D6). It is the failing test written before the implementation.
- The existing suites are unchanged: nothing in `src/` changes.

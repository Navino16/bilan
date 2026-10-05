# Bilan

> **About the name** — _Bilan_ is French for "balance sheet" / "financial overview".

A self-hosted, multi-user personal-finance app: multi-account, shared household groups,
budgets, transaction categorization, and CSV/PDF import. UI available in French and English.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 · Tailwind v4 · shadcn/ui · next-intl ·
Prisma 7 + MariaDB 11 · Better Auth · Node 24 · Vitest · Playwright · Docker Compose.

## Quickstart

```bash
npm run setup   # generates .env, boots MariaDB, migrates + seeds (once scope 0.2/0.3 are done)
npm run dev     # http://localhost:3000
```

## Demo data

`npm run db:seed-dev` creates a fictional user with a realistic dataset for local
development and demos (`scripts/seed-dev-user.ts`). It refuses to run if the user
already exists; `npm run db:seed-dev -- --reset` wipes and re-seeds it.

- **Login**: `dev@bilan.local` / `dev-password-123` (super admin: sees the whole admin area)
- **Accounts**: Compte courant, Livret A, Compte joint
- **Transactions**: ~450 over the 12 months ending today (recomputed on each run,
  deterministic for a given day), categorized with the default categories; ~15% left
  uncategorized on purpose (ATM withdrawals, PayPal…)
- **Links**: monthly internal transfers (→ joint, → Livret A) + a refunded purchase
- **Rules**: 3 categorization rules (Carrefour, Netflix, SNCF)
- **Household**: "Foyer Martin" with `member@e2e.local` (if the e2e users are seeded),
  the joint account shared with write access
- **Budgets**: a recurring monthly budget (last month, rolled into this month) and a
  household budget that goes over

## Self-hosting

Bilan runs from published images: no checkout of this repository is needed. Put four files
in one directory:

```text
bilan/
├── docker-compose.prod.yml   # from the release you run
├── app.env                   # app and cron settings (from app.env.example)
├── db.env                    # MariaDB passwords (from db.env.example)
└── keyring/keyfile           # MariaDB encryption key
```

Every variable of `app.env` and `db.env` is mandatory:

| File      | Variable                                                                | Value                                                                  |
| --------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app.env` | `APP_URL`                                                               | Public `https://` URL of the reverse proxy in front of the app         |
| `app.env` | `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `CRON_SECRET` | `openssl rand -base64 32`, one value each                              |
| `app.env` | `DATABASE_URL`                                                          | `mysql://bilan:<MARIADB_PASSWORD>@mariadb:3306/bilan`                  |
| `db.env`  | `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`                             | `openssl rand -hex 24` each (hex, because it goes into `DATABASE_URL`) |

Optional, from the shell or a `.env` next to the compose file: `BILAN_VERSION` (image tag,
default `latest`; use `develop` until the first release is tagged) and `BILAN_PORT`
(default `3000`).

```bash
mkdir -p keyring
# Never overwrite an existing keyfile: the database could no longer be read.
[ -f keyring/keyfile ] || echo "1;$(openssl rand -hex 32)" > keyring/keyfile
chmod 644 keyring/keyfile
docker compose -f docker-compose.prod.yml up -d
```

On every start the app container applies pending migrations (`prisma migrate deploy`)
and seeds roles, permissions and default settings (settings changed in the admin UI are
kept), then serves on port 3000 (`BILAN_PORT`). Serve it over HTTPS: put a TLS reverse proxy
(Caddy, Traefik, nginx…) in front of that port and set `APP_URL` to its public `https://`
URL. The app sends HSTS and `upgrade-insecure-requests`, and auth only trusts `APP_URL`,
so plain `http://host:3000` does not work. Open `APP_URL`: a fresh install lands on the setup
wizard, which creates the first (super admin) account.

Keep `app.env`, `db.env` and the keyring file safe: without the keyring the database files
can't be read, and without `DATA_ENCRYPTION_KEY` the transaction labels can't be decrypted.

If a migration fails, the app container stops before serving (see `docker compose logs app`).
Overriding its command skips the migration and gives a shell to repair it:
`docker compose -f docker-compose.prod.yml run --rm app sh`, then
`cd /opt/migrate && node_modules/.bin/prisma migrate resolve --rolled-back <migration>`.

To upgrade, set the new `BILAN_VERSION`, take that release's `docker-compose.prod.yml` if it
changed, then
`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`.

## Scheduled jobs

Three token-guarded routes do the periodic work. The `cron` service of the prod compose
(same image as the app) calls them (UTC); it calls `purge-imports` once at start and exits
if that fails, so a wrong or missing `CRON_SECRET` shows up as a restart loop in
`docker compose ps`. After a host reboot Docker restarts every container at once: the
`cron` service may log a few `ERROR purge-imports … Connection refused` and restart until
the app is up, then settles by itself.

| Route                          | Schedule (UTC) | Effect                                                                    |
| ------------------------------ | -------------- | ------------------------------------------------------------------------- |
| `POST /api/cron/roll-budgets`  | 00:05 daily    | Creates the next period of every ended recurring budget                   |
| `POST /api/cron/purge-audit`   | 03:00 daily    | Deletes audit-log entries older than 12 months                            |
| `POST /api/cron/purge-imports` | hourly         | Deletes abandoned import batches older than 24 h (and their partial rows) |

Without the compose, call them from the host crontab (cron jobs don't inherit your
shell environment, hence the variable line):

```cron
CRON_SECRET=<the value from .env>
5 0 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/roll-budgets
0 3 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/purge-audit
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://bilan.example.com/api/cron/purge-imports
```

Check the secret: `curl -i -X POST -H "Authorization: Bearer <secret>" <APP_URL>/api/cron/purge-imports`
answers `200 {"purged":…}`; `401` means a wrong secret, `404` that `CRON_SECRET` is
unset in the app.

## Scripts

| Script                               | Purpose                         |
| ------------------------------------ | ------------------------------- |
| `npm run dev`                        | Dev server                      |
| `npm run build` / `npm start`        | Production build / serve        |
| `npm run lint` / `npm run format`    | ESLint + Prettier               |
| `npm run typecheck`                  | `tsc --noEmit`                  |
| `npm test` / `npm run test:coverage` | Unit + integration (Vitest)     |
| `npm run test:e2e`                   | E2E (Playwright)                |
| `npm run ci`                         | lint + typecheck + test         |
| `npm run db:seed-dev`                | Seed the demo user (above)      |
| `bash scripts/prod-smoke.sh`         | Boot and check the prod compose |

## Docs

- Design spec: `docs/superpowers/specs/2026-05-26-budget-app-design.md`
- Roadmap: `PLAN.md`
- Visual design reference: `design/`

## License

Private project.

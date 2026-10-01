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

`docker-compose.prod.yml` runs the app, MariaDB (encrypted at rest, not exposed) and a
cron sidecar.

```bash
cp .env.prod.example .env          # then fill in every value
mkdir -p docker/mariadb/keyring
# Never overwrite an existing keyfile: the database could no longer be read.
[ -f docker/mariadb/keyring/keyfile ] || echo "1;$(openssl rand -hex 32)" > docker/mariadb/keyring/keyfile
chmod 644 docker/mariadb/keyring/keyfile
docker compose -f docker-compose.prod.yml up -d
```

On every start the app container applies pending migrations (`prisma migrate deploy`)
and seeds roles, permissions and default settings (settings changed in the admin UI are
kept), then serves on port 3000 (`BILAN_PORT`). Serve it over HTTPS: put a TLS reverse proxy
(Caddy, Traefik, nginx…) in front of that port and set `APP_URL` to its public `https://`
URL. The app sends HSTS and `upgrade-insecure-requests`, and auth only trusts `APP_URL`,
so plain `http://host:3000` does not work. Open `APP_URL`: a fresh install lands on the setup
wizard, which creates the first (super admin) account.

Keep `.env` and the keyring file safe: without the keyring the database files can't be
read, and without `DATA_ENCRYPTION_KEY` the transaction labels can't be decrypted.

To upgrade, change `BILAN_VERSION` in `.env`, then
`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`.

## Scheduled jobs

Three token-guarded routes do the periodic work. The `cron` sidecar of the prod compose
calls them (UTC); it calls `purge-imports` once at start and exits if that fails, so a
wrong or missing `CRON_SECRET` shows up as a restart loop in `docker compose ps`.

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

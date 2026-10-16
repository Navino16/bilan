**English** · [Français](README.fr.md)

# Bilan

> **About the name**: _Bilan_ is French for "balance sheet" / "financial overview".

A self-hosted, multi-user personal-finance app. Import your bank statements, categorize them
automatically, follow your budgets and share accounts with your household, on your own server.
Available in English and French.

![Bilan dashboard](docs/images/en/dashboard.png)

## Features

- **Accounts and transactions**: checking, savings and other accounts, manual entry, search,
  filters, notes, bulk actions.
- **Import**: CSV (column mapping, decimal mark, date order, duplicate detection) and PDF
  statements, with a preview before anything is saved and a one-click undo.
- **Categorization**: custom categories, rules learned from your corrections, suggestions.
- **Transaction links**: internal transfers and refunds paired so they don't count twice.
- **Budgets**: one-off or recurring, per-category lines, personal or household.
- **Households**: invite people by e-mail, link or code, share accounts read-only or with
  write access.
- **Insights**: dashboard and period comparisons.
- **Security**: encryption at rest (database and application level), two-factor
  authentication, passkeys, SSO (OIDC, Google), audit log, per-user data export and deletion.
- **Installable** on mobile as a web app (PWA), light and dark themes.

## Documentation

| Guide                                      | For                                                     |
| ------------------------------------------ | ------------------------------------------------------- |
| [User guide](docs/user-guide.md)           | Everyday use: import, categorize, budgets, households   |
| [Administrator guide](docs/admin-guide.md) | Users, roles, registration, SSO, SMTP, audit log        |
| [Self-hosting](docs/self-hosting.md)       | Install with Docker, reverse proxy, backups, operations |

## Quick start (self-hosting)

Bilan runs from published Docker images with MariaDB, behind an HTTPS reverse proxy. See the
[self-hosting guide](docs/self-hosting.md) for the files to create and the commands to run.
A fresh install opens on a setup wizard that creates the first administrator account.

Back up `app.env` along with the database: `DATA_ENCRYPTION_KEY` encrypts labels, notes,
IBANs and stored secrets, `AUTH_SECRET` encrypts two-factor secrets and backup codes, and
`SEARCH_TOKEN_KEY` builds the search index. Without them a restored database is unreadable. See
[Backup and restore](docs/self-hosting.md#backup-and-restore).

## Development

Requirements: Node 24, Docker.

```bash
npm ci
npm run setup        # generates .env and the MariaDB keyring, starts MariaDB, migrates and seeds
npm run dev          # http://localhost:3000 (or: docker compose up -d app)
npm run db:seed-dev  # optional demo user, see below
```

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · next-intl ·
Prisma 7 + MariaDB 11 · Better Auth · Vitest · Playwright.

### Demo data

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

### Scripts

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
| `npm run db:reindex-search`          | Rebuild the search index        |
| `npm run db:backup-dev`              | Encrypted dump of the dev DB    |
| `bash scripts/prod-smoke.sh`         | Boot and check the prod compose |

`npm run db:reindex-search` decrypts every transaction label and rewrites its search tokens
(batches of 500, `-- --batch=N` to change). Run it once after an upgrade that changes the
search tokenization (e.g. #192, word-prefix search); it is safe to re-run. It first checks
each stored `labelHash` against `SEARCH_TOKEN_KEY` and stops on a mismatch (wrong key); after a
change to the text normalization, add `-- --rehash` to rewrite `labelHash`/`rawLabelHash` too.
It runs from a source checkout (`npm ci`) whose `.env` points at the target database with the
same `DATA_ENCRYPTION_KEY`/`SEARCH_TOKEN_KEY`: the Docker runtime image ships neither the
scripts nor `tsx`.

`npm run test:e2e` reuses (or starts) the server on `http://localhost:3000`. To target a
server already running elsewhere, set `PLAYWRIGHT_BASE_URL` (no server is started then):
`PLAYWRIGHT_BASE_URL=http://localhost:3209 npm run test:e2e`. That server's database must be
seeded with `scripts/seed-e2e.ts`, and its `APP_URL` must use the same host.

### Design documents

- Design spec: `docs/superpowers/specs/2026-05-26-budget-app-design.md`
- Roadmap: `PLAN.md`
- Visual design reference: `design/`

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a
network service, you must offer its source code to its users.

## Security

Please report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

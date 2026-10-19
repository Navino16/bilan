# Development

Requirements: Node 24, Docker.

```bash
npm ci
npm run setup        # generates .env and the MariaDB keyring, starts MariaDB, migrates and seeds
npm run dev          # http://localhost:3000 (or: docker compose up -d app)
npm run db:seed-dev  # optional demo user, see below
```

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · next-intl ·
Prisma 7 + MariaDB 11 · Better Auth · Vitest · Playwright.

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

## Scripts

| Script                               | Purpose                                     |
| ------------------------------------ | ------------------------------------------- |
| `npm run dev`                        | Dev server                                  |
| `npm run build` / `npm start`        | Production build / serve                    |
| `npm run lint` / `npm run format`    | ESLint + Prettier                           |
| `npm run typecheck`                  | `tsc --noEmit`                              |
| `npm test` / `npm run test:coverage` | Unit + integration (Vitest)                 |
| `npm run test:e2e`                   | E2E (Playwright)                            |
| `npm run ci`                         | lint + typecheck + test                     |
| `npm run db:seed-dev`                | Seed the demo user (above)                  |
| `npm run db:reindex-search`          | Rebuild the search index                    |
| `npm run db:backup-dev`              | Encrypted dump of the dev DB                |
| `npm run icons`                      | Regenerate the favicon, PWA icons and logo  |
| `npm run docs:db` / `docs:screenshots` | Regenerate the documentation screenshots  |
| `bash scripts/prod-smoke.sh`         | Boot and check the prod compose             |

`npm run db:reindex-search` decrypts every transaction label and rewrites its search tokens
(batches of 500, `-- --batch=N` to change). Run it once after an upgrade that changes the
search tokenization (e.g. #192, word-prefix search); it is safe to re-run. It first checks
each stored `labelHash` against `SEARCH_TOKEN_KEY` and stops on a mismatch (wrong key); after a
change to the text normalization, add `-- --rehash` to rewrite `labelHash`/`rawLabelHash` too.
It runs from a source checkout (`npm ci`) whose `.env` points at the target database with the
same `DATA_ENCRYPTION_KEY`/`SEARCH_TOKEN_KEY`: the Docker runtime image ships neither the
scripts nor `tsx`.

## End-to-end tests

`npm run test:e2e` reuses (or starts) the server on `http://localhost:3000`. To target a
server already running elsewhere, set `PLAYWRIGHT_BASE_URL` (no server is started then):
`PLAYWRIGHT_BASE_URL=http://localhost:3209 npm run test:e2e`. That server's database must be
seeded with `scripts/seed-e2e.ts`, and its `APP_URL` must use the same host.

## Logo and icons

The mark is defined once in `src/lib/brand.ts`: the `BilanMark` component draws it in the app,
and `npm run icons` (`scripts/generate-icons.ts`) writes the favicon, the PWA and iOS icons and
the README logo (`docs/images/logo.svg`, `logo-dark.svg`) from it.

## Documentation screenshots

The images in `docs/images/{en,fr}/` are taken on a clean dataset, not on your dev database.
It needs a `.env` (`npm run setup`) and the test database (`docker compose up -d mariadb-test`).

1. `npm run docs:db` rebuilds the `budget_docs` database on the `mariadb-test` container
   (e2e users + the demo account).
2. Serve a production build on that database, with an `APP_URL` on the same host and port:

   ```bash
   npm run build
   DATABASE_URL=mysql://app:app_password@localhost:3307/budget_docs \
     APP_URL=http://localhost:3301 npx next start -p 3301
   ```

3. `DOCS_BASE_URL=http://localhost:3301 npm run docs:screenshots` captures every page in
   English and French (`scripts/docs-screenshots.ts`).

## Releases

Releases are cut by hand with Git Flow:

```bash
git flow release start <version>   # bump "version" in package.json, commit
git flow release finish <version>
git push origin main develop --tags
```

`git flow release finish` merges into `main` and `develop` with merge commits. The `Main/Develop`
ruleset (pull request, squash merge, linear history) refuses them, but repository administrators
bypass it: only an administrator can push a release. Pushing the tag runs `build.yml`, which
publishes the multi-arch image to `ghcr.io/navino16/bilan`, builds the changelog from the PR
labels, creates the GitHub Release and posts it to Discord.

## Design documents

- Architecture (stack, data model, key flows, security, deployment): [architecture.md](architecture.md)
- Visual design: the theme tokens in `src/app/globals.css`, described in [architecture.md](architecture.md#9-uiux--design-system--bilan)

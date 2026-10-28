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
| `npm run db:auto-link`               | Link past transfers between own accounts    |
| `npm run db:backup-dev`              | Encrypted dump of the dev DB                |
| `npm run icons`                      | Regenerate the favicon, PWA icons and logo  |
| `npm run docs:db` / `docs:screenshots` | Regenerate the documentation screenshots  |
| `npm run perf:db` / `perf:build` / `perf:bench` | Performance benchmark (below) |
| `bash scripts/prod-smoke.sh`         | Boot and check the prod compose             |

`npm run db:reindex-search` decrypts every transaction label and rewrites its search tokens
and merchant key hash (batches of 500, `-- --batch=N` to change). Run it once after an upgrade that changes the
search tokenization (e.g. #192, word-prefix search); it is safe to re-run. It first checks
each stored `labelHash` against `SEARCH_TOKEN_KEY` and stops on a mismatch (wrong key); after a
change to the text normalization, add `-- --rehash` to rewrite `labelHash`/`rawLabelHash` too.
It runs from a source checkout (`npm ci`) whose `.env` points at the target database with the
same `DATA_ENCRYPTION_KEY`/`SEARCH_TOKEN_KEY`: the Docker runtime image ships neither the
scripts nor `tsx`.

`npm run db:auto-link` links the two legs of past transfers between accounts a user owns, as
imports and manual entries do from now on (same amount in opposite directions, at most 4 days
apart, one obvious match). Pairs the user unlinked are never linked again; it is safe to re-run.

## Schema changes

No instance runs in production yet, so there is a single migration,
`prisma/migrations/*_init`: change `prisma/schema.prisma`, then regenerate it instead of adding
a migration (`npm run db:migrate` would create one).

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  > prisma/migrations/*_init/migration.sql
```

Put back the note at its end (no owner-XOR CHECK: MariaDB error 1901). Databases built from an
older migration must be rebuilt: `npm run db:reset` for the dev one, a drop and
`npx prisma migrate deploy` for `budget_test`, `npm run docs:db` and `npm run perf:db`.

## End-to-end tests

`npm run test:e2e` reuses (or starts) the server on `http://localhost:3000`. To target a
server already running elsewhere, set `PLAYWRIGHT_BASE_URL` (no server is started then):
`PLAYWRIGHT_BASE_URL=http://localhost:3209 npm run test:e2e`. That server's database must be
seeded with `scripts/seed-e2e.ts`, and its `APP_URL` must use the same host.

The SSO spec starts a mock identity provider that the app server must reach. When the app runs
in Docker, set `E2E_IDP_HOST` to the Docker network gateway (for example
`E2E_IDP_HOST=10.0.1.1`).

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

## Performance benchmark

`scripts/perf/` measures pages, API routes and server-action flows on a synthetic data set,
against production builds. It is not part of `npm run ci`: run it by hand to measure a
performance change or check a release. Builds, secrets and results live outside the repo, in
`~/.cache/bilan-perf` (`BILAN_PERF_DIR` to change).

1. `npm run perf:db` rebuilds the `budget_perf` database on the `mariadb-test` container
   (`-- realistic` or `-- stress` for one profile only). Both profiles share it, as users of
   one instance would:

   | Profile     | History   | Transactions | Search tokens | Rules |
   | ----------- | --------- | ------------ | ------------- | ----- |
   | `realistic` | 72 months | ~29k         | ~410k         | 300   |
   | `stress`    | 72 months | ~150k        | ~2.2M         | 1 000 |

   Each user has 5 accounts (one shared with a household), about 80 categories, 20 budgets
   and transfer links. The same profile always yields the same rows, ending at the current
   month. The labels are encrypted with keys generated once into `~/.cache/bilan-perf/perf.env`:
   delete that file and you must rebuild the database.

2. `npm run perf:build -- <ref>` makes a production build of a commit (`.` for the working
   tree, uncommitted changes included) and prints its directory. A commit already built is
   reused.

3. `npm run perf:bench -- [options] <build> [<build>]` serves each build on its own port
   (3410, 3411), signs in through the real auth flow, then times every scenario: warm-up runs
   first, then the measured runs.

   ```bash
   A=$(npm run -s perf:build -- develop | tail -1)
   B=$(npm run -s perf:build -- . | tail -1)
   npm run perf:bench -- --issue 297 --profile stress "$A" "$B"
   ```

   | Option                         | Default     |                                       |
   | ------------------------------ | ----------- | ------------------------------------- |
   | `--profile realistic\|stress`  | `realistic` | Repeat it to run both                 |
   | `--runs N` / `--warmup N`      | 10 / 2      | Measured and discarded runs           |
   | `--only <regex>`               |             | Scenario names                        |
   | `--issue <n>`                  |             | Scenarios tied to an issue            |
   | `--label <name>`               |             | Suffix of the results file            |

   With two builds, the runs alternate between them (A/B), so machine noise hits both alike.
   Each scenario prints p50/p95 (and the spread `cv` with one build), the SQL queries of one
   request (the server's `Questions` counter), the worst event-loop stall and, for pages, the
   HTML, RSC and JavaScript bytes. The raw samples go to `~/.cache/bilan-perf/results/`.
   Server-action flows (reclassify, rules import, link suggestions) run through
   `scripts/perf/flows.ts` of each build, so they are skipped on builds that predate it.

Measure on a quiet machine: nothing else on `mariadb-test` (tests, e2e), one benchmark at a
time. `budget_perf` sits on the container's tmpfs: about 1.2 GB of RAM with both profiles
(`perf:db` takes about 6 minutes). A server grows to about 1.3 GB on `realistic` and 1.7 GB
on `stress`, so an A/B run needs 3 to 4 GB free on top of the database.

## Dependency updates

`npx npm-check-updates` follows `.ncurc.cjs` (TypeScript and `@types/node` stay on their major).
`better-auth` and `@better-auth/passkey` are pinned with `~`, and the `@better-auth/core`
override must name the same version: bump all three together, or npm fails with ERESOLVE.

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

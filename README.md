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

## Scripts

| Script                               | Purpose                     |
| ------------------------------------ | --------------------------- |
| `npm run dev`                        | Dev server                  |
| `npm run build` / `npm start`        | Production build / serve    |
| `npm run lint` / `npm run format`    | ESLint + Prettier           |
| `npm run typecheck`                  | `tsc --noEmit`              |
| `npm test` / `npm run test:coverage` | Unit + integration (Vitest) |
| `npm run test:e2e`                   | E2E (Playwright)            |
| `npm run ci`                         | lint + typecheck + test     |
| `npm run db:seed-dev`                | Seed the demo user (above)  |

## Docs

- Design spec: `docs/superpowers/specs/2026-05-26-budget-app-design.md`
- Roadmap: `PLAN.md`
- Visual design reference: `design/`

## License

Private project.

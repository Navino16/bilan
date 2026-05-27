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

## Docs

- Design spec: `docs/superpowers/specs/2026-05-26-budget-app-design.md`
- Roadmap: `PLAN.md`
- Visual design reference: `design/`

## License

Private project.

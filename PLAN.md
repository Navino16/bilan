# Bilan — Roadmap

> **This is the roadmap/index**, not a detailed implementation plan. Each **scope** below maps 1:1 to a **GitHub issue** (one issue = one `feature/<scope>` branch = one PR → `develop`). Each **phase** = one **GitHub milestone**.
>
> Detailed, TDD-level implementation plans live in `docs/superpowers/plans/YYYY-MM-DD-phase-N-*.md` and are written just before executing each phase.
>
> Full design spec: `docs/superpowers/specs/2026-05-26-budget-app-design.md`.
> Visual design reference (pixel-perfect): `design/` (Bilan design system).

## Stack (see spec §2.1)

Next.js 16.2 · React 19.2 · TypeScript 6 · Tailwind v4 · shadcn/ui (themed Bilan) · next-intl (fr/en) · Prisma 7 + `@prisma/adapter-mariadb` · MariaDB 11 · Better Auth · Node 24 · **npm** · Vitest · Playwright · Docker Compose · GitHub Actions (CI like `librarr`) · Codecov · ghcr.io · Dependabot.

## Workflow (see spec §12)

- **Git Flow**: `feature/*` → `develop` (PR) ; releases cut manually via `git flow release` → tag on `main` ; `build.yml` packages on tag.
- **One scope = one issue = one branch = one PR**. Phases = milestones.
- Commits: 1-line English conventional (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).
- Tests: unit + integration (Vitest) on services, E2E (Playwright). All code/tests/comments in English; UI strings fr/en.

---

## Phase 0 — Project Bootstrap

**Milestone goal:** a running Next.js app in Docker, connected to MariaDB via Prisma, with CI green and the Bilan theme wired. Detailed plan: `docs/superpowers/plans/2026-05-27-phase-0-bootstrap.md`.

- [x] **0.1 — Init Next.js project + tooling.** Next.js 16 (App Router, src/), TypeScript 6 strict, Tailwind v4, ESLint + Prettier, Vitest, `.editorconfig`, `.nvmrc` (24), `.gitignore` (incl. `.env`, `.superpowers/`, `.reports/`), **README.md** (project intro + an English note on the name: "**Bilan** is French for _balance sheet / financial overview_"). _AC: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` all pass on a hello-world; git repo initialized with `main` + `develop`; README explains the name in English._
- [x] **0.2 — Docker Compose stack.** `docker-compose.yml` (app, mariadb 11 w/ encryption keyring, mariadb-test tmpfs, adminer), multi-stage `Dockerfile`, `scripts/init.sh`, `.env.example`, `src/env.ts` (envalid). _AC: `npm run setup` boots DBs; `npm run dev` serves the app in the container against mariadb._
- [x] **0.3 — Prisma 7 + MariaDB adapter + RBAC seed.** `prisma/schema.prisma` (driverAdapters), `src/server/db/index.ts` (`PrismaMariaDb`), Better Auth base models + RBAC models (`Role`, `Permission`, `RolePermission`, `UserRole`), first migration, `prisma/seed.ts` (roles + permissions). _AC: `prisma migrate dev` applies; seed runs idempotently; `prisma studio` shows tables._
- [x] **0.4 — Crypto primitives (AES-256-GCM + HMAC).** `server/crypto/{encryption,hmac,keys}.ts` — application-level field encryption + deterministic HMAC search tokens (used from Phase 2.1 IBAN onward). _AC: unit tests for round-trip, random IV, wrong-key failure, normalization/tokenization._
- [x] **0.5 — Bilan theme + fonts + shadcn + i18n.** Map `design/project/tokens.css` onto shadcn CSS variables (light + dark), self-host Newsreader + IBM Plex Sans/Mono via `next/font`, base shadcn components, `[locale]` routing (fr/en), middleware (locale + security headers), language switcher. _AC: `/fr` and `/en` render the themed demo page (Button/Card/Badge), theme toggle works, security headers present._
- [x] **0.6 — CI workflows + GitHub templates (like `librarr`).** `.github/workflows/ci.yml` (lint, build, test+coverage→Codecov, integration w/ mariadb service, e2e), `.github/workflows/build.yml` (multi-arch docker→ghcr.io, release+changelog on tag, Discord), `.github/dependabot.yml`, `.github/ISSUE_TEMPLATE/` (`1.bug_report.yml`, `2.feature_request.yml`, `config.yml` from librarr, "Librarr Version"→"Bilan Version"), `.github/PULL_REQUEST_TEMPLATE.md`, Playwright smoke test. _AC: CI green on a PR; reports uploaded; issue/PR templates available in the GitHub UI._

---

## Phase 1 — Authentication & Multi-User Core

**Milestone goal:** users can sign up/in (credentials + OIDC), first-run setup wizard works, roles enforced, registration modes respected.

- [x] **1.1 — Better Auth setup.** Credentials provider (argon2id), DB sessions, email verification, password reset (magic link), 2FA TOTP, passkeys plugin, admin plugin. Route handler `/api/auth/[...all]`. _AC: integration tests for signup/login/logout/session-revoke pass._
- [x] **1.2 — Dynamic OIDC providers from DB.** `AuthProvider` model, cached provider builder, `invalidateAuthCache()`. _AC: enabling an OIDC provider row makes its login button appear without restart (test via cache invalidation)._
- [x] **1.3 — Setup wizard.** `/setup` gated on `User.count()===0`: create first user → `SUPER_ADMIN`, seed default categories per locale, create `UserPreference`, optional SMTP/OIDC, choose registration mode. _AC: e2e covers first-run; `/setup` 404s once a user exists._
- [x] **1.4 — Auth UI (login/register/reset).** Bilan-styled pages, server actions, error states, lockout after 5 fails. _AC: e2e login success + rate-limit lockout._
- [x] **1.5 — Registration modes + admin user creation.** `OPEN`/`INVITE_ONLY`/`DISABLED` enforcement, `AdminSignupToken`, `/admin/users` create-by-admin with setup-account magic link. _AC: each mode behaves per spec §5.3 (integration + e2e)._
- [x] **1.6 — RBAC enforcement + app shell.** Permission checks middleware, protected `(authenticated)` layout, sidebar (desktop) + bottom nav/drawer (mobile) per Bilan `chrome.jsx`, theme toggle. _AC: non-admin blocked from `/admin`; nav renders both breakpoints (e2e mobile + desktop)._

---

## Phase 2 — Accounts & Groups

**Milestone goal:** create accounts, form household groups, invite members, share accounts with permissions.

- [x] **2.1 — BankAccount CRUD.** Model + migration, service (encrypted IBAN + hash), `/app/accounts` list + create/edit/archive (modal desktop / bottom sheet mobile). _AC: service unit + integration tests; e2e create/edit/archive._
- [x] **2.2 — Groups & membership.** `Group`, `GroupMember` models, `/app/groups` CRUD, roles OWNER/ADMIN/MEMBER. _AC: integration tests for membership rules._
- [x] **2.3 — Invitations (email + code).** `GroupInvitation`, email via SMTP (mocked in tests), accept by token/code, pending-invite for non-users. _AC: integration invite→accept flow; e2e invite by code._
- [x] **2.4 — Account sharing & permissions.** `AccountShare`, `permissions.service` (`listVisibleForUser`, WRITE checks), share UI. _AC: user B sees shared account, respects READ/WRITE (integration + e2e)._

---

## Phase 3 — Categories, Rules & Manual Transactions

**Milestone goal:** categorize transactions (manual entry), with user/group categories and auto-categorization rules.

- [ ] **3.1 — Categories (user XOR group).** Model + migration, seed default sets fr/en, `/app/categories` hierarchical CRUD, XOR constraint enforced. _AC: unit (XOR validation) + e2e CRUD._
- [ ] **3.2 — Transaction model + crypto.** `Transaction` (encrypted label/rawLabel/note, HMAC hashes), `TransactionSearchToken`, `server/crypto/*` (AES-256-GCM, HMAC). _AC: crypto unit tests (round-trip, key failure); integration create tx writes tokens._
- [ ] **3.3 — Categorization engine + learning.** `CategorizationRule` model, `categorization.service.suggest`, "create a rule?" dialog on manual recategorize. _AC: unit tests for all match types + priority; e2e recategorize→rule._
- [ ] **3.4 — Transactions list + manual entry.** `/app/transactions` (day-grouped cards mobile / table desktop per Bilan), filters, search (HMAC tokens), inline category edit, manual entry form. _AC: e2e search, filter, create, recategorize._

---

## Phase 4 — Import Sources

**Milestone goal:** import transactions from CSV (and PDF after a spike), with dedup and categorization.

- [x] **4.1 — Manual entry form polish.** (If not fully covered by 3.4) full validation, account preselect. _AC: e2e from account page._
- [x] **4.2 — CSV import.** `ImportBatch`, `/api/import/csv` (upload, parse w/ papaparse, mapping detection), preview UI, dedup `(accountId, externalId)`, batch commit + tokens + categorization. _AC: integration full import + dedup re-import (0 imported); e2e upload→preview→commit._
- [x] **4.3a — PDF spike.** Install `pdf-parse`, run on user's real bank PDFs in `samples/`, document the extracted structure. _AC: a short findings note committed; decision on parser approach._
- [x] **4.3b — PDF import.** Parser based on 4.3a, `/api/import/pdf`, same preview + dedup + categorization pipeline. _AC: integration parse sample → transactions; e2e upload→commit._

---

## Phase 5 — Reporting Views

**Milestone goal:** monthly dashboard and custom-period reporting per Bilan dashboard.

- [ ] **5.1 — Dashboard (flagship).** `/app/dashboard`: editorial layout, month switcher, KPI row (income/expense/net + vs-previous), category donut (shadcn Charts), budgets-in-progress bars, recent transactions. _AC: e2e renders with seeded data, month nav works._
- [ ] **5.2 — Custom periods.** Date-range picker (presets + custom), reactive recompute across dashboard + transactions. _AC: e2e switch presets; service unit tests for period math._

---

## Phase 6 — Transaction Links

**Milestone goal:** link related transactions (refunds), manually and via auto-suggestions, with balanced/unbalanced handling.

- [x] **6.1 — Link model + manual linking.** `TransactionLink`, `TransactionLinkMember`, link-mode UI (visible-tx selection), one-link-per-tx constraint. _AC: unit (primary/net-sum/balanced) + e2e manual link._
- [x] **6.2 — Auto suggestions.** `links.service.suggestPairs` (±window, min amount from `UserPreference`), `IgnoredLinkSuggestion`, suggestions panel accept/ignore. _AC: unit pairing logic; e2e accept + persisted ignore._
- [x] **6.3 — Link-aware totals.** Balanced groups excluded; unbalanced → primary gets net sum. Apply in dashboard + transactions display. _AC: integration totals with mixed links match expected._

---

## Phase 7 — Budgets

**Milestone goal:** budgets by category/account over custom periods, with auto-matching + explicit assignment.

- [x] **7.1 — Budget model + creation.** `Budget`, `BudgetLine` (category and/or account), `/app/budgets` + new-budget modal (dynamic lines, computed total), user XOR group scope. _AC: unit XOR + line validation; e2e create._
- [x] **7.2 — Budget calculation.** `budgets.service.computeLine` (visible tx, period filter, INCLUDE/EXCLUDE overrides, link-aware), status OK/WARN/OVER, detail page per Bilan. _AC: integration tests for matching + overrides + links._
- [x] **7.3 — Explicit assignment.** `BudgetAssignment` (INCLUDE/EXCLUDE), assign-to-budget from any visible tx (incl. unshared account → shared budget), transparency for group members. _AC: e2e assign the owner's personal tx to the family budget; their partner sees it._
- [x] **7.4 — Recurring budgets.** Auto-create next-period instance, parent/instance link. _AC: integration: rolling a recurring budget creates the next instance._

---

## Phase 8 — Polish & Hardening

**Milestone goal:** charts, exports, mobile fine-tuning, RGPD, and security hardening triggers.

- [x] **8.1 — Insights & charts.** `/app/insights`: category pie, monthly trend (shadcn Charts / Recharts). _AC: e2e renders._
- [ ] **8.2 — Export (CSV + RGPD JSON).** Filtered CSV export, full-user JSON export, account deletion (cascade + session invalidation). _AC: integration export contents; e2e delete cascades._
- [ ] **8.3 — Mobile fine-tuning + PWA.** `manifest.webmanifest`, service worker (app-shell cache), splash/icons, responsive pass. _AC: Lighthouse PWA installable; e2e mobile flows._
- [ ] **8.4 — Audit log + admin settings UI.** `AuditLog` writes on state mutations, `/admin` (auth-providers, SMTP, app-settings, audit-log viewer), 12-month purge cron. _AC: integration audit entries; e2e admin edits hot-reload._
- [ ] **8.5 — Security hardening (from spec §6.11, as triggered).** Encrypted DB backups script, optional 2FA-mandatory for admins, security email notifications. _AC: per item._
- [ ] **8.6 — Unified error pages (4XX/5XX).** `not-found`, `error`, `global-error`, `forbidden`/`unauthorized` wired to Next App Router primitives; shared Bilan `ErrorShell` component (reused by the existing /403); modernize 403/401 to native `forbidden()`/`unauthorized()` (correct HTTP status); harmonize the proxy's plain-text 404. i18n fallback outside locale context. _AC: each status renders the Bilan page with the right HTTP code; e2e 404 + 403._

---

## Notes

- **Branch protection**: deferred — rulesets require GitHub Pro on private repos. The reference ruleset (mirroring the `librarr` project: required checks, PR+review, squash, linear history, CodeQL) is saved in `scripts/github-ruleset.json`. Apply it (`gh api repos/Navino16/bilan/rulesets -X POST --input scripts/github-ruleset.json`) if the repo goes public or on a Pro plan. Until then, Git Flow discipline + CI are the safeguards.
- PDF parsing details deferred to 4.3a spike (real bank PDFs).
- No automatic migration of historical data — re-import manually via CSV (Phase 4).
- Production hosting (Caddy, backups) documented in spec §8.9 / §6.11, out of MVP build scope.

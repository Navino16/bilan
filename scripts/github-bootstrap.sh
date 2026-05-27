#!/usr/bin/env bash
#
# Creates GitHub milestones (one per phase), labels, and issues (one per scope)
# from PLAN.md. Idempotent-ish: re-running skips existing milestones and re-uses labels (--force),
# but WILL create duplicate issues if run twice — run once on a fresh repo.
#
# Prerequisites:
#   - `gh` CLI authenticated (`gh auth status`)
#   - run from the repo root, with a GitHub remote already set (`git remote -v`)
#
# Usage: bash scripts/github-bootstrap.sh
set -euo pipefail

echo "==> Labels"
label() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null && echo "  $1"; }
label "phase-0" "0E8A16" "Phase 0 — Bootstrap"
label "phase-1" "1D76DB" "Phase 1 — Auth & multi-user"
label "phase-2" "5319E7" "Phase 2 — Accounts & groups"
label "phase-3" "0052CC" "Phase 3 — Categories & transactions"
label "phase-4" "B60205" "Phase 4 — Imports"
label "phase-5" "D93F0B" "Phase 5 — Reporting"
label "phase-6" "FBCA04" "Phase 6 — Links"
label "phase-7" "006B75" "Phase 7 — Budgets"
label "phase-8" "5319E7" "Phase 8 — Polish & hardening"
label "frontend" "1D76DB" "Frontend / UI"
label "backend" "5319E7" "Backend / services"
label "security" "B60205" "Security"
label "infra" "0052CC" "Infra / CI / Docker"
# Labels used by the changelog builder (build.yml)
label "breaking change" "B60205" "Breaking change"
label "enhancement" "A2EEEF" "New feature"
label "bug" "D73A4A" "Bug fix"
label "documentation" "0075CA" "Documentation"
label "dependencies" "0366D6" "Dependency update"

echo "==> Milestones"
milestone() {
  gh api "repos/{owner}/{repo}/milestones" -f title="$1" -f description="$2" >/dev/null 2>&1 \
    && echo "  + $1" || echo "  = $1 (already exists)"
}
milestone "Phase 0 — Project Bootstrap" "Running Next.js app in Docker + Prisma/MariaDB + Bilan theme + CI green."
milestone "Phase 1 — Authentication & Multi-User Core" "Better Auth, OIDC, setup wizard, RBAC, registration modes."
milestone "Phase 2 — Accounts & Groups" "Accounts CRUD, groups, invitations, account sharing."
milestone "Phase 3 — Categories, Rules & Manual Transactions" "Categories, categorization rules, encrypted transactions, manual entry."
milestone "Phase 4 — Import Sources" "CSV import (+ PDF spike & parser)."
milestone "Phase 5 — Reporting Views" "Monthly dashboard + custom periods."
milestone "Phase 6 — Transaction Links" "Manual + auto links, link-aware totals."
milestone "Phase 7 — Budgets" "Budgets by category/account, calculation, assignments, recurrence."
milestone "Phase 8 — Polish & Hardening" "Charts, exports, PWA, audit log, security hardening."

echo "==> Issues"
mk() { # title, milestone, labels(csv), body
  gh issue create --title "$1" --milestone "$2" --label "$3" --body "$4" >/dev/null && echo "  + $1"
}

# ----- Phase 0 -----
M="Phase 0 — Project Bootstrap"
mk "0.1 — Init Next.js project + tooling" "$M" "phase-0,infra" "Next.js 16 (App Router, src/), TS 6 strict, Tailwind v4, ESLint+Prettier, Vitest, .nvmrc/.editorconfig/.gitignore, git init main+develop. AC: lint/typecheck/build/test pass on hello-world. See docs/superpowers/plans/2026-05-27-phase-0-bootstrap.md Task 0.1."
mk "0.2 — Docker Compose stack + env validation" "$M" "phase-0,infra" "docker-compose (app, mariadb, mariadb-test, adminer), Dockerfile, scripts/init.sh, .env.example, src/env.ts (envalid). AC: npm run setup boots DBs; npm run dev serves in container. Spec §8.1-8.3,8.7. Plan Task 0.2."
mk "0.3 — Prisma 7 + MariaDB adapter + RBAC seed" "$M" "phase-0,backend" "schema.prisma (driverAdapters), db client (PrismaMariaDb), Better Auth + RBAC models (§4.1), first migration, seed roles+permissions. AC: migrate+seed idempotent. Plan Task 0.3."
mk "0.4 — Crypto primitives (AES-256-GCM + HMAC)" "$M" "phase-0,security" "server/crypto/{encryption,hmac,keys}.ts. AC: unit tests round-trip, random IV, wrong-key fail, normalize/tokenize. Spec §6.1/§6.2. Plan Task 0.4."
mk "0.5 — Bilan theme + fonts + shadcn + i18n" "$M" "phase-0,frontend" "Map design/project/tokens.css → shadcn CSS vars (light+dark), next/font (Newsreader+IBM Plex), base shadcn, [locale] routing fr/en, middleware (locale+security headers), switcher. AC: /fr & /en render themed demo, toggle works, headers present. Spec §11. Plan Task 0.5."
mk "0.6 — CI workflows (like librarr) + Playwright smoke" "$M" "phase-0,infra" "ci.yml (lint/build/test+coverage→Codecov/integration+mariadb/e2e), build.yml (multi-arch docker→ghcr.io, release+changelog+Discord on tag), dependabot.yml, smoke e2e. AC: CI green on PR. Spec §7.6/§12.4. Plan Task 0.6."

# ----- Phase 1 -----
M="Phase 1 — Authentication & Multi-User Core"
mk "1.1 — Better Auth setup" "$M" "phase-1,backend,security" "Credentials (argon2id), DB sessions, email verify, password reset (magic link), 2FA TOTP, passkeys, admin plugin, /api/auth/[...all]. AC: integration signup/login/logout/session-revoke. Spec §5.2/§6.3/§6.4."
mk "1.2 — Dynamic OIDC providers from DB" "$M" "phase-1,backend" "AuthProvider model, cached provider builder, invalidateAuthCache(). AC: enabling an OIDC row shows its button without restart. Spec §5.9/§8.4."
mk "1.3 — Setup wizard" "$M" "phase-1,frontend,backend" "/setup gated on User.count()===0: first user → SUPER_ADMIN, seed categories per locale, UserPreference, optional SMTP/OIDC, registration mode. AC: e2e first-run; /setup 404s after. Spec §3.5/§5.1."
mk "1.4 — Auth UI (login/register/reset)" "$M" "phase-1,frontend" "Bilan-styled pages, server actions, error states, lockout after 5 fails. AC: e2e login success + rate-limit lockout. Spec §5.2/§6.7."
mk "1.5 — Registration modes + admin user creation" "$M" "phase-1,backend" "OPEN/INVITE_ONLY/DISABLED enforcement, AdminSignupToken, /admin/users create-by-admin + setup-account magic link. AC: each mode per spec §5.3."
mk "1.6 — RBAC enforcement + app shell" "$M" "phase-1,frontend" "Permission middleware, protected layout, sidebar + bottom nav/drawer (Bilan chrome.jsx), theme toggle. AC: non-admin blocked from /admin; nav renders both breakpoints. Spec §11.3."

# ----- Phase 2 -----
M="Phase 2 — Accounts & Groups"
mk "2.1 — BankAccount CRUD" "$M" "phase-2,backend,frontend" "Model+migration, service (encrypted IBAN+hash), /app/accounts list + create/edit/archive (modal/bottom sheet). AC: service unit+integration; e2e CRUD. Spec §4.3/§5.4."
mk "2.2 — Groups & membership" "$M" "phase-2,backend" "Group, GroupMember models, /app/groups CRUD, roles OWNER/ADMIN/MEMBER. AC: integration membership rules. Spec §4.2."
mk "2.3 — Invitations (email + code)" "$M" "phase-2,backend" "GroupInvitation, SMTP email (mocked in tests), accept by token/code, pending-invite for non-users. AC: integration invite→accept; e2e by code. Spec §4.2/§5.3."
mk "2.4 — Account sharing & permissions" "$M" "phase-2,backend,security" "AccountShare, permissions.service (listVisibleForUser, WRITE checks), share UI. AC: user B sees shared acct, respects READ/WRITE. Spec §5.4."

# ----- Phase 3 -----
M="Phase 3 — Categories, Rules & Manual Transactions"
mk "3.1 — Categories (user XOR group)" "$M" "phase-3,backend,frontend" "Model+migration, seed default sets fr/en, /app/categories hierarchical CRUD, XOR constraint. AC: unit XOR + e2e CRUD. Spec §4.4."
mk "3.2 — Transaction model + crypto integration" "$M" "phase-3,backend,security" "Transaction (encrypted label/rawLabel/note, HMAC hashes), TransactionSearchToken. AC: integration create tx writes tokens. Spec §4.5/§6.1/§6.2."
mk "3.3 — Categorization engine + learning" "$M" "phase-3,backend" "CategorizationRule model, categorization.service.suggest, 'create a rule?' dialog on recategorize. AC: unit all match types + priority; e2e recategorize→rule. Spec §5.6."
mk "3.4 — Transactions list + manual entry" "$M" "phase-3,frontend" "/app/transactions (day-grouped cards mobile / table desktop, Bilan), filters, HMAC search, inline category edit, manual entry form. AC: e2e search/filter/create/recategorize. Spec §5.5/§11.3."

# ----- Phase 4 -----
M="Phase 4 — Import Sources"
mk "4.1 — Manual entry form polish" "$M" "phase-4,frontend" "Full validation, account preselect (if not covered by 3.4). AC: e2e from account page. Spec §5.4."
mk "4.2 — CSV import" "$M" "phase-4,backend,frontend" "ImportBatch, /api/import/csv (upload/parse/mapping), preview UI, dedup (accountId,externalId), batch commit + tokens + categorization. AC: integration import + dedup re-import; e2e upload→preview→commit. Spec §5.5."
mk "4.3a — PDF parsing spike" "$M" "phase-4,backend" "Install pdf-parse, run on real bank PDFs in samples/, document structure. AC: findings note committed; parser approach decided. Spec §9."
mk "4.3b — PDF import" "$M" "phase-4,backend,frontend" "Parser from 4.3a, /api/import/pdf, same preview+dedup+categorization pipeline. AC: integration parse sample→tx; e2e upload→commit."

# ----- Phase 5 -----
M="Phase 5 — Reporting Views"
mk "5.1 — Dashboard (flagship)" "$M" "phase-5,frontend" "Editorial layout, month switcher, KPI row (income/expense/net + vs-prev), category donut (shadcn Charts), budget bars, recent tx. AC: e2e renders w/ seeded data, month nav. Spec §5.1/§11.3."
mk "5.2 — Custom periods" "$M" "phase-5,frontend,backend" "Date-range picker (presets+custom), reactive recompute across dashboard+transactions. AC: e2e presets; unit period math. Spec §5.2."

# ----- Phase 6 -----
M="Phase 6 — Transaction Links"
mk "6.1 — Link model + manual linking" "$M" "phase-6,backend,frontend" "TransactionLink, TransactionLinkMember, link-mode UI, one-link-per-tx. AC: unit primary/net-sum/balanced; e2e manual link. Spec §4.5/§5.8."
mk "6.2 — Auto suggestions" "$M" "phase-6,backend,frontend" "links.service.suggestPairs (±window/min amount from UserPreference), IgnoredLinkSuggestion, panel accept/ignore. AC: unit pairing; e2e accept + persisted ignore. Spec §5.8."
mk "6.3 — Link-aware totals" "$M" "phase-6,backend" "Balanced groups excluded; unbalanced → primary gets net sum; apply in dashboard+transactions. AC: integration totals with mixed links. Spec §5.7/§5.8."

# ----- Phase 7 -----
M="Phase 7 — Budgets"
mk "7.1 — Budget model + creation" "$M" "phase-7,backend,frontend" "Budget, BudgetLine (category and/or account), /app/budgets + new-budget modal (dynamic lines, computed total), user XOR group scope. AC: unit XOR+line validation; e2e create. Spec §4.6."
mk "7.2 — Budget calculation" "$M" "phase-7,backend" "computeLine (visible tx, period filter, INCLUDE/EXCLUDE, link-aware), status OK/WARN/OVER, detail page (Bilan). AC: integration matching+overrides+links. Spec §5.7."
mk "7.3 — Explicit assignment" "$M" "phase-7,backend,frontend" "BudgetAssignment (INCLUDE/EXCLUDE), assign-to-budget from any visible tx (incl. unshared acct→shared budget), group transparency. AC: e2e assign the owner's personal tx to the family budget; their partner sees it. Spec §5.7."
mk "7.4 — Recurring budgets" "$M" "phase-7,backend" "Auto-create next-period instance, parent/instance link. AC: integration rolling creates next instance. Spec §4.6."

# ----- Phase 8 -----
M="Phase 8 — Polish & Hardening"
mk "8.1 — Insights & charts" "$M" "phase-8,frontend" "/app/insights: category pie, monthly trend (shadcn Charts). AC: e2e renders. Spec §7.1(spec) / design."
mk "8.2 — Export (CSV + RGPD JSON) + account deletion" "$M" "phase-8,backend" "Filtered CSV export, full-user JSON export, account deletion (cascade + session invalidation). AC: integration export contents; e2e delete cascades. Spec §5.10."
mk "8.3 — Mobile fine-tuning + PWA" "$M" "phase-8,frontend,infra" "manifest.webmanifest, service worker (app-shell cache), splash/icons, responsive pass. AC: Lighthouse PWA installable; e2e mobile flows. Spec §11 / design."
mk "8.4 — Audit log + admin settings UI" "$M" "phase-8,backend,frontend" "AuditLog on state mutations, /admin (auth-providers, SMTP, app-settings, audit viewer), 12-month purge cron. AC: integration audit entries; e2e admin edits hot-reload. Spec §6.8/§8.4/§8.8."
mk "8.5 — Security hardening (from spec §6.11, as triggered)" "$M" "phase-8,security,infra" "Encrypted DB backups script, optional 2FA-mandatory for admins, security email notifications. AC: per item. Spec §6.11."

echo "==> Done. Created 9 milestones + 38 issues."

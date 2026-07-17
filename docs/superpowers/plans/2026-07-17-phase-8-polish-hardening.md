# Phase 8 — Polish & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Bilan MVP with an insights page, RGPD data export/deletion, PWA installability + a mobile pass, an audit-log-complete admin settings area with a purge cron, security hardening (encrypted backups, CSP nonce, admin-mandatory 2FA, security emails), and unified Bilan-branded error pages.

**Architecture:** Each scope is an independent subsystem behind the existing App-Router + Server-Actions + thin-Route-Handler split. Pure logic and persistence stay in `src/server/services/*` (unit/integration tested); Server Actions / Route Handlers are thin wrappers; UI is server components + focused client islands. Insights reuse the Phase-5 `getDashboard` aggregation and the dependency-free SVG chart primitives. The audit log and admin settings reuse the existing `logEvent` + cached-settings + `invalidateAuthCache` machinery. Cron work runs as token-guarded Route Handlers triggered by host cron.

**Tech Stack:** Next 16 (App Router, Server Components + Server Actions + Route Handlers), Prisma 7 + MariaDB (`adapter-mariadb`), Better Auth (admin + twoFactor + passkey plugins), next-intl, `papaparse` (CSV unparse), Vitest (unit + integration) + Playwright (e2e, `chromium` + `mobile` projects). No new runtime charting dependency (reuse SVG primitives — see Design decision 1).

## Global Constraints

- **One scope = one GitHub issue = one branch `feature/8.x-...` = one PR → `develop`.** Run `npm run ci` before every PR (`DATABASE_URL=mysql://app:app_password@localhost:3307/budget_test`); GPG-sign commits. PR body: `Closes #<issue>` + one **type** label (`enhancement`/`bug`/`infra`/`security`) + `phase-8` + `frontend`/`backend` as applicable. See `[[feedback_pr_labels]]`.
- **npm** (not pnpm). Node 24. Commits: 1-line English conventional (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`). No co-authored-by.
- **Business logic lives in `src/server/services/*` (pure, tested).** Server Actions (`src/server/transport/actions/*`) and Route Handlers (`src/app/**/route.ts`, `runtime = "nodejs"`) are thin wrappers.
- **Encryption invariant:** anything touching `label`/`rawLabel`/`note`/`iban`/secrets goes through `@/server/crypto/encryption` (`encrypt`/`decrypt`) with `dataKey` from `@/server/crypto/keys`. Exports decrypt; never log plaintext or keys.
- **Dates are UTC**; reuse `@/lib/period` (`Period`, `parsePeriodParams`, `previousPeriod`, `toIsoDay`, `formatPeriodLabel`).
- **Money:** `Decimal(12,2)` in DB → `Number(...)` in JS; compare with a 0.005 epsilon; format with `Intl.NumberFormat(locale, { style: "currency", currency: "EUR" })`. Format UTC-bounded period dates with `timeZone: "UTC"` (avoids hydration mismatches — see `[[project_react-hooks-purity]]`).
- **No `Date.now()`/`Math.random()`/argless `new Date()` in a React render path** (ESLint `react-hooks/purity`, error, even in server components) — compute time-relative values in services and pass them as data. See `[[project_react-hooks-purity]]`.
- **RBAC:** admin pages gate on a permission via `requirePermission(key)` (`@/server/auth/permissions`). Seeded keys: `admin.settings.write`, `admin.users.read`, `admin.users.create`, `admin.signup_tokens.manage`, `admin.audit.read` (in `prisma/seed.ts`).
- **Audit:** every state-mutating service call ends with `logEvent({ userId, action, entity, entityId, metadata? })` (`@/server/services/audit`).
- **i18n:** all UI strings in `messages/{fr,en}.json`, both files kept in sync; server components use `getTranslations(ns)`, client use `useTranslations(ns)`.
- **e2e:** reuse the `owner@e2e.local`/`admin@e2e.local` storageStates; `test.skip(({ browserName }) => browserName === "webkit", ...)` for click-driven flows; wrap the first click of a freshly-loaded page in `await expect(async () => { … }).toPass()` (dev-server cold-compile race). After a Prisma migration, `docker compose restart app` so the dev server reloads the regenerated client. See `[[project_dev-e2e-ops]]`.

---

## Design decisions (read before starting)

1. **Insights charts reuse the SVG primitives, not Recharts.** The spec suggested shadcn Charts (Recharts), but the dashboard already ships dependency-free SVG `Donut`/`MiniBars` (`src/components/dashboard/charts.tsx`, explicitly "no recharts"). Scope 8.1 **extends those primitives** (adds a legend + hover tooltip) rather than pulling in a heavy charting dependency — consistent with the dashboard, zero bundle cost. (Deliberate deviation from the spec, confirmed with the user.)

2. **Insights reuse `getDashboard`, not a new aggregation.** `getDashboard(userId, period, previous)` already returns `byCategory` (per-category expense totals, desc) and `trace` (daily/monthly time series). The insights page is a richer, full-width presentation of that same data over a selectable period — no new service math, only a new view. If insights ever needs an aggregation the dashboard doesn't (e.g. income-by-category, top merchants), add it to `src/server/services/dashboard/index.ts` next to `getDashboard`.

3. **Downloads are Route Handlers (`runtime = "nodejs"`), not Server Actions.** CSV/JSON export must decrypt (needs the Node crypto runtime, like the import routes) and stream a file with `Content-Disposition`. Server Actions can't return a file download cleanly. Export lives at `src/app/api/export/{transactions,data}/route.ts`.

4. **RGPD service owns export + deletion (`src/server/services/rgpd/`).** `exportUserData(userId)` gathers the user's full graph (decrypting transactions); `deleteUser(userId, actor)` cascades via Prisma FKs, cleans the three **FK-less** columns (`TransactionLink.createdById`, `IgnoredLinkSuggestion.userId`, `AuditLog.userId`), revokes sessions, and writes an anonymous `AuditLog "user.deleted"` (userId null). Deletion is only ever self-service (the acting user deletes their own account) and requires a fresh password re-auth.

5. **PWA = native `app/manifest.ts` + a hand-authored `public/sw.js`.** Next 16 has no SW generator. `src/app/manifest.ts` emits `/manifest.webmanifest` (dotted path → bypasses the intl proxy). The service worker is `public/sw.js` (dotted path → root scope `/`, both locales), registered by a tiny client island in the root of the authenticated layout. App-shell cache only (cache-first for static assets, network-first for pages) — no offline data. Icons/splash added under `public/` + file-based `src/app/{icon,apple-icon}.png` and metadata in `[locale]/layout.tsx`.

6. **Cron jobs are token-guarded Route Handlers under `src/app/api/cron/*`, triggered by host cron.** No in-app scheduler. Two jobs: `POST /api/cron/purge-audit` (delete `AuditLog` older than 12 months) and `POST /api/cron/roll-budgets` (call `rollRecurring` for every ended recurring template with no next instance — the deferred Phase-7 automation). Both require header `Authorization: Bearer ${CRON_SECRET}` (new env var, optional; if unset the routes 404 so they're inert by default). Document the crontab lines in the scope.

7. **Admin settings CRUD reuses the existing service layer + hot-reload.** `upsertAuthProvider` / `upsertSmtp` / `appSettings.set` already exist; 8.4 adds (a) list-reads (`authProvider.findMany`, `getSmtpConfig`, typed app-settings getters), (b) thin Server Actions, (c) the admin pages, and (d) **fixes `appSettings.set` to audit + `invalidateAuthCache()`** (it currently does neither, so a registration-mode/min-password change silently doesn't hot-reload). An audit-log viewer page reads `AuditLog` (gated `admin.audit.read`).

8. **Error pages use Next's native interrupts.** Enable `experimental.authInterrupts` in `next.config.ts`; add root `not-found.tsx`, `error.tsx`, `global-error.tsx`, plus `forbidden.tsx`/`unauthorized.tsx`. Migrate `requirePermission` from `redirect("/403")` to `forbidden()` (correct 403 status), `requireSession` from `redirect("/login")` is kept (login is a real destination, not an error). A shared `ErrorShell` (centered Bilan card) backs every page. Under `[locale]` use `getTranslations`; `global-error.tsx` (root, no locale/provider) statically imports `messages/fr.json` (default locale) for its strings.

9. **CSP nonce (8.5) lands last and is validated hardest.** Tightening `script-src`/`style-src` to a per-request nonce (removing `'unsafe-inline'`/`'unsafe-eval'`) risks breaking Next's inline runtime + next-intl. Ship it behind a full e2e pass across representative pages; keep a documented rollback (the current loose CSP) in the PR body.

---

## File Structure

**Scope 8.1 — Insights & charts**
- Create: `src/app/[locale]/(authenticated)/insights/page.tsx` — server component (reuses `getDashboard`).
- Create: `src/components/insights/insights-view.tsx` — full-width donut + legend + trend, period nav.
- Modify: `src/components/dashboard/charts.tsx` — extend `Donut` with an optional `onSlice`/legend hook + a reusable `ChartLegend` and `TrendBars` (tooltip on hover); or add `src/components/insights/charts.tsx` if the dashboard ones shouldn't change. (Prefer extending in place.)
- Modify: `src/components/shell/nav-items.ts` — add `{ key: "insights", href: "/insights", icon: ChartPie }` to `WORKSPACE_NAV`.
- Modify: `messages/{fr,en}.json` — `shell.nav.insights` + `insights` namespace.
- Test: `tests/e2e/insights.spec.ts`. (Aggregation already unit/integration-covered by the dashboard tests; no new service test unless a new aggregation is added.)

**Scope 8.2 — Export (CSV + RGPD JSON) + account deletion**
- Create: `src/server/services/rgpd/index.ts` — `exportUserData`, `deleteUser`, `BUDGET`-style types.
- Create: `src/server/services/export/csv.ts` — `transactionsToCsv(rows)` (pure, `Papa.unparse`).
- Create: `src/app/api/export/transactions/route.ts` — filtered CSV download (`GET`).
- Create: `src/app/api/export/data/route.ts` — full RGPD JSON download (`GET`).
- Create: `src/server/transport/actions/account-data.ts` — `deleteAccountAction` (re-auth + delete + logout).
- Create: `src/app/[locale]/(authenticated)/settings/data/page.tsx` — export buttons + danger-zone delete.
- Create: `src/components/settings/data-controls.tsx` — client island (download links, delete dialog with password).
- Modify: `messages/{fr,en}.json` — `settings.data` namespace.
- Test: `tests/unit/services/export-csv.test.ts`, `tests/integration/rgpd.test.ts`, `tests/e2e/account-data.spec.ts`.

**Scope 8.3 — Mobile fine-tuning + PWA**
- Create: `src/app/manifest.ts` — `MetadataRoute.Manifest`.
- Create: `public/sw.js` — app-shell service worker.
- Create: `public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png` (+ `src/app/icon.png`, `src/app/apple-icon.png`).
- Create: `src/components/pwa/register-sw.tsx` — client island registering `/sw.js`.
- Create: `src/hooks/use-is-mobile.ts` — extract the inline hook (shared).
- Modify: `src/app/[locale]/layout.tsx` — `viewport` (themeColor per scheme), `metadata.manifest`, apple-web-app meta, mount `<RegisterSw/>` inside the authenticated layout.
- Modify: `src/components/transactions/transaction-list.tsx` — use the shared `useIsMobile`.
- Modify: mobile bottom-sheet conversions flagged in specs (`accounts`, `groups` dialogs) — responsive `Sheet`/`Dialog`.
- Modify: `tests/e2e/shell.spec.ts` — re-enable the skipped bottom-nav test; add PWA manifest/SW assertions.
- Modify: `messages/{fr,en}.json` — any new mobile strings (minimal).
- Test: `tests/e2e/pwa.spec.ts` (manifest + SW), plus the re-enabled mobile shell tests.

**Scope 8.4 — Audit log + admin settings UI**
- Modify: `src/server/services/settings/app-settings.ts` — `set()` audits + `invalidateAuthCache()`; add typed getters.
- Create: `src/server/services/settings/auth-providers.ts` — add `listAuthProviders()` (read incl. disabled).
- Create: `src/server/transport/actions/settings.ts` — `upsertAuthProviderAction`, `upsertSmtpAction`, `setAppSettingAction`.
- Create: `src/server/services/audit.ts` — add `listAuditLog(filter)` + `purgeAuditOlderThan(date)`.
- Create: `src/app/[locale]/(authenticated)/admin/auth-providers/page.tsx`, `admin/smtp/page.tsx`, `admin/app-settings/page.tsx`, `admin/audit/page.tsx`.
- Create: `src/components/admin/{auth-provider-form,smtp-form,app-settings-form,audit-table}.tsx`.
- Create: `src/app/api/cron/purge-audit/route.ts`, `src/app/api/cron/roll-budgets/route.ts`.
- Modify: `src/app/[locale]/(authenticated)/admin/layout.tsx` — add nav links (settings + audit).
- Modify: audit gaps — add missing `logEvent` calls (`auth.logout`, `auth.session.revoked`, `user.deleted`, `user.role.*`, `settings.registration_mode.update`).
- Modify: `src/server/services/budgets/index.ts` — export `listRollableTemplates()` for the roll cron (or reuse existing queries).
- Modify: `src/env.ts` — add optional `CRON_SECRET`.
- Modify: `messages/{fr,en}.json` — `admin.*` namespaces.
- Test: `tests/integration/admin-settings.test.ts`, `tests/integration/audit-purge.test.ts`, `tests/integration/cron-roll-budgets.test.ts`, `tests/e2e/admin-settings.spec.ts`.

**Scope 8.5 — Security hardening**
- Create: `scripts/backup.sh` — encrypted `mysqldump` (openssl AES-256) + restore note; `package.json` `db:backup`.
- Create: `src/app/[locale]/(authenticated)/settings/security/page.tsx` + `src/components/settings/two-factor-controls.tsx` — 2FA enrol/disable (better-auth client).
- Modify: `src/server/auth/permissions.ts` — `requireAdmin2fa()` gate; wire into the authenticated layout for admin users when the setting is on.
- Modify: `prisma/seed.ts` — new `AppSetting` `security.admin_2fa_required` (default false); new permission `admin.security.write` if a settings toggle page is added (optional).
- Create: `src/server/services/mail/security-notifications.ts` — `notifyNewLogin`, `notifyPasswordChanged` (via `sendMail`).
- Modify: auth lifecycle hooks (`src/server/auth/index.ts` databaseHooks / `src/server/transport/actions/auth.ts`) — call the notifications + fill audit gaps (`auth.password.changed`).
- Modify: `src/proxy.ts` — strict CSP with per-request nonce (`script-src 'self' 'nonce-…'`, drop `'unsafe-inline'`/`'unsafe-eval'`), pass nonce to the app.
- Modify: `src/app/[locale]/layout.tsx` — consume the nonce for any inline script/style (next-intl/theme bootstrap).
- Modify: `messages/{fr,en}.json` — `settings.security` namespace.
- Test: `tests/unit/services/security-notifications.test.ts`, `tests/integration/two-factor-enforcement.test.ts`, `tests/e2e/security-headers.spec.ts`, `tests/e2e/settings-security.spec.ts`.

**Scope 8.6 — Unified error pages (4XX/5XX)**
- Modify: `next.config.ts` — `experimental.authInterrupts: true`.
- Create: `src/components/shell/error-shell.tsx` — shared centered Bilan card (status, title, message, action link).
- Create: `src/app/[locale]/(authenticated)/forbidden.tsx`, `.../unauthorized.tsx`, `.../not-found.tsx`, `.../error.tsx` (locale-scoped, `getTranslations`).
- Create: `src/app/not-found.tsx` (root 404 for unmatched top-level), `src/app/global-error.tsx` (root 500, static `messages/fr.json`).
- Modify: `src/app/[locale]/403/page.tsx` — reuse `ErrorShell` (or delete once `forbidden()` covers it — keep a redirect for back-compat if any external link exists; grep shows only `requirePermission` uses it).
- Modify: `src/server/auth/permissions.ts` — `requirePermission` → `forbidden()`; add a helper that throws `unauthorized()` where appropriate.
- Modify: `src/proxy.ts` — harmonize the plain-text 404 (return the Bilan 404 HTML or a JSON with the right shape; document the choice).
- Modify: `messages/{fr,en}.json` — `errors` namespace (`notFound`, `serverError`, `forbidden`, `unauthorized`, each `title`/`message`/`back`).
- Test: `tests/e2e/error-pages.spec.ts` (404 + 403 render the Bilan shell with the right HTTP status).

---

## Task 8.1 — Insights & charts

**Branch:** `feature/8.1-insights`
**Goal:** A `/insights` page showing a category donut (with legend) and a spend trend over a selectable period, reusing `getDashboard` + the SVG chart primitives. Add the nav entry.

**Interfaces:**
- Consumes: `getDashboard(userId, period, previous)` → `{ totals, previous, byCategory: {categoryId, amount}[], trace: {granularity, points:{date,amount}[], avg, peak}, recent }` from `@/server/services/dashboard`; `parsePeriodParams`, `previousPeriod`, `formatPeriodLabel` from `@/lib/period`; `listForUser` (categories) from `@/server/services/categories`; `Donut`/`MiniBars` from `@/components/dashboard/charts`; `PeriodNav`/`PeriodPicker` from `@/components/dashboard/period-nav`.
- Produces: an `insights` route + nav entry (no exported service API).

### Step 1: Read the reference implementation

- [ ] **Step 1** — Read `src/app/[locale]/(authenticated)/dashboard/page.tsx`, `src/components/dashboard/dashboard-view.tsx`, `src/components/dashboard/charts.tsx`, and `src/components/dashboard/period-nav.tsx`. Note how `byCategory` is mapped to donut slices (category color via `catById.get(id)?.color ?? DEFAULT_COLOR`), how `trace.points` feeds `MiniBars`, and how the period is read from `searchParams` and navigated.

### Step 2: Add the `insights` nav entry + i18n

- [ ] **Step 2** — In `src/components/shell/nav-items.ts`, import `ChartPie` from `lucide-react` and add `{ key: "insights", href: "/insights", icon: ChartPie }` to `WORKSPACE_NAV` (after `dashboard`). Add `"insights": "Analyses"` (fr) / `"Insights"` (en) under `shell.nav` in both message files. Add a new top-level `insights` namespace: `{ "overline": "Analyses", "pageTitle": "Analyses", "byCategory": "Par catégorie", "trend": "Tendance", "noData": "Pas de données sur cette période." }` (en mirror: "Insights"/"Insights"/"By category"/"Trend"/"No data for this period.").

### Step 3: Extend the chart primitives (legend + trend tooltip)

- [ ] **Step 3** — In `src/components/dashboard/charts.tsx`, add two exports reused by insights (keep the existing `Donut`/`MiniBars` API unchanged so the dashboard is unaffected):

```tsx
export function ChartLegend({
  items,
}: {
  items: { label: string; value: string; color: string }[];
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-sm">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
          <span className="min-w-0 flex-1 truncate">{it.label}</span>
          <span className="text-muted-foreground tabular-nums">{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

// Bars with an accessible per-bar title (native tooltip) — no JS charting dep.
export function TrendBars({
  points,
  format,
}: {
  points: { date: string; amount: number; label: string }[];
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.amount)));
  return (
    <div className="flex h-40 items-end gap-1" data-slot="insights-trend">
      {points.map((p) => (
        <div
          key={p.date}
          title={`${p.label}: ${format(p.amount)}`}
          className="bg-primary/70 hover:bg-primary min-w-0 flex-1 rounded-t transition-colors"
          style={{ height: `${Math.max(2, (Math.abs(p.amount) / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
```

### Step 4: Build the insights view

- [ ] **Step 4** — Create `src/components/insights/insights-view.tsx` (server component, mirror `DashboardView`'s props). Accept `{ data, period, categories, locale }`. Render: an overline + title header with `<PeriodNav>`; a two-column layout — left a `<Donut>` of `byCategory` expenses (slice color from the category map, others → `DEFAULT_COLOR`) with a center label of the total expense, right a `<ChartLegend>` of the top categories (name + EUR + color); below, a full-width `<TrendBars>` of `trace.points` (label each point via `formatPeriodLabel`-style day/month formatting, `timeZone: "UTC"`). Empty state (`byCategory.length === 0`) → `t("noData")`. Reuse `Intl.NumberFormat(locale, { style: "currency", currency: "EUR" })`.

### Step 5: Build the page

- [ ] **Step 5** — Create `src/app/[locale]/(authenticated)/insights/page.tsx` mirroring the dashboard page: `export const dynamic = "force-dynamic"`; `setRequestLocale(locale)`; `const user = await requireSession()`; parse the period from `searchParams` (`parsePeriodParams`, default current month via the same helper the dashboard uses); `const [data, tree] = await Promise.all([getDashboard(user.id, period, previousPeriod(period)), listForUser(user.id)])`; flatten categories to a `{id,name,color}` map; render `<InsightsView data={data} period={period} categories={...} locale={locale} />`.

### Step 6: Typecheck + CI

- [ ] **Step 6** — Run `npm run typecheck` → PASS. Run `DATABASE_URL=…3307… npm run ci` → PASS.

### Step 7: e2e

- [ ] **Step 7** — Create `tests/e2e/insights.spec.ts` (owner storageState, webkit skip). Navigate `/fr/insights`; wrap the first load in `toPass`; assert the heading (`getByRole("heading", { level: 1, name: /analyses/i })`) and the trend container (`page.locator('[data-slot="insights-trend"]')`) are visible. Run `npm run test:e2e -- insights --project=chromium` → PASS.

### Step 8: Commit, push, PR

- [ ] **Step 8** — Update `PLAN.md` (`- [x] 8.1`). Commit `feat: insights page (category donut + spend trend)`; push `feature/8.1-insights`; open PR `Closes #34` labels `enhancement,phase-8,frontend`.

---

## Task 8.2 — Export (CSV + RGPD JSON) + account deletion

**Branch:** `feature/8.2-export-rgpd`
**Goal:** Filtered CSV transaction export, full-user RGPD JSON export, and self-service account deletion (cascade + FK-less cleanup + session revoke + anonymous audit).

**Interfaces:**
- Consumes: `listTransactions(userId, filters)` and its `TransactionFilters`/`TransactionListItem` from `@/server/services/transactions`; `listForUser` (categories) from `@/server/services/categories`; `getCurrentUser`/`requireSession` from `@/server/auth/permissions`; `getAuth` from `@/server/auth`; `logEvent` from `@/server/services/audit`; `Papa` from `papaparse`; `db` from `@/server/db`.
- Produces: `transactionsToCsv(rows): string`; `exportUserData(userId): Promise<UserDataExport>`; `deleteUser(userId, actor): Promise<void>`; `deleteAccountAction(prev, formData)`.

### Step 1: Failing CSV unit test

- [ ] **Step 1** — Create `tests/unit/services/export-csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { transactionsToCsv } from "@/server/services/export/csv";

describe("transactionsToCsv", () => {
  it("writes a header row and one row per transaction with resolved names", () => {
    const csv = transactionsToCsv([
      { date: "2026-03-01", amount: -12.5, type: "CARD", label: "Café", accountName: "Courant", categoryName: "Food" },
      { date: "2026-03-02", amount: 1000, type: "TRANSFER", label: "Salaire", accountName: "Courant", categoryName: null },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("date,amount,type,label,account,category");
    expect(lines[1]).toContain("2026-03-01");
    expect(lines[1]).toContain("Café");
    expect(lines[2]).toContain("Salaire");
  });
});
```

### Step 2: Verify it fails, implement `transactionsToCsv`

- [ ] **Step 2** — Run `npm run test:unit -- export-csv` → FAIL. Create `src/server/services/export/csv.ts`:

```ts
import Papa from "papaparse";

export type CsvRow = {
  date: string;
  amount: number;
  type: string;
  label: string;
  accountName: string;
  categoryName: string | null;
};

// Pure: rows → RFC-4180 CSV with a stable header. No DB, no decryption (callers
// pass already-decrypted, display-ready rows).
export function transactionsToCsv(rows: CsvRow[]): string {
  return Papa.unparse(
    {
      fields: ["date", "amount", "type", "label", "account", "category"],
      data: rows.map((r) => [r.date, r.amount, r.type, r.label, r.accountName, r.categoryName ?? ""]),
    },
    { newline: "\n" },
  );
}
```

Run `npm run test:unit -- export-csv` → PASS. Commit `feat: transactionsToCsv (RGPD/CSV export serializer)`.

### Step 3: CSV export Route Handler

- [ ] **Step 3** — Create `src/app/api/export/transactions/route.ts` (mirror `src/app/api/import/csv/route.ts` conventions: `export const runtime = "nodejs"`, `getCurrentUser`, 401 JSON if null). Read filters from the URL query (`categoryId`, `dir`, `search`, `from`, `to` — same names as `/transactions`), call `listTransactions(user.id, { ...filters, take: 100000, skip: 0 })`, resolve category names via `listForUser` flattened to an id→name map, map to `CsvRow[]`, and return:

```ts
const csv = transactionsToCsv(rows);
return new Response(csv, {
  headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="bilan-transactions-${toIsoDay(new Date())}.csv"`,
  },
});
```

> `toIsoDay` is pure and takes a `Date` — pass a `Date` the handler creates (a Route Handler is not a React render path, so `new Date()` is allowed here). Guard the query dates with `parsePeriodParams` when both are present.

### Step 4: Failing RGPD integration test

- [ ] **Step 4** — Create `tests/integration/rgpd.test.ts`. Seed a user with an account, a category, a decryptable transaction (reuse `buildSecureFields` from `@/server/services/transactions/secure-fields`), a budget, and a group membership. Then:

```ts
import { exportUserData, deleteUser } from "@/server/services/rgpd";

it("exportUserData returns the user's accounts, decrypted transactions, categories, budgets", async () => {
  const data = await exportUserData(userId);
  expect(data.user.id).toBe(userId);
  expect(data.accounts).toHaveLength(1);
  expect(data.transactions[0].label).toBe("Loyer"); // decrypted
  expect(data.budgets.length).toBeGreaterThanOrEqual(1);
});

it("deleteUser cascades owned data, clears FK-less rows, revokes sessions, keeps an anonymous audit entry", async () => {
  await db.session.create({ data: { id: "s1", userId, token: "t1", expiresAt: new Date(Date.now() + 1e6) } });
  await deleteUser(userId, { id: userId });
  expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
  expect(await db.session.count({ where: { userId } })).toBe(0);
  expect(await db.bankAccount.count({ where: { ownerId: userId } })).toBe(0);
  const audit = await db.auditLog.findFirst({ where: { action: "user.deleted" }, orderBy: { createdAt: "desc" } });
  expect(audit?.userId).toBeNull(); // anonymous
});
```

> `new Date(Date.now() + 1e6)` in a **test** is fine (not a render path). Clean up in `afterAll`.

### Step 5: Verify it fails, implement the RGPD service

- [ ] **Step 5** — Run `DATABASE_URL=…3307… npm run test:integration -- rgpd` → FAIL. Create `src/server/services/rgpd/index.ts`:

```ts
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { getAuth } from "@/server/auth";

export type UserDataExport = {
  exportedAt: string;
  user: { id: string; email: string; name: string | null; createdAt: Date };
  preference: unknown;
  accounts: unknown[];
  transactions: { id: string; date: Date; amount: number; type: string; label: string; note: string | null; categoryId: string | null; accountId: string }[];
  categories: unknown[];
  rules: unknown[];
  budgets: unknown[];
  groups: unknown[];
  invitationsSent: unknown[];
  auditLog: unknown[];
};

export async function exportUserData(userId: string): Promise<UserDataExport> {
  const [user, preference, accounts, categories, rules, budgets, memberships, invitationsSent, auditLog] =
    await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, createdAt: true } }),
      db.userPreference.findUnique({ where: { userId } }),
      db.bankAccount.findMany({ where: { ownerId: userId } }),
      db.category.findMany({ where: { userId } }),
      db.categorizationRule.findMany({ where: { userId } }),
      db.budget.findMany({ where: { userId }, include: { lines: true, assignments: true } }),
      db.groupMember.findMany({ where: { userId }, include: { group: true } }),
      db.groupInvitation.findMany({ where: { invitedById: userId } }),
      db.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5000 }),
    ]);

  const accountIds = accounts.map((a) => a.id);
  const txRows = accountIds.length
    ? await db.transaction.findMany({ where: { accountId: { in: accountIds } }, orderBy: { date: "desc" } })
    : [];
  const transactions = txRows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    type: r.type,
    label: decrypt(r.labelEnc, dataKey),
    note: r.noteEnc ? decrypt(r.noteEnc, dataKey) : null,
    categoryId: r.categoryId,
    accountId: r.accountId,
  }));

  return {
    exportedAt: new Date().toISOString(),
    user,
    preference,
    accounts,
    transactions,
    categories,
    rules,
    budgets,
    groups: memberships,
    invitationsSent,
    auditLog,
  };
}

// Self-service deletion. The caller must be the user themselves (enforced in the action).
export async function deleteUser(userId: string, actor: { id: string }): Promise<void> {
  // FK-less columns that Prisma cascade does not reach — clean explicitly first.
  await db.transactionLink.deleteMany({ where: { createdById: userId } });
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId } });
  // Anonymise the user's audit trail rather than delete it (retention), then keep
  // a single anonymous "user.deleted" marker.
  await db.auditLog.updateMany({ where: { userId }, data: { userId: null } });

  // Cascade: User → accounts → transactions/links/tokens/importbatches/budgetlines,
  // categories, budgets, rules, memberships, sessions, authAccounts, twoFactors,
  // passkeys, preference (all onDelete: Cascade on userId/ownerId).
  await db.user.delete({ where: { id: userId } });

  await logEvent({ userId: null, action: "user.deleted", entity: "User", entityId: userId, metadata: { self: true } });
}
```

Run the integration test → PASS. Commit `feat: rgpd service (exportUserData + deleteUser)`.

### Step 6: RGPD JSON export Route Handler

- [ ] **Step 6** — Create `src/app/api/export/data/route.ts` (`runtime = "nodejs"`, `getCurrentUser` → 401): `const data = await exportUserData(user.id);` return `new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="bilan-data-export.json"' } })`.

### Step 7: Delete-account action (re-auth)

- [ ] **Step 7** — Create `src/server/transport/actions/account-data.ts`:

```ts
"use server";
import { requireSession } from "@/server/auth/permissions";
import { getAuth } from "@/server/auth";
import { headers as nextHeaders } from "next/headers";
import { deleteUser } from "@/server/services/rgpd";

export type AccountDataState = { ok: true } | { ok: false; error: string } | null;

export async function deleteAccountAction(_prev: AccountDataState, formData: FormData): Promise<AccountDataState> {
  const user = await requireSession();
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "INVALID" };
  const auth = await getAuth();
  // Re-authenticate: verify the password by attempting a sign-in for this email.
  try {
    await auth.api.signInEmail({ body: { email: user.email, password }, headers: await nextHeaders() });
  } catch {
    return { ok: false, error: "BAD_PASSWORD" };
  }
  await deleteUser(user.id, { id: user.id });
  return { ok: true };
}
```

> After `{ ok: true }` the client redirects to `/` (the session rows are gone). Confirm the exact Better Auth re-auth API in `src/server/auth/index.ts`/`auth-client.ts`; if `signInEmail` isn't exposed server-side, verify via the credentials provider path used at login and adapt.

### Step 8: Settings/data page + UI

- [ ] **Step 8** — Create `src/app/[locale]/(authenticated)/settings/data/page.tsx` (`force-dynamic`, `requireSession`, `setRequestLocale`) rendering `<DataControls/>`. Create `src/components/settings/data-controls.tsx` (client): two download links (`<a href="/api/export/transactions" download>` and `/api/export/data`), and a **danger zone** — a destructive `Dialog` with a password `<input>` that posts `deleteAccountAction` via `useTransition`; on `{ ok: true }` call `window.location.assign("/${locale}")`. i18n `settings.data`: `title`, `exportCsv`, `exportJson`, `dangerZone`, `deleteTitle`, `deleteWarning`, `passwordLabel`, `confirmDelete`, `error.{INVALID,BAD_PASSWORD,FAILED}`.

### Step 9: Wire the settings nav + CI + e2e + PR

- [ ] **Step 9** — Add a `/settings/data` entry to the account nav (if a settings nav exists; otherwise link from a `/settings` index — check `ACCOUNT_NAV` in `nav-items.ts` and the note that `/settings` isn't built yet, so add a minimal `settings` section or link directly). Run `npm run ci` → PASS. Create `tests/e2e/account-data.spec.ts`: as owner, GET `/api/export/transactions` returns 200 + `text/csv` (use `page.request.get`); assert the data page renders the danger zone. (Do NOT e2e the actual deletion against the shared owner fixture — cover deletion by the integration test.) Update `PLAN.md` (`- [x] 8.2`), commit `feat: data export + account deletion (RGPD)`, PR `Closes #35` labels `enhancement,phase-8,backend,frontend`.

---

## Task 8.3 — Mobile fine-tuning + PWA

**Branch:** `feature/8.3-pwa-mobile`
**Goal:** Installable PWA (manifest, icons, app-shell service worker, theme-color) + a responsive pass converting the remaining desktop-only dialogs to mobile bottom-sheets, and re-enabling the deferred mobile e2e.

**Interfaces:**
- Consumes: `MetadataRoute.Manifest` from `next`; the theme tokens (`--bilan-primary`, `--paper`); the `mobile` Playwright project.
- Produces: `/manifest.webmanifest`, `/sw.js`, `useIsMobile()` shared hook, `<RegisterSw/>`.

### Step 1: Web app manifest

- [ ] **Step 1** — Create `src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bilan",
    short_name: "Bilan",
    description: "Self-hosted multi-user personal finance app",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f4ed",
    theme_color: "#1f4d3a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

### Step 2: Icons

- [ ] **Step 2** — Add PNG icons under `public/icons/` (`icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png`) and `src/app/icon.png` + `src/app/apple-icon.png` (file-based metadata). Generate from the Bilan wordmark/green (`#1f4d3a` on `#f7f4ed`); if design assets aren't available, create simple square icons with the "B" glyph — document the source. (These are binary assets; commit them.)

### Step 3: Layout metadata (viewport, theme-color, apple-web-app, manifest link)

- [ ] **Step 3** — In `src/app/[locale]/layout.tsx`, add:

```ts
import type { Viewport } from "next";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ed" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1114" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
```

Extend `metadata` with `manifest: "/manifest.webmanifest"`, `appleWebApp: { capable: true, statusBarStyle: "default", title: "Bilan" }`, and `icons: { icon: "/icon.png", apple: "/apple-icon.png" }`.

### Step 4: Service worker (app-shell)

- [ ] **Step 4** — Create `public/sw.js` (plain JS, no build step):

```js
const CACHE = "bilan-shell-v1";
const ASSETS = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API / auth / dynamic data.
  if (url.pathname.startsWith("/api")) return;
  // Static assets → cache-first; pages → network-first (fallback to cache).
  const isStatic = /\.(?:css|js|png|svg|ico|webmanifest|woff2?)$/.test(url.pathname) || url.pathname.startsWith("/_next/static");
  if (isStatic) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })));
  } else {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
  }
});
```

> Bump `CACHE` (`-v2`, …) whenever the shell changes so old caches are evicted on `activate`.

### Step 5: Register the service worker

- [ ] **Step 5** — Create `src/components/pwa/register-sw.tsx`:

```tsx
"use client";
import { useEffect } from "react";

export function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return; // avoid caching the dev server
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
```

Mount `<RegisterSw/>` once in `src/app/[locale]/(authenticated)/layout.tsx` (inside the layout body). It's a client island with no props → no serialization concern.

### Step 6: Extract the shared `useIsMobile`

- [ ] **Step 6** — Create `src/hooks/use-is-mobile.ts` from the inline function in `transaction-list.tsx:53` (SSR-safe: initialize `false`, set on mount via a `matchMedia("(max-width: 767px)")` listener — this is a client hook, `window` guarded). Replace the inline usage in `transaction-list.tsx` with the import. (Watch the `react-hooks/set-state-in-effect` rule — subscribe in `useEffect` and set from the listener, don't set synchronously in the effect body; see the budget-detail lazy-fetch precedent.)

### Step 7: Mobile bottom-sheet pass

- [ ] **Step 7** — Convert the dialogs flagged as "deferred to Phase 8.3" to responsive bottom-sheets on mobile using `useIsMobile()` + the `Sheet` (`side="bottom"`) vs `Dialog` pattern already used in `transaction-detail.tsx`. Targets: the account create/edit dialog (`accounts.spec.ts:6` note) and the group dialogs (`groups.spec.ts:6` note). Keep desktop as centered `Dialog`. Verify each still passes its existing chromium e2e.

### Step 8: Re-enable mobile e2e + PWA e2e

- [ ] **Step 8** — In `tests/e2e/shell.spec.ts`, un-skip the "bottom nav visible on mobile" test (it asserts `getByRole("navigation", { name: /bottom/i })` under the `mobile` project). Create `tests/e2e/pwa.spec.ts`: `page.request.get("/manifest.webmanifest")` → 200 + `application/manifest+json` (or `application/json`), body has `name: "Bilan"` and `display: "standalone"`; `page.request.get("/sw.js")` → 200 + JS content-type. (SW registration itself is prod-only; assert the file is served, not that it registers in dev.)

### Step 9: CI + PR

- [ ] **Step 9** — Run `npm run ci` → PASS; `npm run test:e2e -- --project=mobile` for the shell test → PASS. Update `PLAN.md` (`- [x] 8.3`), commit `feat: PWA (manifest, service worker, icons) + mobile bottom-sheets`, PR `Closes #36` labels `enhancement,phase-8,frontend`.

---

## Task 8.4 — Audit log + admin settings UI

**Branch:** `feature/8.4-admin-audit`
**Goal:** Complete the audited events, add the admin settings pages (auth-providers, SMTP, app-settings) with hot-reload + an audit-log viewer, and add the two token-guarded cron routes (audit purge + recurring-budget roll).

**Interfaces:**
- Consumes: `upsertAuthProvider`/`upsertSmtp`/`getSmtpConfig` (`@/server/services/settings/*`), `appSettings` (`@/server/services/settings/app-settings`), `invalidateAuthCache` (`@/server/auth`), `logEvent`/(new)`listAuditLog`/`purgeAuditOlderThan` (`@/server/services/audit`), `requirePermission` (`@/server/auth/permissions`), `rollRecurring` (`@/server/services/budgets`).
- Produces: `listAuthProviders()`, `listAuditLog(filter)`, `purgeAuditOlderThan(date)`, `listRollableTemplates()`, the three settings actions, four admin pages, two cron routes.

### Step 1: Fix `appSettings.set` (audit + hot-reload) — failing test

- [ ] **Step 1** — Create `tests/integration/admin-settings.test.ts` with a first case asserting that `appSettings.set("app.registration_mode", "OPEN", actorId)` writes an `AuditLog` `settings.registration_mode.update` and that a subsequent `appSettings.get` reflects the new value. Run → FAIL (no audit currently).

### Step 2: Implement the fix

- [ ] **Step 2** — In `src/server/services/settings/app-settings.ts`, make `set(key, value, updatedById)` (a) upsert as today, (b) clear its cache entry, (c) call `invalidateAuthCache()` (import from `@/server/auth`) when the key affects auth (`credentials_enabled`, `min_password_length`, `registration_mode`), and (d) `await logEvent({ userId: updatedById, action: \`settings.${key.replace(/^app\./, "").replace(/_/g, "_")}.update\`, entity: "AppSetting", entityId: key, metadata: { value } })` — for `app.registration_mode` emit action `settings.registration_mode.update` exactly (spec §6.8). Run the test → PASS.

### Step 3: Read-side for the admin lists

- [ ] **Step 3** — Add `listAuthProviders(): Promise<AuthProvider[]>` to `src/server/services/settings/auth-providers.ts` (`db.authProvider.findMany({ orderBy: { displayName: "asc" } })` — includes disabled, unlike the enabled-only `providerCache`). `getSmtpConfig` already exists. Add typed getters for the known app-settings keys if not present.

### Step 4: Admin settings Server Actions

- [ ] **Step 4** — Create `src/server/transport/actions/settings.ts` with `upsertAuthProviderAction`, `upsertSmtpAction`, `setAppSettingAction` — each `requirePermission("admin.settings.write")`, parse the form, call the service, return `{ ok }`/`{ ok:false, error }`. (Password/clientSecret fields: only overwrite when non-empty, so editing without re-entering the secret keeps the stored one.)

### Step 5: Admin pages + forms

- [ ] **Step 5** — Create `admin/auth-providers/page.tsx` (list from `listAuthProviders`, an `<AuthProviderForm>` per provider + an add form), `admin/smtp/page.tsx` (`<SmtpForm>` prefilled from `getSmtpConfig`, password left blank), `admin/app-settings/page.tsx` (registration mode, min password length, app name — `<AppSettingsForm>`). Each page `await requirePermission("admin.settings.write")` at the top. Add the components under `src/components/admin/`. Add nav links in `admin/layout.tsx`. i18n under `admin.settings.*`.

### Step 6: Audit-log viewer

- [ ] **Step 6** — Add `listAuditLog(filter: { action?: string; entity?: string; userId?: string; take?: number; skip?: number }): Promise<{ items: AuditLog[]; total: number }>` to `src/server/services/audit.ts` (order `createdAt desc`, default `take: 50`). Create `admin/audit/page.tsx` (`await requirePermission("admin.audit.read")`) rendering `<AuditTable>` with filters (action/entity/date) in the query string. i18n `admin.audit.*`.

### Step 7: Fill the audit gaps

- [ ] **Step 7** — Add the missing `logEvent` calls (spec §6.8): `auth.logout` and `auth.session.revoked` (in the session-revoke action / logout path), `auth.password.changed` (password-change flow), `user.role.granted`/`user.role.revoked` (role-management service — add if the grant path lives in `users/roles.ts`), and confirm `user.deleted` (added in 8.2) and `settings.registration_mode.update` (added in Step 2) fire. Add an integration assertion per new event where a service path exists.

### Step 8: Cron — audit purge

- [ ] **Step 8** — Add `purgeAuditOlderThan(cutoff: Date): Promise<number>` to `src/server/services/audit.ts` (`db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })` → `count`). Add `CRON_SECRET` (optional) to `src/env.ts`. Create `src/app/api/cron/purge-audit/route.ts` (`runtime = "nodejs"`, `POST`): if `!env.CRON_SECRET` → `new Response(null, { status: 404 })`; else check `req.headers.get("authorization") === \`Bearer ${env.CRON_SECRET}\`` (401 otherwise); compute cutoff `new Date(Date.now() - 365 * 24 * 3600 * 1000)` (Route Handler → `Date.now()` allowed), call `purgeAuditOlderThan`, `logEvent({ userId: null, action: "audit.purged", metadata: { count } })`, return `Response.json({ purged: count })`. Integration test in `tests/integration/audit-purge.test.ts` (seed old + recent rows, assert only old deleted).

### Step 9: Cron — recurring-budget roll

- [ ] **Step 9** — Add `listRollableTemplates(): Promise<{ id: string }[]>` to `src/server/services/budgets/index.ts` (recurring budgets that are `ended` and whose next-period instance doesn't yet exist — reuse `nextPeriod` + the idempotency check already in `rollRecurring`). Create `src/app/api/cron/roll-budgets/route.ts` (same `CRON_SECRET` guard) that loops `listRollableTemplates()` and calls `rollRecurring(id, { id: <system> })` for each — but `rollRecurring` requires an actor with manage rights; add a `rollRecurringSystem(id)` variant that skips the actor check (system cron) and audits with `userId: null`. Integration test `tests/integration/cron-roll-budgets.test.ts` (an ended recurring budget → one instance created; idempotent on a second run). Document the crontab in the PR:

```cron
0 3 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/purge-audit
5 0 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/roll-budgets
```

### Step 10: CI + e2e + PR

- [ ] **Step 10** — Run `npm run ci` → PASS. Create `tests/e2e/admin-settings.spec.ts` (admin storageState): edit the app name in `/fr/admin/app-settings`, save, assert the success state; open `/fr/admin/audit` and assert a `settings.*` row appears. Update `PLAN.md` (`- [x] 8.4`), commit `feat: admin settings UI + audit viewer + purge/roll cron`, PR `Closes #37` labels `enhancement,phase-8,backend,frontend`.

---

## Task 8.5 — Security hardening

**Branch:** `feature/8.5-security`
**Goal:** Encrypted DB backup script, admin-mandatory 2FA (setting + enforcement + enrolment UI), security email notifications, and the strict CSP nonce.

**Interfaces:**
- Consumes: `sendMail` (`@/server/services/mail/mailer`), `appSettings` (`@/server/services/settings/app-settings`), `requireSession`/`hasPermission` (`@/server/auth/permissions`), the better-auth `twoFactor` client (`@/lib/auth-client`), `logEvent`.
- Produces: `scripts/backup.sh` + `db:backup`, `notifyNewLogin`/`notifyPasswordChanged`, `requireAdmin2fa`, a strict CSP with nonce.

### Step 1: Encrypted backup script

- [ ] **Step 1** — Create `scripts/backup.sh`: `mysqldump` the `budget` DB via `docker compose exec -T mariadb mariadb-dump -uapp -papp_password budget` piped to `openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE` into `backups/bilan-$(date +%F-%H%M).sql.enc`; refuse to run if `BACKUP_PASSPHRASE` is unset; print the restore command in a comment (`openssl enc -d … | docker compose exec -T mariadb mariadb …`). Add `"db:backup": "bash scripts/backup.sh"` to `package.json`. Add `backups/` to `.gitignore`. (No test — document a manual dry-run in the PR: run it, decrypt, confirm the dump head.)

### Step 2: Security email notifications — failing unit test

- [ ] **Step 2** — Create `tests/unit/services/security-notifications.test.ts` mocking `sendMail` (vi.mock `@/server/services/mail/mailer`) and asserting `notifyNewLogin({ email, ip, userAgent, at })` calls `sendMail` with a subject containing "connexion"/"login" and a body containing the IP. Run → FAIL.

### Step 3: Implement the notifications

- [ ] **Step 3** — Create `src/server/services/mail/security-notifications.ts` with `notifyNewLogin(input)` and `notifyPasswordChanged(input)` building a localized text body (default fr) and calling `sendMail`. Keep them best-effort (`sendMail` already no-ops when SMTP is disabled; never throw into the auth path — wrap in try/catch and `logEvent` on failure). Run the unit test → PASS. Commit.

### Step 4: Wire notifications into auth lifecycle

- [ ] **Step 4** — Call `notifyNewLogin` from the login-success path (`src/server/transport/actions/auth.ts`, next to the existing `auth.login.success` `logEvent`, passing the request IP/UA already captured there) and `notifyPasswordChanged` from the password-change/reset-completed path (also add the missing `auth.password.changed` audit event here — coordinates with 8.4 Step 7; whichever scope ships second skips the duplicate). Fire-and-forget (don't await in a way that blocks the response beyond what's acceptable; a short await is fine).

### Step 5: Admin-mandatory 2FA — setting + enrolment UI

- [ ] **Step 5** — Add an `AppSetting` `security.admin_2fa_required` (default `false`) — seed it in `prisma/seed.ts` alongside the other app settings. Create `src/app/[locale]/(authenticated)/settings/security/page.tsx` + `src/components/settings/two-factor-controls.tsx` (client) driving the better-auth `twoFactor` client (`enable`/`verifyTotp`/`disable` from `@/lib/auth-client`) — show the TOTP QR/secret on enable, verify a code, list/regenerate backup codes, and a disable button. i18n `settings.security.*`. Audit `auth.2fa.enabled`/`auth.2fa.disabled` on success (coordinates with §6.8).

### Step 6: Enforcement gate — failing integration test

- [ ] **Step 6** — Create `tests/integration/two-factor-enforcement.test.ts` around a pure predicate `requiresTwoFactorSetup({ isAdmin, twoFactorEnabled, settingOn })` → boolean (true only when `isAdmin && settingOn && !twoFactorEnabled`). Run → FAIL, then implement the predicate in `src/server/auth/permissions.ts` and a `requireAdmin2fa()` server helper that: resolves the session, checks `hasPermission(user.id, "admin.settings.write")` (proxy for "is admin"), reads `appSettings.get<boolean>("security.admin_2fa_required")`, and if `requiresTwoFactorSetup(...)` → `redirect("/${'fr'|locale}/settings/security")`. Wire `requireAdmin2fa()` into `admin/layout.tsx` (after the existing `requirePermission`). Run → PASS.

### Step 7: Strict CSP with per-request nonce

- [ ] **Step 7** — In `src/proxy.ts`, generate a per-request nonce (`crypto.randomUUID()`/`crypto.getRandomValues` — the proxy is not a React render, so this is allowed), set `script-src 'self' 'nonce-<n>' 'strict-dynamic'` and `style-src 'self' 'nonce-<n>'` (drop `'unsafe-inline'`/`'unsafe-eval'`), and pass the nonce to the app via a request header (`x-nonce`) so `[locale]/layout.tsx` can read it (`headers()`) and attach it to any inline `<script>`/`<style>` (next-intl/theme bootstrap). Test locally that the app still renders (no CSP violations in the console) across dashboard/transactions/insights/admin. Keep the previous loose CSP documented in the PR as the rollback.

> This is the riskiest step. If Next's inline runtime can't be nonce'd cleanly in this version, fall back to `script-src 'self' 'unsafe-inline'` for scripts but still tighten `style-src`, `object-src 'none'`, `base-uri 'self'`, and document the residual. Do not ship a policy that breaks the app.

### Step 8: CI + e2e + PR

- [ ] **Step 8** — Run `npm run ci` → PASS. Create `tests/e2e/security-headers.spec.ts` (assert the response carries `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and that pages render without console CSP errors) and `tests/e2e/settings-security.spec.ts` (the 2FA controls render). Update `PLAN.md` (`- [x] 8.5`), commit `feat: security hardening (encrypted backups, admin 2FA, security emails, CSP nonce)`, PR `Closes #38` labels `security,phase-8,backend,frontend`.

---

## Task 8.6 — Unified error pages (4XX/5XX)

**Branch:** `feature/8.6-error-pages`
**Goal:** Bilan-branded `not-found`/`error`/`global-error`/`forbidden`/`unauthorized` pages backed by a shared `ErrorShell`, with correct HTTP statuses, and a harmonized proxy 404.

**Interfaces:**
- Consumes: `getTranslations` (`next-intl/server`); static `messages/fr.json` for the root-level pages; the font/typography tokens.
- Produces: `ErrorShell` + the App-Router error files; `requirePermission` throwing `forbidden()`.

### Step 1: Enable auth interrupts

- [ ] **Step 1** — In `next.config.ts`, add `experimental: { authInterrupts: true }` (merge into the existing config object before the next-intl wrapper). Run `npm run dev` briefly to confirm it boots.

### Step 2: ErrorShell component

- [ ] **Step 2** — Create `src/components/shell/error-shell.tsx` (server-safe, no client hooks): a centered card mirroring the 403/auth pattern —

```tsx
import Link from "next/link";

export function ErrorShell({
  code,
  title,
  message,
  action,
}: {
  code: string;
  title: string;
  message: string;
  action?: { href: string; label: string };
}) {
  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-muted-foreground font-mono text-sm">{code}</p>
      <h1 className="font-display text-4xl">{title}</h1>
      <p className="text-muted-foreground max-w-md">{message}</p>
      {action && (
        <Link href={action.href} className="text-foreground mt-2 text-sm underline underline-offset-4">
          {action.label}
        </Link>
      )}
    </main>
  );
}
```

### Step 3: i18n `errors` namespace

- [ ] **Step 3** — Add an `errors` namespace to both message files: `notFound` (`title`/`message`), `serverError` (`title`/`message`/`retry`), `forbidden` (reuse existing `forbidden` copy), `unauthorized` (`title`/`message`), and `back` ("Retour au tableau de bord" / "Back to dashboard"). Keep the existing top-level `forbidden` block or fold it into `errors.forbidden` (update the `/403` page + any reference).

### Step 4: Locale-scoped error pages

- [ ] **Step 4** — Under `src/app/[locale]/(authenticated)/`, create `not-found.tsx`, `forbidden.tsx`, `unauthorized.tsx` (server components using `getTranslations("errors")` — note these don't receive `params`; use `getTranslations` which resolves the active request locale) and `error.tsx` (**client** component, `"use client"`, receives `{ error, reset }`, renders `ErrorShell` with a retry button calling `reset()`; strings via `useTranslations("errors")`). Each renders `<ErrorShell code=... title=... message=... action={{ href: "/dashboard", label: t("back") }} />`.

### Step 5: Root-level pages (outside locale context)

- [ ] **Step 5** — Create `src/app/not-found.tsx` (root — catches unmatched top-level paths; import `messages/fr.json` statically and render `ErrorShell` with the fr strings, since there's no locale/provider here) and `src/app/global-error.tsx` (`"use client"`, must render its own `<html><body>`; static fr strings; a reload button). Document that these use the default locale (fr) because they render outside `NextIntlClientProvider`.

### Step 6: Migrate `requirePermission` to `forbidden()`

- [ ] **Step 6** — In `src/server/auth/permissions.ts`, replace `redirect("/403")` in `requirePermission` with `forbidden()` (from `next/navigation`) → renders the nearest `forbidden.tsx` with a real HTTP 403. Keep `requireSession`'s `redirect("/login")` (login is a destination, not an error), OR, where an API/unauthenticated boundary should signal 401, use `unauthorized()`. Update `src/app/[locale]/403/page.tsx` to render `ErrorShell` (so any lingering `/403` link still looks right) or leave a thin redirect — grep confirms `requirePermission` was the only caller.

### Step 7: Harmonize the proxy 404

- [ ] **Step 7** — In `src/proxy.ts`, the plain-text `new Response("Not found", { status: 404 })` (setup-gating branch) — decide and document: either redirect to the app's not-found route or return a minimal Bilan-styled HTML 404. Keep it dependency-free (the proxy runs on the edge runtime); a small inline HTML string with the wordmark + 404 is acceptable. Preserve the 404 status.

### Step 8: e2e + CI + PR

- [ ] **Step 8** — Create `tests/e2e/error-pages.spec.ts`: (a) navigate to a bogus `/fr/does-not-exist`, assert the response status is 404 and the Bilan 404 heading renders; (b) un-skip / adapt `admin-guard.spec.ts` to assert a non-admin hitting `/fr/admin` gets the forbidden page with HTTP 403 (using the `member` storageState if it lacks admin perms). Run `npm run ci` → PASS; `npm run test:e2e -- error-pages --project=chromium` → PASS. Update `PLAN.md` (`- [x] 8.6`), commit `feat: unified Bilan error pages (404/500/403/401)`, PR `Closes #54` labels `enhancement,phase-8,frontend`.

---

## Self-Review notes (for the executor)

**Spec coverage (PLAN.md Phase 8 + spec §5.9/§5.10/§6.6/§6.8/§6.11):**
- 8.1 `/insights` category donut + trend → Task 8.1 (reuses `getDashboard` + SVG primitives; Design decision 1–2). AC: e2e renders.
- 8.2 filtered CSV + RGPD JSON export + account deletion (cascade + session invalidation) → Task 8.2 (spec §5.10). AC: integration export/delete + e2e CSV download.
- 8.3 manifest + service worker + icons + responsive pass → Task 8.3. AC: manifest/SW served, re-enabled mobile e2e.
- 8.4 audit completeness + admin settings hot-reload + 12-month purge cron (+ deferred recurring-roll cron) → Task 8.4 (spec §5.9, §6.8). AC: integration audit/purge + e2e admin edit.
- 8.5 encrypted backups + admin-mandatory 2FA + security emails + CSP nonce → Task 8.5 (spec §6.6, §6.11). AC: per item.
- 8.6 not-found/error/global-error/forbidden/unauthorized + ErrorShell + proxy 404 → Task 8.6. AC: right HTTP code + e2e 404/403.

**Type consistency:** `CsvRow` (export/csv) is produced by the transactions route and consumed by `transactionsToCsv`; `UserDataExport` (rgpd) is returned by `exportUserData` and serialized by the data route; `MetadataRoute.Manifest` matches `app/manifest.ts`; `listAuditLog`/`purgeAuditOlderThan`/`listRollableTemplates` are defined in the services and consumed by the admin pages + cron routes; `requiresTwoFactorSetup` (pure) backs `requireAdmin2fa`; `ErrorShell`'s `{ code, title, message, action }` props are used identically by every error page.

**Deliberate scope cuts (documented, not gaps):**
- **Charts**: SVG primitives reused instead of Recharts (Design decision 1) — a deliberate spec deviation confirmed with the user.
- **Cron**: token-guarded Route Handlers triggered by host cron, not an in-app scheduler (Design decision 6) — matches "no cron container" reality; crontab documented.
- **CSP nonce**: shipped with a documented rollback; if Next's inline runtime resists nonce'ing in this version, `style-src` still tightens and the residual is documented (Task 8.5 Step 7).
- **2FA enrolment UI** was noted in `plugins.ts` as "Phase 8.4"; this plan places it in 8.5 (security) next to the mandatory-2FA enforcement it pairs with.
- **Password-change audit + security email** touch the same auth path in 8.4 and 8.5 — whichever ships second skips the duplicate `logEvent`/handles the merge.

**Before each PR:** `git checkout develop && git pull`, delete merged branches, branch `feature/8.x-...`, `npm run ci` (test DB URL), GPG-sign, PR with `Closes #<issue>` + labels. 8.3 adds binary icon assets; 8.4/8.5 add `CRON_SECRET`/`BACKUP_PASSPHRASE`/`security.admin_2fa_required` — update `.env`/`.env.example` and the setup docs. 8.6 changes `next.config.ts` (`authInterrupts`) — restart the dev server. Any Prisma change (none expected in Phase 8 — all models already exist) would need `docker compose restart app`.

# Insights Differentiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Insights page's dashboard duplicate (donut + trend) with "what changed", top merchants and income-by-category blocks, and flag in-progress periods on Insights and the dashboard.

**Architecture:** Pure aggregation helpers in `src/lib/insights.ts` + `src/lib/merchant.ts` (unit-tested, no DB); a thin `getInsights` service next to `getDashboard` that reuses its `loadRows` (link collapse) and decrypts only the labels merchants need; a rewritten server-component view. The in-progress flag is computed in the page via `periodInProgress` (keeps `Date` out of the render).

**Tech Stack:** Next.js App Router (server components), Prisma/MariaDB, next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-insights-differentiation-design.md`

## Global Constraints

- Code, tests, comments in English; UI strings fr + en, both files edited together (CI does not check parity).
- Comments only for complex code or debated decisions, 1–3 lines.
- Client components must not value-import `@/server/*`; shared pure code lives in `src/lib/`.
- `react-hooks/purity`: no `Date.now()` / `new Date()` in render — time flags come from helpers with a `now` default, called in the page.
- Integration tests create their own fixtures (CI test DB is migrated, not seeded) and clean up only their own rows.
- Money: `Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 })`; dates UTC.
- Commits: one-line conventional English, GPG-signed, no co-authored-by.

## Review Focus

- Labels with no merchant left after stripping (`CB 12/03`) → skipped, never an empty-named row (Task 1 test `returns an empty key…`, Task 3 test `skips rows whose key is empty`).
- A category present only in the previous period (spent 0 now) → appears with `current: 0` and a negative diff, "−100 %" (Task 3 test `includes categories only present in the previous period`).
- `previous === 0` → "nouveau" instead of a division by zero / "Infinity %" (Task 5 view helper `pctLabel`).
- A period with income but no expense (or the reverse) → each block shows its own empty state, the page still renders (Task 5 view, empty checks per block).
- Linked balanced pair (purchase + refund) → excluded from changes and merchants (Task 4 integration test).

---

## File Structure

- Create `src/lib/merchant.ts` — `merchantKey`, `merchantLabel` (label normalization).
- Create `src/lib/insights.ts` — insights types + `categoryChanges`, `incomeByCategory`, `topMerchants`.
- Modify `src/lib/period.ts` — add `periodInProgress`.
- Modify `src/server/services/dashboard/index.ts` — export `loadRows`, opt-in `withLabels`, rows carry `type`/`labelEnc`.
- Create `src/server/services/dashboard/insights.ts` — `getInsights`.
- Create `src/components/insights/diverging-bar.tsx`, `src/components/dashboard/period-in-progress.tsx`.
- Rewrite `src/components/insights/insights-view.tsx`; modify `src/components/dashboard/dashboard-view.tsx`, `src/components/dashboard/charts.tsx` (drop `TrendBars`, `ChartLegend`).
- Modify both pages, `messages/{fr,en}.json`.
- Tests: `tests/unit/lib/merchant.test.ts`, `tests/unit/lib/insights.test.ts`, `tests/unit/lib/period.test.ts` (extend), `tests/integration/insights.test.ts`, `tests/e2e/insights.spec.ts` (rewrite).

---

### Task 1: `merchantKey` / `merchantLabel`

**Files:** Create `src/lib/merchant.ts`; Test `tests/unit/lib/merchant.test.ts`

**Interfaces:** Produces `merchantKey(label: string): string` (uppercase, accent-free, "" when nothing is left) and `merchantLabel(label: string): string` (same stripping, original casing).

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect } from "vitest";
import { merchantKey, merchantLabel } from "@/lib/merchant";

describe("merchantKey", () => {
  it.each([
    ["CB SUPERMARKET 02/04/26", "SUPERMARKET"],
    ["CB AMAZON EU 42,99", "AMAZON EU"],
    ["CB CARREFOUR CITY PARIS", "CARREFOUR CITY PARIS"],
    ["PRLV SEPA SFR", "SFR"],
    ["PRLV EDF ENERGIE", "EDF ENERGIE"],
    ["VIR SEPA SALAIRE", "SALAIRE"],
    ["VIREMENT JOHN DOE", "JOHN DOE"],
    ["PAIEMENT PAR CARTE FNAC 12/03", "FNAC"],
    ["CARTE X1234 12/03 CARREFOUR", "CARREFOUR"],
    ["cb  Café   de la Gare", "CAFE DE LA GARE"],
    ["Paiement reçu de JOHN DOE", "PAIEMENT RECU DE JOHN DOE"],
  ])("%s → %s", (label, key) => {
    expect(merchantKey(label)).toBe(key);
  });

  it("returns an empty key when only a prefix and a date are left", () => {
    expect(merchantKey("CB 12/03")).toBe("");
  });

  it("groups variants of the same merchant", () => {
    expect(merchantKey("CB LIDL 03/08/26")).toBe(merchantKey("CB LIDL 17/08/26 CARTE 4"));
  });
});

describe("merchantLabel", () => {
  it("strips like the key but keeps the casing", () => {
    expect(merchantLabel("cb  Café de la Gare 12/03")).toBe("Café de la Gare");
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/lib/merchant.test.ts` → FAIL (module not found).
- [ ] **Step 3: implement**

```ts
// Normalizes bank labels so one merchant's rows group together (spec §5):
// operation prefix, card ref, dates (and what follows) and trailing amounts/refs go.
const PREFIX = /^(PAIEMENT PAR CARTE|CARTE|CB|PRLV SEPA|PRLV|VIR SEPA|VIREMENT|VIR)\s+/i;
const LEADING_REF = /^(X\d{4}\s+)?(\d{2}\/\d{2}(\/\d{2,4})?\s+)?/i;
const DATE_AND_REST = /\s*\b\d{2}\/\d{2}(\/\d{2,4})?\b.*$/;
const TRAILING_REF = /(\s+X?\d[\d.,]*)+$/i;

export function merchantLabel(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .trim()
    .replace(PREFIX, "")
    .replace(LEADING_REF, "")
    .replace(DATE_AND_REST, "")
    .replace(TRAILING_REF, "")
    .trim();
}

export function merchantKey(label: string): string {
  return merchantLabel(label)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}
```

- [ ] **Step 4:** re-run → PASS.
- [ ] **Step 5:** commit `feat(insights): merchant label normalization (#107)`.

### Task 2: `periodInProgress`

**Files:** Modify `src/lib/period.ts`; Test `tests/unit/lib/period.test.ts`

**Interfaces:** Produces `periodInProgress(p: Period, now?: Date): boolean`.

- [ ] **Step 1: failing test** (append)

```ts
describe("periodInProgress", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  it("is true for the period containing now", () => {
    expect(periodInProgress(monthPeriod(2026, 9), now)).toBe(true);
  });
  it("is false for a past or future period", () => {
    expect(periodInProgress(monthPeriod(2026, 8), now)).toBe(false);
    expect(periodInProgress(monthPeriod(2026, 10), now)).toBe(false);
  });
  it("includes both bounds", () => {
    const p = monthPeriod(2026, 9);
    expect(periodInProgress(p, p.from)).toBe(true);
    expect(periodInProgress(p, p.to)).toBe(true);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/lib/period.test.ts` → FAIL.
- [ ] **Step 3: implement** (after `clampPeriodToNow`)

```ts
// True while `now` falls inside the period (its comparison with the full previous
// period is then partial — spec §7).
export function periodInProgress(p: Period, now: Date = new Date()): boolean {
  return p.from.getTime() <= now.getTime() && now.getTime() <= p.to.getTime();
}
```

- [ ] **Step 4:** re-run → PASS. **Step 5:** commit with Task 3 (same feature slice) or alone: `feat(period): periodInProgress helper (#107)`.

### Task 3: pure insights aggregations

**Files:** Create `src/lib/insights.ts`; Test `tests/unit/lib/insights.test.ts`

**Interfaces:**
- Consumes `merchantKey`, `merchantLabel` (Task 1), `round2` from `@/lib/budgets`.
- Produces types `CategoryChange`, `MerchantTotal`, `IncomeByCategory`, `InsightsData` (spec §4), `AmountRow = { amount: number; categoryId: string | null }`, `MerchantRow = AmountRow & { label: string; date: Date; type: string }`, and `categoryChanges(current: AmountRow[], previous: AmountRow[])`, `incomeByCategory(current, previous)`, `topMerchants(rows: MerchantRow[], limit: number)`.

- [ ] **Step 1: failing test**

```ts
import { describe, it, expect } from "vitest";
import { categoryChanges, incomeByCategory, topMerchants, type MerchantRow } from "@/lib/insights";

const d = (day: number) => new Date(Date.UTC(2026, 2, day));

describe("categoryChanges", () => {
  it("sorts by absolute diff and drops unchanged categories", () => {
    const cur = [{ amount: -700, categoryId: "rent" }, { amount: -50, categoryId: "food" }, { amount: -10, categoryId: "fun" }, { amount: 900, categoryId: "pay" }];
    const prev = [{ amount: -500, categoryId: "rent" }, { amount: -300, categoryId: "food" }, { amount: -10, categoryId: "fun" }];
    expect(categoryChanges(cur, prev)).toEqual([
      { categoryId: "food", current: 50, previous: 300, diff: -250 },
      { categoryId: "rent", current: 700, previous: 500, diff: 200 },
    ]);
  });

  it("includes categories only present in the previous period", () => {
    expect(categoryChanges([], [{ amount: -20, categoryId: null }])).toEqual([
      { categoryId: null, current: 0, previous: 20, diff: -20 },
    ]);
  });
});

describe("incomeByCategory", () => {
  it("keeps current income categories, highest first, with the previous amount", () => {
    const cur = [{ amount: 21, categoryId: "refund" }, { amount: 2650, categoryId: "pay" }, { amount: -5, categoryId: "pay" }];
    const prev = [{ amount: 2600, categoryId: "pay" }, { amount: 40, categoryId: "gift" }];
    expect(incomeByCategory(cur, prev)).toEqual([
      { categoryId: "pay", current: 2650, previous: 2600 },
      { categoryId: "refund", current: 21, previous: 0 },
    ]);
  });
});

describe("topMerchants", () => {
  const row = (label: string, amount: number, day: number, categoryId: string | null = "food", type = "CARD"): MerchantRow => ({ label, amount, date: d(day), categoryId, type });

  it("groups by normalized label with count, total and the latest label", () => {
    const out = topMerchants([row("CB LIDL 03/03/26", -40, 3), row("CB Lidl 17/03/26", -60, 17), row("PRLV FONCIA LOYER", -700, 5, "rent", "DIRECT_DEBIT")], 6);
    expect(out).toEqual([
      { label: "FONCIA LOYER", total: 700, count: 1, categoryId: "rent" },
      { label: "Lidl", total: 100, count: 2, categoryId: "food" },
    ]);
  });

  it("excludes income, transfers and rows whose key is empty", () => {
    expect(topMerchants([row("VIR LIVRET A", -200, 2, null, "TRANSFER"), row("REMB LIDL", 30, 4), row("CB 12/03", -9, 12)], 6)).toEqual([]);
  });

  it("picks the most frequent category, ties broken by spend", () => {
    const out = topMerchants([row("CB AMAZON", -10, 1, "books"), row("CB AMAZON", -12, 2, "books"), row("CB AMAZON", -90, 3, "tech")], 6);
    expect(out[0].categoryId).toBe("books");
    const tie = topMerchants([row("CB AMAZON", -10, 1, "books"), row("CB AMAZON", -90, 3, "tech")], 6);
    expect(tie[0].categoryId).toBe("tech");
  });

  it("limits the result", () => {
    const rows = ["A", "B", "C"].map((m, i) => row(`CB SHOP${m}`, -(i + 1), i + 1));
    expect(topMerchants(rows, 2).map((m) => m.label)).toEqual(["SHOPC", "SHOPB"]);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/lib/insights.test.ts` → FAIL.
- [ ] **Step 3: implement** `src/lib/insights.ts`

```ts
import { round2 } from "@/lib/budgets";
import { merchantKey, merchantLabel } from "@/lib/merchant";

export type CategoryChange = { categoryId: string | null; current: number; previous: number; diff: number };
export type MerchantTotal = { label: string; total: number; count: number; categoryId: string | null };
export type IncomeByCategory = { categoryId: string | null; current: number; previous: number };
export type InsightsData = {
  changes: CategoryChange[];
  merchants: MerchantTotal[];
  income: IncomeByCategory[];
  incomeTotal: number;
};

export type AmountRow = { amount: number; categoryId: string | null };
export type MerchantRow = AmountRow & { label: string; date: Date; type: string };

function sumByCategory(rows: AmountRow[], side: "expense" | "income"): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const r of rows) {
    if (side === "expense" ? r.amount >= 0 : r.amount <= 0) continue;
    out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + Math.abs(r.amount));
  }
  return out;
}

const byId = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");

export function categoryChanges(current: AmountRow[], previous: AmountRow[]): CategoryChange[] {
  const cur = sumByCategory(current, "expense");
  const prev = sumByCategory(previous, "expense");
  return [...new Set([...cur.keys(), ...prev.keys()])]
    .map((categoryId) => {
      const c = round2(cur.get(categoryId) ?? 0);
      const p = round2(prev.get(categoryId) ?? 0);
      return { categoryId, current: c, previous: p, diff: round2(c - p) };
    })
    .filter((x) => x.diff !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.diff) - Math.abs(a.diff) || b.current - a.current || byId(a.categoryId, b.categoryId),
    );
}

export function incomeByCategory(current: AmountRow[], previous: AmountRow[]): IncomeByCategory[] {
  const cur = sumByCategory(current, "income");
  const prev = sumByCategory(previous, "income");
  return [...cur.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      current: round2(amount),
      previous: round2(prev.get(categoryId) ?? 0),
    }))
    .sort((a, b) => b.current - a.current || byId(a.categoryId, b.categoryId));
}

type MerchantGroup = {
  total: number;
  count: number;
  latest: MerchantRow;
  byCategory: Map<string | null, { count: number; total: number }>;
};

// Transfers are excluded: unlinked internal moves ("VIR LIVRET A") would top the list.
export function topMerchants(rows: MerchantRow[], limit: number): MerchantTotal[] {
  const groups = new Map<string, MerchantGroup>();
  for (const r of rows) {
    if (r.amount >= 0 || r.type === "TRANSFER") continue;
    const key = merchantKey(r.label);
    if (!key) continue;
    const spend = -r.amount;
    const g = groups.get(key) ?? { total: 0, count: 0, latest: r, byCategory: new Map() };
    g.total += spend;
    g.count += 1;
    if (r.date > g.latest.date) g.latest = r;
    const c = g.byCategory.get(r.categoryId) ?? { count: 0, total: 0 };
    c.count += 1;
    c.total += spend;
    g.byCategory.set(r.categoryId, c);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const [categoryId] = [...g.byCategory.entries()].reduce((a, e) =>
        e[1].count > a[1].count || (e[1].count === a[1].count && e[1].total > a[1].total) ? e : a,
      );
      return { label: merchantLabel(g.latest.label), total: round2(g.total), count: g.count, categoryId };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, limit);
}
```

- [ ] **Step 4:** re-run → PASS.
- [ ] **Step 5:** commit `feat(insights): category changes, top merchants and income aggregations (#107)`.

### Task 4: `getInsights` service

**Files:** Modify `src/server/services/dashboard/index.ts`; Create `src/server/services/dashboard/insights.ts`; Test `tests/integration/insights.test.ts`

**Interfaces:**
- `loadRows(accountIds: string[], period: Period, opts?: { withLabels?: boolean }): Promise<{ rows: AggRow[]; count: number }>` — now exported; `AggRow` gains `type: string` and `labelEnc: string | null` (null unless `withLabels`).
- Produces `getInsights(userId: string, period: Period, previous: Period): Promise<InsightsData>` in `@/server/services/dashboard/insights`.

- [ ] **Step 1: failing integration test** — fixtures (own user/account/categories), March 2026 vs February 2026:
  - March: `CB CARREFOUR 02/03/26` −40 (food, CARD), `CB CARREFOUR 15/03/26` −10 (food, CARD), `PRLV FONCIA LOYER` −700 (rent, DIRECT_DEBIT), `VIR LIVRET A` −300 (null, TRANSFER), `VIR SALAIRE` +2000 (pay, TRANSFER), `CB FNAC` −50 (food, CARD) linked with `REMB FNAC` +50 (food, OTHER).
  - February: `PRLV FONCIA LOYER` −500 (rent), `CB FRANPRIX` −20 (food), `VIR SALAIRE` +1000 (pay).
  - Expect `changes` = `[{null, 300, 0, 300}, {rent, 700, 500, 200}, {food, 50, 20, 30}]`; `merchants` = `[{FONCIA LOYER, 700, 1, rent}, {CARREFOUR, 50, 2, food}]` (no LIVRET A, no FNAC); `income` = `[{pay, 2000, 1000}]`; `incomeTotal` = 2000.
  - Cleanup deletes only this user's links/transactions/categories/account/user.
- [ ] **Step 2:** `DATABASE_URL=… npx vitest run tests/integration/insights.test.ts` → FAIL.
- [ ] **Step 3: implement** — in `index.ts`: `AggRow = CollapsibleRow & { accountId: string; type: string; labelEnc: string | null }`; `loadRows` selects `type: true, labelEnc: withLabels` and maps `labelEnc: withLabels ? r.labelEnc : null`; `export` it. `insights.ts`:

```ts
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { listVisibleForUser } from "@/server/services/accounts";
import { round2 } from "@/lib/budgets";
import { categoryChanges, incomeByCategory, topMerchants, type InsightsData } from "@/lib/insights";
import type { Period } from "@/lib/period";
import { loadRows } from "./index";

const TOP_MERCHANTS = 6;

export async function getInsights(userId: string, period: Period, previous: Period): Promise<InsightsData> {
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);
  const [current, prev] = await Promise.all([
    loadRows(accountIds, period, { withLabels: true }),
    loadRows(accountIds, previous),
  ]);
  // Only the rows a merchant can come from are decrypted.
  const merchantRows = current.rows
    .filter((r) => r.amount < 0 && r.type !== "TRANSFER" && r.labelEnc)
    .map((r) => ({ amount: r.amount, categoryId: r.categoryId, date: r.date, type: r.type, label: decrypt(r.labelEnc!, dataKey) }));
  const income = incomeByCategory(current.rows, prev.rows);
  return {
    changes: categoryChanges(current.rows, prev.rows),
    merchants: topMerchants(merchantRows, TOP_MERCHANTS),
    income,
    incomeTotal: round2(income.reduce((s, i) => s + i.current, 0)),
  };
}
```

- [ ] **Step 4:** re-run integration + `tests/integration/dashboard.test.ts` → PASS.
- [ ] **Step 5:** commit `feat(insights): getInsights service (#107)`.

### Task 5: Insights view, in-progress warning, i18n, e2e

**Files:** Create `src/components/insights/diverging-bar.tsx`, `src/components/dashboard/period-in-progress.tsx`; Rewrite `src/components/insights/insights-view.tsx`; Modify `src/components/dashboard/dashboard-view.tsx`, `src/components/dashboard/charts.tsx`, both pages, `messages/{fr,en}.json`; Rewrite `tests/e2e/insights.spec.ts`.

**Interfaces:**
- `InsightsView({ data: InsightsData, period: Period, previous: Period, inProgress: boolean, categories: FlatCategory[], locale: string })`.
- `DashboardView` gains `previous: Period`, `inProgress: boolean`.
- `PeriodInProgress({ previousLabel: string })` — server component, `data-slot="period-in-progress"`.
- `DivergingBar({ value: number, max: number })`.

- [ ] **Step 1: e2e (failing)** — rewrite `insights.spec.ts`: seed a −35 expense on 2026-03-20 (as today), open `/fr/insights?from=2026-03-01&to=2026-03-31`, assert h1 "Analyses", `[data-slot="insights-changes"]` visible, `[data-slot="period-in-progress"]` count 0; then `/fr/insights` and `/fr/dashboard` (current month) → `period-in-progress` visible.
- [ ] **Step 2: i18n** — python json edit of both files: `insights` = `overline, pageTitle, noData, noCategory, biggestIncrease, biggestDecrease, noChange, changesOverline, changesTitle, changesSub {current} {previous}, merchantsOverline, merchantsTitle, merchantsCount {count}, noMerchants, incomeOverline, incomeTitle, incomeTotal {amount}, noIncome, new`; add `dashboard.periodInProgress {previous}` (wording spec §7); drop `byCategory, breakdown, evolution, trend, spentThisPeriod`.
- [ ] **Step 3: components** — `DivergingBar` (centre axis, expense tone right for increases, income tone left for decreases, width `|value|/max × 50 %`); `PeriodInProgress` (muted line, `Info` icon); `InsightsView` per spec §6 and mockup A (tiles from `changes.find(diff > 0)` / `changes.find(diff < 0)`, top 6 changes with `previous → current`, merchants rank/label/`category · N×`/total/bar, income stacked bar + rows with `=` / `+x %` / `nouveau`, `lg:grid-cols-2` for merchants + income, colors via `categorySliceColors`); dashboard view renders `PeriodInProgress` under its header when `inProgress`; remove `TrendBars` + `ChartLegend` from `charts.tsx`.
- [ ] **Step 4: pages** — both compute `const previous = previousPeriod(period)` and `const inProgress = periodInProgress(period)`; Insights calls `getInsights`.
- [ ] **Step 5:** `npm run ci` → PASS; `npx playwright test insights dashboard --project=chromium` → PASS; screenshot `/fr/insights` (dev@bilan.local, mobile + desktop) and compare with mockup A.
- [ ] **Step 6:** commit `feat(insights): what-changed, top merchants and income blocks + in-progress warning (#107)`; push; PR `Closes #107`, labels `enhancement,backend,frontend`.

# Phase 5 — Reporting Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A flagship monthly **dashboard** (`/dashboard`) — editorial header + period switcher, KPI row (income / expense / net, each vs the previous period), a spending-by-category donut, a day-by-day expense trace, and recent transactions — plus **custom-period** reporting (presets + custom range) that drives both the dashboard and the transactions list from the URL.

**Architecture:** A pure `src/lib/period.ts` computes `{from,to}` ranges (UTC, inclusive) for a month, the previous period, and presets — unit-tested, shared by the page and the transactions list. A `dashboard` service aggregates the visible accounts' transactions over a period (clear columns only — `amount`/`date`/`categoryId`; labels stay encrypted) into totals + by-category + daily + recent, plus the same totals for the previous period for deltas. The page is a Server Component reading `?from`/`?to` from the URL (default = current month); a small client `PeriodNav`/`PeriodPicker` updates those params, so recompute is a normal server re-render. Charts are dependency-free SVG ported from the design (`Donut`, `MiniBars`).

**Tech Stack:** Next 16 (App Router, Server Components), Prisma 7 + MariaDB, next-intl, Vitest + Playwright. Reuses Phase 2–4 services (`listVisibleForUser`, `listTransactions`, `flattenCategories`, the `bits` primitives, `Card`).

**Deferred (no data source yet — do NOT build in Phase 5):** the design's **Budgets snapshot** (budgets = Phase 7), **Upcoming/recurring** strip (Phase 7), **Links** and the household strip beyond what groups already expose, and the **Épargne** KPI (no savings concept). The dashboard ships with: header + period switcher, KPI row (3 KPIs), spending donut + breakdown, daily trace, recent transactions, and an accounts strip.

---

## Conventions reused from Phases 0–4 (read before starting)

- **One scope = one GitHub issue = one branch `feature/5.x-...` = one PR → `develop`.** Run `npm run ci` before every PR; GPG-sign commits (ask the user to unlock GPG if signing fails — per their global CLAUDE.md). PR body: `Closes #<issue>` + a type label (`enhancement`) plus phase/area labels.
- **No migration in this phase** (read-only reporting over existing models). No DB schema change.
- **Encryption:** never decrypt for aggregates — `amount`, `date`, `categoryId`, `type` are clear columns; only the "recent transactions" list decrypts labels (reuse `listTransactions`, which already does it). No plaintext in any aggregate query.
- **Server Components for reads** (spec §"Read (dashboard) → Server Component"): the dashboard and transactions pages render server-side; URL params (`from`/`to`) drive recompute. Period-switcher controls are thin client components that `router.push` new params.
- **Dates are UTC, inclusive ranges** `[from 00:00:00.000, to 23:59:59.999]` — matches how transactions store `date` (UTC midnight, see `csv-parse.normalizeDate`).
- **e2e** reuse the `owner@e2e.local` storageState; `test.skip(webkit)` for any dialog-based flow (Phase 8.3). The e2e DB is the dev DB (3306) via the reused dev server — see `[[project_dev-e2e-ops]]`.
- **Money formatting:** `new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" })`, `tabular-nums`, `var(--income)` for positive amounts (same as `transaction-list`).

---

## File Structure (created or modified in this phase)

**Scope 5.1 — Dashboard**
- Create: `src/lib/period.ts` — `Period`, `monthPeriod`, `addMonths`, `previousMonthPeriod`, `formatMonthLabel`, `parsePeriodParams` (pure).
- Create: `src/server/services/dashboard/index.ts` — `getDashboard(userId, period, previous)` → `DashboardData`.
- Create: `src/components/dashboard/charts.tsx` — `Donut`, `MiniBars` (SVG, client-safe, no deps).
- Create: `src/components/dashboard/dashboard-view.tsx` — the editorial layout (KPI cards, donut + breakdown, daily card, recent list, accounts strip). Client only where needed (charts are fine in a server component since they're pure SVG — keep them server-renderable by NOT marking `charts.tsx` `"use client"`).
- Create: `src/components/dashboard/period-nav.tsx` — client month prev/next + label, `router.push(?from&to)`.
- Modify: `src/app/[locale]/(authenticated)/dashboard/page.tsx` — replace the placeholder; fetch + render.
- Modify: `messages/{fr,en}.json` — `dashboard` namespace additions.
- Test: `tests/unit/lib/period.test.ts`, `tests/integration/dashboard.test.ts`, `tests/e2e/dashboard.spec.ts`.

**Scope 5.2 — Custom periods**
- Modify: `src/lib/period.ts` — add `PRESETS`, `presetPeriod`, `previousPeriod` (same-length window).
- Create: `src/components/dashboard/period-picker.tsx` — client preset segmented control + custom range inputs, `router.push(?from&to)`.
- Modify: `src/components/dashboard/dashboard-view.tsx` — use `PeriodPicker` instead of (or alongside) `PeriodNav`.
- Modify: `src/app/[locale]/(authenticated)/transactions/page.tsx` + `src/components/transactions/transaction-filters.tsx` — read `from`/`to` from the URL and add the period picker to the filter rail.
- Test: `tests/unit/lib/period.test.ts` (presets + previousPeriod), `tests/e2e/dashboard.spec.ts` (preset switch).

---

## Task 5.1 — Dashboard (flagship)

**Branch:** `feature/5.1-dashboard`
**Goal:** Replace the placeholder dashboard with the editorial flagship screen rendering real aggregates for the selected month, with month navigation. Budgets/upcoming/links deferred.

### Step 1: Write the failing period-lib test

- [ ] **Step 1** — Create `tests/unit/lib/period.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { monthPeriod, addMonths, previousMonthPeriod, parsePeriodParams } from "@/lib/period";

describe("monthPeriod", () => {
  it("returns the inclusive UTC bounds of a month", () => {
    const p = monthPeriod(2026, 2); // February 2026
    expect(p.from.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-02-28T23:59:59.999Z");
    expect(p.year).toBe(2026);
    expect(p.month).toBe(2);
  });
});

describe("addMonths", () => {
  it("moves month index, wrapping the year", () => {
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
});

describe("previousMonthPeriod", () => {
  it("returns the calendar month before a month period", () => {
    const prev = previousMonthPeriod(monthPeriod(2026, 3));
    expect(prev.from.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(prev.to.toISOString()).toBe("2026-02-28T23:59:59.999Z");
  });
});

describe("parsePeriodParams", () => {
  it("parses from/to ISO days into a custom period", () => {
    const p = parsePeriodParams({ from: "2026-01-10", to: "2026-01-20" });
    expect(p.from.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-01-20T23:59:59.999Z");
    expect(p.month).toBeNull(); // not a whole-month period
  });

  it("falls back to a given current month when params are absent/invalid", () => {
    const p = parsePeriodParams({}, { year: 2026, month: 5 });
    expect(p.month).toBe(5);
    expect(p.from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });
});
```

### Step 2: Run to verify it fails

- [ ] **Step 2** — Run: `npm run test:unit -- period`
Expected: FAIL — `Cannot find module '@/lib/period'`.

### Step 3: Implement `src/lib/period.ts`

- [ ] **Step 3** — Create `src/lib/period.ts`:

```typescript
// A reporting window. `year`/`month` (1-12) are set only when the window is a
// whole calendar month (enables month navigation + a "vs previous month" delta);
// for custom ranges they are null. All bounds are UTC and inclusive.
export type Period = {
  from: Date;
  to: Date;
  year: number | null;
  month: number | null;
};

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Whole calendar month, month is 1-12.
export function monthPeriod(year: number, month: number): Period {
  const last = daysInMonth(year, month);
  return {
    from: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year, month - 1, last, 23, 59, 59, 999)),
    year,
    month,
  };
}

// Shifts a {year, month} by `delta` months, wrapping the year.
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

// The calendar month before a month period (for the "vs previous" delta).
export function previousMonthPeriod(p: Period): Period {
  const y = p.year ?? p.from.getUTCFullYear();
  const m = p.month ?? p.from.getUTCMonth() + 1;
  const prev = addMonths(y, m, -1);
  return monthPeriod(prev.year, prev.month);
}

// Inclusive UTC bounds for an arbitrary ISO-day range.
function customPeriod(fromDay: string, toDay: string): Period {
  return {
    from: new Date(`${fromDay}T00:00:00.000Z`),
    to: new Date(`${toDay}T23:59:59.999Z`),
    year: null,
    month: null,
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Resolves the active period from URL params. `?from`/`?to` (ISO days) define a
// custom range; otherwise fall back to `fallbackMonth` (defaults to "now" UTC).
export function parsePeriodParams(
  params: { from?: string; to?: string },
  fallbackMonth?: { year: number; month: number },
): Period {
  const { from, to } = params;
  if (from && to && ISO_DAY.test(from) && ISO_DAY.test(to) && from <= to) {
    return customPeriod(from, to);
  }
  const now = new Date();
  const fb = fallbackMonth ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  return monthPeriod(fb.year, fb.month);
}

// ISO day (YYYY-MM-DD) of a date's UTC calendar day — for building ?from/?to links.
export function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// "Mai 2026" — localized month + year label for a month period.
export function formatMonthLabel(p: Period, locale: string): string {
  const d = p.year && p.month ? new Date(Date.UTC(p.year, p.month - 1, 1)) : p.from;
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}
```

### Step 4: Run to verify it passes

- [ ] **Step 4** — Run: `npm run test:unit -- period`
Expected: PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/lib/period.ts tests/unit/lib/period.test.ts
git commit -m "feat: add period helpers (month range, previous month, param parsing)"
```

### Step 6: Write the failing dashboard-service integration test

- [ ] **Step 6** — Create `tests/integration/dashboard.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { getDashboard } from "@/server/services/dashboard";
import { monthPeriod, previousMonthPeriod } from "@/lib/period";

const owner = "dash_owner";
let accountId: string;
let catA: string;
let catB: string;

async function tx(date: string, amount: number, label: string, categoryId: string | null) {
  const s = buildSecureFields({ label, rawLabel: label });
  await db.transaction.create({
    data: {
      accountId,
      date: new Date(date),
      amount,
      type: "OTHER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      categoryId,
      createdById: owner,
    },
  });
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "dash-owner@bilan.local" } });
  accountId = (await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })).id;
  catA = (await db.category.create({ data: { userId: owner, name: "Courses", color: "#11aa11" } })).id;
  catB = (await db.category.create({ data: { userId: owner, name: "Loyer", color: "#aa1111" } })).id;
  // March 2026
  await tx("2026-03-02T00:00:00.000Z", -40, "CB CARREFOUR", catA);
  await tx("2026-03-02T00:00:00.000Z", -10, "CB FRANPRIX", catA);
  await tx("2026-03-05T00:00:00.000Z", -700, "VIR LOYER", catB);
  await tx("2026-03-10T00:00:00.000Z", 2000, "VIR SALAIRE", null);
  // February 2026 (previous month) — for the delta
  await tx("2026-02-10T00:00:00.000Z", 1000, "VIR SALAIRE", null);
  await tx("2026-02-12T00:00:00.000Z", -500, "VIR LOYER", catB);
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("getDashboard", () => {
  it("totals income/expense/net for the month and the previous month", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, previousMonthPeriod(period));
    expect(data.totals.income).toBe(2000);
    expect(data.totals.expense).toBe(750); // 40 + 10 + 700
    expect(data.totals.net).toBe(1250);
    expect(data.totals.count).toBe(4);
    expect(data.previous.income).toBe(1000);
    expect(data.previous.expense).toBe(500);
    expect(data.previous.net).toBe(500);
  });

  it("groups expenses by category, highest first", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, previousMonthPeriod(period));
    expect(data.byCategory[0]).toEqual({ categoryId: catB, amount: 700 });
    expect(data.byCategory[1]).toEqual({ categoryId: catA, amount: 50 });
  });

  it("returns a per-day expense trace and recent transactions", async () => {
    const period = monthPeriod(2026, 3);
    const data = await getDashboard(owner, period, previousMonthPeriod(period));
    const day2 = data.daily.find((d) => d.date === "2026-03-02");
    expect(day2?.amount).toBe(50);
    expect(data.daily).toHaveLength(31); // one entry per day of March
    expect(data.recent.length).toBeGreaterThan(0);
    expect(data.recent[0].label).toBeTruthy(); // decrypted
  });
});
```

### Step 7: Run to verify it fails

- [ ] **Step 7** — Run: `npm run test:integration -- dashboard`
Expected: FAIL — `Cannot find module '@/server/services/dashboard'`.

### Step 8: Implement the dashboard service

- [ ] **Step 8** — Create `src/server/services/dashboard/index.ts`:

```typescript
import { db } from "@/server/db";
import { listVisibleForUser } from "@/server/services/accounts";
import { listTransactions, type TransactionListItem } from "@/server/services/transactions";
import type { Period } from "@/lib/period";

export type DashboardTotals = { income: number; expense: number; net: number; count: number };
export type DashboardData = {
  totals: DashboardTotals;
  previous: Pick<DashboardTotals, "income" | "expense" | "net">;
  byCategory: { categoryId: string | null; amount: number }[];
  daily: { date: string; amount: number }[];
  recent: TransactionListItem[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Aggregates over CLEAR columns only (amount/date/categoryId) — labels stay
// encrypted; only `recent` decrypts (via listTransactions).
async function totalsFor(accountIds: string[], period: Period): Promise<DashboardTotals> {
  if (accountIds.length === 0) return { income: 0, expense: 0, net: 0, count: 0 };
  const rows = await db.transaction.findMany({
    where: { accountId: { in: accountIds }, date: { gte: period.from, lte: period.to } },
    select: { amount: true },
  });
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    const a = Number(r.amount);
    if (a >= 0) income += a;
    else expense += -a;
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense), count: rows.length };
}

export async function getDashboard(
  userId: string,
  period: Period,
  previous: Period,
): Promise<DashboardData> {
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);

  const totals = await totalsFor(accountIds, period);
  const prev = await totalsFor(accountIds, previous);

  // Expenses in the period (clear columns) for by-category + daily.
  const expenseRows =
    accountIds.length === 0
      ? []
      : await db.transaction.findMany({
          where: {
            accountId: { in: accountIds },
            date: { gte: period.from, lte: period.to },
            amount: { lt: 0 },
          },
          select: { amount: true, date: true, categoryId: true },
        });

  // By category, highest spend first.
  const byCat = new Map<string | null, number>();
  for (const r of expenseRows) {
    byCat.set(r.categoryId, (byCat.get(r.categoryId) ?? 0) - Number(r.amount));
  }
  const byCategory = [...byCat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  // One bucket per UTC day of the period.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const daily: { date: string; amount: number }[] = [];
  const byDay = new Map<string, number>();
  for (let t = period.from.getTime(); t <= period.to.getTime(); t += 86_400_000) {
    byDay.set(dayKey(new Date(t)), 0);
  }
  for (const r of expenseRows) {
    const k = dayKey(r.date);
    if (byDay.has(k)) byDay.set(k, byDay.get(k)! - Number(r.amount));
  }
  for (const [date, amount] of byDay) daily.push({ date, amount: round2(amount) });
  daily.sort((a, b) => a.date.localeCompare(b.date));

  const { items: recent } = await listTransactions(userId, {
    from: period.from,
    to: period.to,
    take: 6,
  });

  return {
    totals,
    previous: { income: prev.income, expense: prev.expense, net: prev.net },
    byCategory,
    daily,
    recent,
  };
}
```

### Step 9: Run to verify it passes

- [ ] **Step 9** — Run: `npm run test:integration -- dashboard`
Expected: PASS (3 tests).

### Step 10: Commit

- [ ] **Step 10**

```bash
git add src/server/services/dashboard/index.ts tests/integration/dashboard.test.ts
git commit -m "feat: add dashboard aggregation service (totals, by-category, daily, recent)"
```

### Step 11: Add the SVG charts

- [ ] **Step 11** — Create `src/components/dashboard/charts.tsx` (pure SVG, no `"use client"` — safe to render in a Server Component):

```tsx
// Dependency-free SVG charts ported from the design (no recharts).

export function Donut({
  data,
  size = 220,
  thickness = 26,
  centerLabel,
  centerSub,
}: {
  data: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const seg = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return seg;
        })}
      </svg>
      {(centerLabel !== undefined || centerSub) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center">
          {centerLabel !== undefined && (
            <span className="font-display text-2xl leading-none whitespace-nowrap">{centerLabel}</span>
          )}
          {centerSub && <span className="text-muted-foreground text-[11px] whitespace-nowrap">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

export function MiniBars({
  values,
  width = 380,
  height = 100,
  highlightMax = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  highlightMax?: boolean;
}) {
  const max = Math.max(1, ...values);
  const maxIdx = values.indexOf(Math.max(...values));
  const gap = 1.2;
  const barW = (width - gap * Math.max(1, values.length - 1)) / Math.max(1, values.length);
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {values.map((v, i) => {
        const barH = (v / max) * (height - 4);
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={height - (barH || 1)}
            width={barW}
            height={barH || 1}
            rx={Math.min(barW / 2, 1.5)}
            fill={highlightMax && i === maxIdx ? "var(--foreground)" : "var(--muted-foreground)"}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}
```

### Step 12: Build the dashboard view

- [ ] **Step 12** — Create `src/components/dashboard/dashboard-view.tsx` (Server Component — receives resolved data + the locale/labels it needs):

```tsx
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { overline, Pill, CategoryAvatar } from "@/components/transactions/bits";
import { Donut, MiniBars } from "./charts";
import { PeriodNav } from "./period-nav";
import type { DashboardData } from "@/server/services/dashboard";
import type { Period } from "@/lib/period";
import type { FlatCategory } from "@/components/transactions/category-tree";
import { formatMonthLabel } from "@/lib/period";

const DEFAULT_COLOR = "#2563eb";

function delta(cur: number, prev: number): { pct: number; up: boolean } | null {
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return { pct, up: pct >= 0 };
}

export async function DashboardView({
  data,
  period,
  categories,
  locale,
}: {
  data: DashboardData;
  period: Period;
  categories: FlatCategory[];
  locale: string;
}) {
  const t = await getTranslations("dashboard");
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const catById = new Map(categories.map((c) => [c.id, c]));
  const label = formatMonthLabel(period, locale);

  const kpis = [
    { key: "income", value: data.totals.income, d: delta(data.totals.income, data.previous.income), tone: "var(--income)" },
    { key: "expense", value: data.totals.expense, d: delta(data.totals.expense, data.previous.expense), tone: "var(--expense)" },
    { key: "net", value: data.totals.net, d: delta(data.totals.net, data.previous.net), tone: data.totals.net >= 0 ? "var(--income)" : "var(--expense)" },
  ] as const;

  const topCats = data.byCategory.slice(0, 6);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className={overline}>{t("overline")}</div>
          <h1 className="font-display text-4xl leading-none capitalize">{label}</h1>
          <p className="text-muted-foreground text-sm">{t("txCount", { count: data.totals.count })}</p>
        </div>
        <PeriodNav period={period} />
      </header>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.key} className="gap-2 p-5">
            <div className={overline}>{t(`kpi.${k.key}`)}</div>
            <div className="font-display text-3xl leading-none tabular-nums" style={{ color: k.tone }}>
              {money.format(k.value)}
            </div>
            <div className="text-muted-foreground text-[11.5px]">
              {k.d ? t("vsPrev", { arrow: k.d.up ? "↗" : "↘", pct: Math.abs(k.d.pct) }) : t("noPrev")}
            </div>
          </Card>
        ))}
      </div>

      {/* Donut + breakdown */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="gap-4 p-6">
          <div>
            <div className={overline}>{t("breakdown")}</div>
            <div className="font-display text-xl">{t("byCategory")}</div>
          </div>
          {data.totals.expense === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noExpenses")}</p>
          ) : (
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <Donut
                data={topCats.map((c) => ({
                  value: c.amount,
                  color: (c.categoryId && catById.get(c.categoryId)?.color) || DEFAULT_COLOR,
                }))}
                centerLabel={money.format(data.totals.expense)}
                centerSub={t("spentThisPeriod")}
              />
              <div className="flex w-full flex-1 flex-col gap-2">
                {topCats.map((c) => {
                  const meta = c.categoryId ? catById.get(c.categoryId) : undefined;
                  return (
                    <div key={c.categoryId ?? "none"} className="flex items-center gap-2.5 text-sm">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: meta?.color ?? DEFAULT_COLOR }}
                      />
                      <span className="flex-1 truncate">{meta?.name ?? t("noCategory")}</span>
                      <span className="tabular-nums">{money.format(c.amount)}</span>
                      <span className="text-muted-foreground w-10 text-right text-[11.5px] tabular-nums">
                        {Math.round((c.amount / data.totals.expense) * 100)} %
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Daily trace */}
        <Card className="gap-4 p-6">
          <div>
            <div className={overline}>{t("daily")}</div>
            <div className="font-display text-xl">{t("dayByDay")}</div>
          </div>
          <MiniBars values={data.daily.map((d) => d.amount)} />
          <div className="text-muted-foreground flex justify-between text-[11px]">
            <span>{data.daily[0]?.date.slice(8, 10)}</span>
            <span>{data.daily[data.daily.length - 1]?.date.slice(8, 10)}</span>
          </div>
        </Card>
      </div>

      {/* Recent transactions */}
      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between p-5">
          <div className="font-display text-xl">{t("recent")}</div>
          <Link href={`/${locale}/transactions`} className="text-primary text-sm hover:underline">
            {t("seeAll")}
          </Link>
        </div>
        <div className="border-t">
          {data.recent.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">{t("noRecent")}</p>
          ) : (
            data.recent.map((r) => {
              const meta = r.categoryId ? catById.get(r.categoryId) : undefined;
              return (
                <div
                  key={r.id}
                  data-slot="dashboard-recent-row"
                  className="flex items-center gap-3 border-b px-5 py-2.5 last:border-b-0"
                >
                  <CategoryAvatar color={meta?.color} icon={meta?.icon} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
                  <span
                    className="text-sm font-medium tabular-nums"
                    style={r.amount > 0 ? { color: "var(--income)" } : undefined}
                  >
                    {new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(r.amount)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
```

> The "Épargne" KPI, budgets snapshot, upcoming/recurring, links and household strips from the design are intentionally omitted (no data source until Phase 6/7). The accounts strip is also deferred to keep this scope focused on reporting — add later if desired.

### Step 13: Build the period nav

- [ ] **Step 13** — Create `src/components/dashboard/period-nav.tsx` (client; month prev/next via URL params):

```tsx
"use client";

import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths, monthPeriod, toIsoDay, type Period } from "@/lib/period";

export function PeriodNav({ period }: { period: Period }) {
  const router = useRouter();
  const pathname = usePathname();

  // Month nav only makes sense for a whole-month period; fall back to "now".
  const year = period.year ?? new Date().getUTCFullYear();
  const month = period.month ?? new Date().getUTCMonth() + 1;

  function go(delta: number) {
    const next = addMonths(year, month, delta);
    const p = monthPeriod(next.year, next.month);
    router.push(`${pathname}?from=${toIsoDay(p.from)}&to=${toIsoDay(p.to)}`);
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="prev" onClick={() => go(-1)}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="next" onClick={() => go(1)}>
        <ChevronRight />
      </Button>
    </div>
  );
}
```

### Step 14: Add the dashboard i18n

- [ ] **Step 14** — In `messages/fr.json`, replace the `dashboard` namespace contents with (keep the key `dashboard`):

```json
  "dashboard": {
    "overline": "Vue d'ensemble",
    "txCount": "{count, plural, one {# transaction} other {# transactions}}",
    "kpi": { "income": "Revenus", "expense": "Dépenses", "net": "Solde net" },
    "vsPrev": "{arrow} {pct} % vs période précédente",
    "noPrev": "Pas de période précédente",
    "breakdown": "Répartition",
    "byCategory": "Dépenses par catégorie",
    "spentThisPeriod": "dépensés sur la période",
    "noExpenses": "Aucune dépense sur cette période.",
    "noCategory": "Sans catégorie",
    "daily": "Quotidien",
    "dayByDay": "Dépenses jour par jour",
    "recent": "Transactions récentes",
    "seeAll": "Tout voir",
    "noRecent": "Aucune transaction sur cette période."
  },
```

In `messages/en.json`, mirror:

```json
  "dashboard": {
    "overline": "Overview",
    "txCount": "{count, plural, one {# transaction} other {# transactions}}",
    "kpi": { "income": "Income", "expense": "Expenses", "net": "Net balance" },
    "vsPrev": "{arrow} {pct} % vs previous period",
    "noPrev": "No previous period",
    "breakdown": "Breakdown",
    "byCategory": "Spending by category",
    "spentThisPeriod": "spent this period",
    "noExpenses": "No spending this period.",
    "noCategory": "Uncategorised",
    "daily": "Daily",
    "dayByDay": "Day-by-day spending",
    "recent": "Recent transactions",
    "seeAll": "See all",
    "noRecent": "No transactions this period."
  },
```

> The old keys (`greeting`, `subtitle`, `cards.*`, `comingSoon`) are removed — the placeholder page that used them is replaced in Step 15. Grep for them first (`rg "dashboard\.(greeting|comingSoon|cards)"`) and confirm only the old page referenced them.

### Step 15: Replace the dashboard page

- [ ] **Step 15** — Replace `src/app/[locale]/(authenticated)/dashboard/page.tsx`:

```tsx
import { setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
import { getDashboard } from "@/server/services/dashboard";
import { parsePeriodParams, previousMonthPeriod } from "@/lib/period";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireSession();

  const period = parsePeriodParams({ from: sp.from, to: sp.to });
  const previous = previousMonthPeriod(period);
  const [data, categories] = await Promise.all([
    getDashboard(user.id, period, previous),
    listForUser(user.id).then(flattenCategories),
  ]);

  return <DashboardView data={data} period={period} categories={categories} locale={locale} />;
}
```

### Step 16: Typecheck + CI

- [ ] **Step 16**

Run: `npm run typecheck` → PASS (if `.next/dev/types` is stale after the route change, trigger a recompile: `curl -s -o /dev/null http://localhost:3000/fr/dashboard`).
Run: `npm run ci` → PASS.

### Step 17: Write the e2e

- [ ] **Step 17** — Create `tests/e2e/dashboard.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("dashboard", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("renders the KPI row and month label, and navigates months", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await expect(page.getByText(/revenus/i)).toBeVisible();
    await expect(page.getByText(/dépenses/i)).toBeVisible();
    await expect(page.getByText(/solde net/i)).toBeVisible();

    const heading = page.getByRole("heading", { level: 1 });
    const before = await heading.textContent();
    await page.getByRole("button", { name: "prev" }).click();
    await expect(page).toHaveURL(/\?from=.*&to=/);
    await expect(heading).not.toHaveText(before ?? "");
  });
});
```

### Step 18: Run e2e + commit, push, PR

- [ ] **Step 18**

Run: `npm run test:e2e -- dashboard --project=chromium` → PASS.
Run: `npm run ci` → PASS.

```bash
git add src/components/dashboard "src/app/[locale]/(authenticated)/dashboard/page.tsx" messages tests/e2e/dashboard.spec.ts
git commit -m "feat: flagship dashboard (KPIs, category donut, daily trace, recent) with month nav"
git push -u origin feature/5.1-dashboard
gh pr create --base develop --title "feat: dashboard" --label "enhancement,phase-5,frontend,backend" --body "Closes #25"
```

---

## Task 5.2 — Custom periods

**Branch:** `feature/5.2-custom-periods`
**Goal:** Presets (this month / last month / this quarter / this year) + a custom date range, driving the dashboard AND the transactions list from `?from`/`?to`. The "vs previous" delta uses a same-length window for custom ranges.

### Step 1: Extend the period-lib test

- [ ] **Step 1** — Append to `tests/unit/lib/period.test.ts`:

```typescript
import { presetPeriod, previousPeriod, PERIOD_PRESETS } from "@/lib/period";

describe("presetPeriod", () => {
  const now = new Date("2026-05-15T12:00:00.000Z");
  it("this-month spans the current calendar month", () => {
    const p = presetPeriod("this-month", now);
    expect(p.from.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(p.month).toBe(5);
  });
  it("last-month spans the previous calendar month", () => {
    const p = presetPeriod("last-month", now);
    expect(p.month).toBe(4);
  });
  it("this-quarter spans Apr–Jun for May", () => {
    const p = presetPeriod("this-quarter", now);
    expect(p.from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-06-30T23:59:59.999Z");
    expect(p.month).toBeNull();
  });
  it("this-year spans the calendar year", () => {
    const p = presetPeriod("this-year", now);
    expect(p.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-12-31T23:59:59.999Z");
  });
  it("exposes the preset ids", () => {
    expect(PERIOD_PRESETS).toContain("this-quarter");
  });
});

describe("previousPeriod", () => {
  it("returns the same-length window immediately before a custom range", () => {
    const p = previousPeriod({
      from: new Date("2026-05-10T00:00:00.000Z"),
      to: new Date("2026-05-20T23:59:59.999Z"),
      year: null,
      month: null,
    });
    // 11-day window → previous 11 days ending the day before `from`.
    expect(p.to.toISOString().slice(0, 10)).toBe("2026-05-09");
    expect(p.from.toISOString().slice(0, 10)).toBe("2026-04-29");
  });
});
```

### Step 2: Run to verify it fails

- [ ] **Step 2** — Run: `npm run test:unit -- period`
Expected: FAIL — `presetPeriod`/`previousPeriod`/`PERIOD_PRESETS` not exported.

### Step 3: Extend `src/lib/period.ts`

- [ ] **Step 3** — Append to `src/lib/period.ts`:

```typescript
export const PERIOD_PRESETS = ["this-month", "last-month", "this-quarter", "this-year"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

// A preset window relative to `now` (UTC). Month presets carry year/month;
// quarter/year are custom (month = null).
export function presetPeriod(preset: PeriodPreset, now: Date = new Date()): Period {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  switch (preset) {
    case "this-month":
      return monthPeriod(y, m);
    case "last-month": {
      const p = addMonths(y, m, -1);
      return monthPeriod(p.year, p.month);
    }
    case "this-quarter": {
      const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const lastDay = daysInMonthExport(y, startMonth + 2);
      return {
        from: new Date(Date.UTC(y, startMonth - 1, 1, 0, 0, 0, 0)),
        to: new Date(Date.UTC(y, startMonth + 1, lastDay, 23, 59, 59, 999)),
        year: null,
        month: null,
      };
    }
    case "this-year":
      return {
        from: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
        to: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
        year: null,
        month: null,
      };
  }
}

// Same-length window immediately before `p` (for the custom-range delta).
export function previousPeriod(p: Period): Period {
  if (p.year && p.month) return previousMonthPeriod(p);
  const dayMs = 86_400_000;
  const lengthDays = Math.round((p.to.getTime() - p.from.getTime() + 1) / dayMs);
  const toDay = new Date(p.from.getTime() - dayMs);
  const fromDay = new Date(toDay.getTime() - (lengthDays - 1) * dayMs);
  return {
    from: new Date(`${toIsoDay(fromDay)}T00:00:00.000Z`),
    to: new Date(`${toIsoDay(toDay)}T23:59:59.999Z`),
    year: null,
    month: null,
  };
}
```

> `daysInMonth` is module-private; export a tiny alias `daysInMonthExport` (or move the existing `daysInMonth` above `presetPeriod` and reuse it directly — preferred; no new export needed). Use the existing `daysInMonth` directly: replace `daysInMonthExport(y, startMonth + 2)` with `daysInMonth(y, startMonth + 2)`.

### Step 4: Run to verify it passes

- [ ] **Step 4** — Run: `npm run test:unit -- period`
Expected: PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/lib/period.ts tests/unit/lib/period.test.ts
git commit -m "feat: add period presets (month/quarter/year) and same-length previous window"
```

### Step 6: Build the period picker

- [ ] **Step 6** — Create `src/components/dashboard/period-picker.tsx` (client):

```tsx
"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/transactions/bits";
import { PERIOD_PRESETS, presetPeriod, toIsoDay, type PeriodPreset } from "@/lib/period";

export function PeriodPicker({ from, to }: { from: string; to: string }) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const pathname = usePathname();
  const [customOpen, setCustomOpen] = useState(false);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  function applyPreset(preset: PeriodPreset) {
    const p = presetPeriod(preset);
    router.push(`${pathname}?from=${toIsoDay(p.from)}&to=${toIsoDay(p.to)}`);
  }
  function applyCustom() {
    if (start && end && start <= end) router.push(`${pathname}?from=${start}&to=${end}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedTabs<PeriodPreset | "custom">
        items={[
          ...PERIOD_PRESETS.map((p) => ({ id: p, label: t(`preset.${p}`) })),
          { id: "custom", label: t("preset.custom") },
        ]}
        value={customOpen ? "custom" : "this-month"}
        onChange={(id) => (id === "custom" ? setCustomOpen((v) => !v) : applyPreset(id as PeriodPreset))}
      />
      {customOpen && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="border-input bg-card h-8 rounded-md border px-2 text-sm shadow-sm"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="border-input bg-card h-8 rounded-md border px-2 text-sm shadow-sm"
          />
          <Button size="sm" onClick={applyCustom}>
            {t("apply")}
          </Button>
        </div>
      )}
    </div>
  );
}
```

### Step 7: Add picker i18n

- [ ] **Step 7** — Add to the `dashboard` namespace (both `messages/fr.json` and `messages/en.json`):

fr:
```json
    "preset": { "this-month": "Ce mois", "last-month": "Mois dernier", "this-quarter": "Trimestre", "this-year": "Année", "custom": "Personnalisé" },
    "apply": "Appliquer",
```
en:
```json
    "preset": { "this-month": "This month", "last-month": "Last month", "this-quarter": "Quarter", "this-year": "Year", "custom": "Custom" },
    "apply": "Apply",
```

### Step 8: Use the picker on the dashboard + previous-period for custom

- [ ] **Step 8** — In `src/components/dashboard/dashboard-view.tsx`, import and render `PeriodPicker` next to `PeriodNav` in the header (the month chevrons stay for quick month stepping; the picker handles presets/custom):

```tsx
import { PeriodPicker } from "./period-picker";
import { toIsoDay } from "@/lib/period";
```

Replace `<PeriodNav period={period} />` with:

```tsx
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker from={toIsoDay(period.from)} to={toIsoDay(period.to)} />
          <PeriodNav period={period} />
        </div>
```

In `src/app/[locale]/(authenticated)/dashboard/page.tsx`, swap the previous-period computation to handle custom ranges:

```tsx
import { parsePeriodParams, previousPeriod } from "@/lib/period";
```
```tsx
  const previous = previousPeriod(period);
```

### Step 9: Wire the transactions list to the period

- [ ] **Step 9** — In `src/app/[locale]/(authenticated)/transactions/page.tsx`, read `from`/`to` from `searchParams`, pass to `listTransactions`, and pass the current range to the filters component. Find where `searchParams` (`sp`) is read and the `listTransactions` filters are built; add:

```tsx
import { parsePeriodParams } from "@/lib/period";
```
```tsx
  const period = parsePeriodParams({ from: sp.from, to: sp.to });
```
Add `from: period.from, to: period.to` to the `listTransactions(..., { ... })` filter object, and pass `from={sp.from} to={sp.to}` to `<TransactionFilters />`.

In `src/components/transactions/transaction-filters.tsx`, add the period picker to the filter rail (import `PeriodPicker` from `@/components/dashboard/period-picker`) so the same control filters the list. Render it at the start of the rail:

```tsx
import { PeriodPicker } from "@/components/dashboard/period-picker";
```
```tsx
      <PeriodPicker from={from ?? ""} to={to ?? ""} />
```
(Thread `from`/`to` props into `TransactionFilters`; default to `""` when absent.)

### Step 10: Typecheck + CI

- [ ] **Step 10**

Run: `npm run typecheck` → PASS.
Run: `npm run ci` → PASS.

### Step 11: Extend the e2e

- [ ] **Step 11** — Add to `tests/e2e/dashboard.spec.ts`:

```typescript
  test("switching a preset updates the URL and reloads the dashboard", async ({ page }) => {
    await page.goto("/fr/dashboard");
    await page.getByRole("button", { name: /trimestre/i }).click();
    await expect(page).toHaveURL(/\?from=.*&to=/);
    await expect(page.getByText(/revenus/i)).toBeVisible();
  });
```

Run: `npm run test:e2e -- dashboard --project=chromium` → PASS.

### Step 12: Commit, push, PR

- [ ] **Step 12**

```bash
git add src/lib/period.ts src/components/dashboard "src/app/[locale]/(authenticated)" src/components/transactions/transaction-filters.tsx messages tests
git commit -m "feat: custom-period reporting (presets + range) across dashboard and transactions"
git push -u origin feature/5.2-custom-periods
gh pr create --base develop --title "feat: custom periods" --label "enhancement,phase-5,frontend,backend" --body "Closes #26"
```

---

## Self-Review notes (for the executor)

**Spec coverage (PLAN.md Phase 5 + design dashboard.jsx):**
- 5.1 `/dashboard` editorial layout, month switcher, KPI row (income/expense/net + vs-previous), category donut, daily trace, recent transactions → Task 5.1 (`getDashboard` aggregation + `DashboardView` + `PeriodNav`; donut/daily are dependency-free SVG). ✅ AC: `tests/e2e/dashboard.spec.ts` renders KPIs + month nav.
- 5.2 date-range picker (presets + custom), reactive recompute across dashboard + transactions → Task 5.2 (`presetPeriod`/`previousPeriod` unit-tested, `PeriodPicker` drives `?from`/`?to`, transactions page reads the same params). ✅ AC: e2e preset switch + period unit tests.

**Type consistency:** `Period { from, to, year, month }` is the single contract from `@/lib/period`, consumed by `getDashboard`, the page, `PeriodNav`, `PeriodPicker`. `DashboardData` returned by `getDashboard` is consumed by `DashboardView`. `listTransactions`/`listVisibleForUser`/`flattenCategories`/`FlatCategory` reused unchanged from Phases 2–4.

**Deliberate scope cuts (documented, not gaps):**
- **Budgets snapshot, upcoming/recurring, links, household strip, "Épargne" KPI, accounts strip** from the design are omitted — their data sources land in Phase 6 (links) / Phase 7 (budgets, recurring). Revisit the dashboard layout in those phases to slot them in.
- Charts are hand-rolled SVG (the design itself is hand-rolled SVG), not "shadcn Charts"/recharts — no dependency added; more faithful to the mockup. If interactive tooltips are wanted later, swap `Donut`/`MiniBars` for recharts then.
- The donut shows the **top 6** categories; remaining spend is not bucketed into an "Autres" slice (the breakdown list also shows top 6). Add an "Autres" aggregate if the user asks.

**Before each PR:** `git checkout develop && git pull`, delete merged branches, branch `feature/5.x-...`, `npm run ci`, GPG-sign commits, PR with `Closes #<issue>` + labels. No migration this phase. If the dev server's `.next/dev` types go stale after adding routes/components, trigger a recompile with a `curl` to the page before `npm run typecheck` (see `[[project_dev-e2e-ops]]`).
```

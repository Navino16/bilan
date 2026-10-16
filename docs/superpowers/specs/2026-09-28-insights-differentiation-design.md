# Insights page — differentiate from the dashboard (#107)

> **Status**: Approved in brainstorming — pending written-spec review
> **Date**: 2026-09-28
> **Issue**: #107 (from the Phase-8 UI/UX review)

## 1. Problem

`/insights` renders the same `getDashboard` data as `/dashboard` (category donut + expense trend), only larger and with less context. It answers no question the dashboard doesn't already answer.

## 2. Goal

The dashboard answers *"where am I this period?"*. Insights answers *"what changed, and where exactly does the money go?"*, through three blocks:

1. **What changed** — expenses per category, current vs previous period.
2. **Top merchants** — where the spending goes, grouped by merchant.
3. **Income by category** — with the change vs the previous period.

The donut and the trend are **removed** from Insights (they stay on the dashboard).

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Layout **A "narrative"** (mockup reviewed in brainstorming): 2 tiles → "What changed" card → Top merchants + Income cards. | Answers "what changed?" at a glance; clearest break from the dashboard. |
| D2 | The comparison is **current period vs `previousPeriod(period)`**, the same pair the dashboard uses (`comparisonFor` in `src/lib/period.ts`). A period still in progress ("Ce mois", the current quarter/year) is compared on **elapsed days**: the reference side is cut to the same number of days from its start, and both pages show an **in-progress note** (§7). *Amended since approval: the first version compared with the full previous period.* | Like-for-like: a partial period against a full one always reads as a drop; consistent with the dashboard KPIs. |
| D3 | Merchants are grouped by a **normalized label** computed after in-memory decryption, not by `labelHash`. | Imports store the raw bank label as the label (`imports/commit.ts`), which carries dates/amounts (`CB SUPERMARKET 02/04/26`) → exact-hash grouping would fragment one merchant into many rows. Decrypting one period's expenses is cheap and `listTransactions` already decrypts server-side, so plaintext exposure is unchanged. |
| D4 | Merchants exclude `type = TRANSFER`. | Otherwise unlinked internal transfers ("VIR COMPTE JOINT", "VIR LIVRET A") top the list. |
| D5 | Categories are compared at the **stored (leaf) level**, uncategorized included as "Sans catégorie". | Same granularity as the dashboard breakdown. |
| D6 | Link collapsing applies (balanced groups drop out, unbalanced ones become one net row on their primary). | Same aggregation semantics as `getDashboard`. |

## 4. Data — `getInsights`

New file `src/server/services/dashboard/insights.ts`, next to `getDashboard` (Phase-8 plan, design decision 2).

```ts
export type CategoryChange = {
  categoryId: string | null;
  current: number;   // expense, positive euros
  previous: number;
  diff: number;      // current - previous
};
export type MerchantTotal = {
  label: string;             // display label (see §5)
  total: number;             // expense, positive euros
  count: number;             // transactions in the group
  categoryId: string | null; // most frequent category of the group
};
export type IncomeByCategory = { categoryId: string | null; current: number; previous: number };
export type InsightsData = {
  changes: CategoryChange[];     // |diff| desc, diff === 0 excluded
  merchants: MerchantTotal[];    // total desc, top 6
  income: IncomeByCategory[];    // current desc, categories with current > 0 only
  incomeTotal: number;
};

export async function getInsights(userId: string, period: Period, comparison: Comparison): Promise<InsightsData>;
```

- Rows come from the existing `loadRows` (visible accounts, period bounds, link collapse). `loadRows` gains an opt-in to also select `labelEnc` and `type`; only the current period needs them (merchants). `collapseLinkedRows` spreads the primary row, so the extra fields survive collapsing.
- `changes`: per-category expense sums for both periods, union of category ids, `diff = current - previous`, sorted by `|diff|` desc (ties → higher `current` first, then `categoryId`), `diff === 0` dropped.
- `merchants`: current-period rows with `amount < 0` and `type !== "TRANSFER"`, label decrypted, grouped by `merchantKey(label)`. Rows whose key is empty are skipped. `categoryId` = most frequent in the group (ties → highest spend). Sorted by `total` desc (ties → `label`), top 6.
- `income`: per-category sums of `amount > 0` rows for both periods; only categories with `current > 0`, sorted by `current` desc.
- All amounts rounded to cents (`round2` from `@/lib/budgets`). The pure aggregations live in `src/lib/insights.ts` (with the types); `getInsights` only loads, decrypts and delegates.

## 5. `merchantKey` — `src/lib/merchant.ts`

Pure, no DB, importable from the client.

- `merchantKey(label)`: uppercase, strip accents, then remove
  - a leading operation prefix: `PAIEMENT PAR CARTE`, `CARTE`, `CB`, `PRLV SEPA`, `PRLV`, `VIR SEPA`, `VIREMENT`, `VIR` (longest first, word-bounded);
  - dates `dd/mm`, `dd/mm/yy`, `dd/mm/yyyy` and anything after them;
  - trailing amounts / references (`42,99`, `42.99`, `X1234`, lone digit groups);
  - then collapse whitespace and trim.
- `merchantLabel(label)`: the same stripping without uppercasing/accent removal, used for display (taken from the group's most recent transaction).

Examples: `CB SUPERMARKET 02/04/26` → `SUPERMARKET`; `CB AMAZON EU 42,99` → `AMAZON EU`; `PRLV SEPA SFR` → `SFR`.

## 6. View — `src/components/insights/insights-view.tsx` (rewritten)

Server component taking `InsightsData`, the current and previous `Period`, and `inProgress`.

1. `PageHeader` + `PeriodPicker`/`PeriodNav` — unchanged.
2. **Tiles** (2 columns): biggest increase (max positive `diff`) and biggest decrease (min negative `diff`) — amount signed, category name + `%` (or "nouveau" when `previous === 0`). A tile with no candidate shows a neutral "—".
3. **"Ce qui a changé"** card (`data-slot="insights-changes"`): top 6 `changes`, each row = color dot, name, signed diff (expense tone for increases, income tone for decreases), `%`, a diverging bar around a centre axis (width ∝ `|diff| / max|diff|`), and `previous → current` below. New component `src/components/insights/diverging-bar.tsx`.
4. **"Top marchands"** card: top 6 merchants — rank, label, `category · N×`, total, a bar ∝ `total / max` in the category color.
5. **"Revenus par catégorie"** card: stacked bar of `income`, then one row per category with `current` and the change vs previous (`=`, `+x %`, `nouveau`).
6. Cards 4 and 5 stack on mobile, side by side from `lg`.
7. Colors via `categorySliceColors`; empty state per block (`noData`).

`src/components/dashboard/charts.tsx`: remove `TrendBars` and `ChartLegend` (only Insights used them). `Donut` and `MiniBars` stay.

The page (`insights/page.tsx`) calls `getInsights` instead of `getDashboard`.

## 7. In-progress comparison (Insights + dashboard)

- `periodInProgress(p, now = new Date())` in `src/lib/period.ts`: true when `p.from <= now <= p.to`.
- `comparisonFor(period, baseline, now)` is built in the page (the `now` default keeps `Date` out of the render — `react-hooks/purity`) and passed to the view. While the period is in progress it sets `elapsedDays` (days from `period.from` to today, inclusive) and cuts the reference side to match:
  - baseline `prev`: `previous` = the first `elapsedDays` days of `previousPeriod(period)` (whole period if shorter);
  - baselines `avg3`/`avg6`/`avg12` (month periods only, `?vs=`): only days `1..elapsedDays` of each averaged month are kept (`averageMonthRows`); months before the first transaction are left out of the average.
  - Once the period is over, `elapsedDays` is `null` and the full reference is used.
- `ComparisonNote` (`src/components/dashboard/comparison-note.tsx`) renders one muted line with an `Info` icon under the `PageHeader` of both views (`data-slot="period-in-progress"`), only while `elapsedDays` is set: *"Period in progress: compared with the same number of days of the previous period ({previous})."* — `{previous}` = `formatPeriodLabel(comparison.previous, locale)`, i.e. the cut range — or, for an average baseline, *"…compared with the same days (days 1–N) of each month."*
- The dashboard KPI deltas and the Insights changes/income use the same cut reference.

## 8. i18n

`messages/fr.json` and `messages/en.json` edited together: the `insights` namespace drops the donut/trend keys and gains the tile, card-title, "nouveau", "×" count and legend keys; the in-progress line uses `dashboard.inProgressPrev` / `dashboard.inProgressAvg`, which the Insights view also reads.

## 9. Testing

- **Unit** `tests/unit/lib/merchant.test.ts`: prefixes, dates, trailing amounts/refs, accents, empty result, display variant.
- **Unit** `periodInProgress`: past, current and future periods; boundaries.
- **Unit** on the pure aggregation helpers (changes sort/ties, zero-diff drop, merchant grouping + most frequent category, TRANSFER exclusion, income filter).
- **Integration** `tests/integration/insights.test.ts`: `getInsights` on the test DB with its own fixtures (CI DB is not seeded) — two periods, a linked balanced pair dropped, a TRANSFER excluded from merchants.
- **E2E** `tests/e2e/insights.spec.ts`: heading + `[data-slot="insights-changes"]` visible for a period with spending; `[data-slot="period-in-progress"]` visible on the current month, absent on a past month.

## 10. Out of scope

- A 6/12-month history grid.
- Persisted merchant aliases or a merchant field on transactions.
- Drill-down from a merchant/category row to the filtered transaction list.

## 11. Delivery

One scope = one PR: branch `feature/107-insights` → `develop`, `Closes #107`, labels `enhancement`, `backend`, `frontend`.

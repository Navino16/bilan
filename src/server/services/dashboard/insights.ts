import { db } from "@/server/db";
import { visibleAccountIds } from "@/server/services/accounts";
import { aliasMap, listAliasGroups, merchantRowsOf } from "@/server/services/merchants";
import { listBudgetSeriesHistory } from "@/server/services/budgets";
import { getExceptionalRule } from "@/server/services/users/preferences";
import { round2 } from "@/lib/budgets";
import {
  categoryTrends,
  incomeByCategory,
  insightsOverview,
  topMerchants,
  uncategorizedSpending,
  type CategoryBranch,
  type HistoryMonth,
  type HistoryWindow,
  type InsightsData,
} from "@/lib/insights";
import { exceptionalExpenses } from "@/lib/exceptional";
import { recurringIds, recurringPayments, RECURRING_MONTHS } from "@/lib/recurring";
import {
  addMonths,
  historyMonths,
  monthPeriod,
  monthsSpan,
  periodInProgress,
  type Comparison,
  type Period,
} from "@/lib/period";
import { firstTransactionDate, loadRows, referenceRows, type AggRow } from "./index";
import { countedRow, savingsScope } from "./savings";

const TOP_MERCHANTS = 6;
const HISTORY_MONTHS = 12;

// The root and root child of each category, walking up the tree a level per query.
async function branchesOf(ids: Set<string>): Promise<Map<string, CategoryBranch>> {
  const parentOf = new Map<string, string | null>();
  let pending = [...ids];
  while (pending.length > 0) {
    const rows = await db.category.findMany({
      where: { id: { in: pending } },
      select: { id: true, parentId: true },
    });
    for (const r of rows) parentOf.set(r.id, r.parentId);
    pending = [
      ...new Set(
        rows.flatMap((r) => (r.parentId && !parentOf.has(r.parentId) ? [r.parentId] : [])),
      ),
    ];
  }
  const out = new Map<string, CategoryBranch>();
  for (const id of ids) {
    if (!parentOf.has(id)) continue;
    const path = [id];
    for (let p = parentOf.get(id); p && !path.includes(p); p = parentOf.get(p)) path.push(p);
    out.set(id, { root: path[path.length - 1], child: path[path.length - 2] ?? id });
  }
  return out;
}

function dataStartOf(months: HistoryMonth[], first: Date | null): number {
  const i = first ? months.findIndex((m) => monthPeriod(m.year, m.month).to >= first) : -1;
  return i === -1 ? months.length : i;
}

function historyWindow(period: Period, first: Date | null, now: Date): HistoryWindow {
  const months = historyMonths(period, HISTORY_MONTHS, now);
  const last = months[months.length - 1];
  return {
    months,
    inProgress: periodInProgress(monthPeriod(last.year, last.month), now),
    dataStart: dataStartOf(months, first),
  };
}

// The HISTORY_MONTHS complete months before the period: what its exceptional expenses are
// judged against, the period itself left out.
function baselineWindow(period: Period, first: Date | null): HistoryWindow {
  const year = period.from.getUTCFullYear();
  const month = period.from.getUTCMonth() + 1;
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) =>
    addMonths(year, month, i - HISTORY_MONTHS),
  );
  return { months, inProgress: false, dataStart: dataStartOf(months, first) };
}

// Same rows as the dashboard: links collapsed, savings-category and neutral rows left out
// (spec §5.17). The 12-month window is one load so links spanning two months collapse. The
// period's rows carry their real dates: exceptional expenses show and link to them.
export async function getInsights(
  userId: string,
  period: Period,
  comparison: Comparison,
  now: Date = new Date(),
): Promise<InsightsData> {
  const accountIds = await visibleAccountIds(userId);
  const scope = await savingsScope(userId, accountIds);
  const keep = (r: AggRow) => countedRow(scope, r);
  const first = await firstTransactionDate(accountIds);
  const window = historyWindow(period, first, now);
  const baseline = baselineWindow(period, first);
  const recentSpan = monthsSpan(historyMonths(period, RECURRING_MONTHS, now));
  const [current, reference, history, before, recent, aliases, budgets, rule] = await Promise.all([
    loadRows(accountIds, period, { withLabels: true, realDates: true }),
    referenceRows(accountIds, period, comparison, keep),
    loadRows(accountIds, monthsSpan(window.months)),
    loadRows(accountIds, monthsSpan(baseline.months)),
    loadRows(accountIds, recentSpan, { withLabels: true, realDates: true }),
    listAliasGroups(userId),
    listBudgetSeriesHistory(userId, now),
    getExceptionalRule(userId),
  ]);
  const rows = current.rows.filter(keep);
  const historyRows = history.rows.filter(keep);
  const baselineRows = before.rows.filter(keep);
  const ids = new Set(
    [...rows, ...reference, ...historyRows, ...baselineRows].flatMap((r) =>
      r.categoryId ? [r.categoryId] : [],
    ),
  );
  const branches = await branchesOf(ids);

  const income = incomeByCategory(rows, reference);
  const asOf = new Date(Math.min(period.to.getTime(), now.getTime()));
  const aliasByKey = aliasMap(aliases);
  const spendingRows = merchantRowsOf(rows);
  const recentRows = merchantRowsOf(recent.rows.filter(keep));
  const spending = rows.reduce((s, r) => s + Math.max(0, -r.amount), 0);
  const recurring = recurringIds(recentRows, asOf, aliasByKey);
  return {
    overview: insightsOverview(historyRows, window),
    categories: categoryTrends(rows, reference, historyRows, window, branches),
    uncategorized: uncategorizedSpending(rows),
    recurring: {
      ...recurringPayments(recentRows, asOf, first, aliasByKey),
      window: recentSpan,
    },
    exceptional: exceptionalExpenses(
      spendingRows,
      baselineRows,
      baseline,
      branches,
      recurring,
      spending,
      rule,
      aliasByKey,
    ),
    merchants: topMerchants(spendingRows, TOP_MERCHANTS, aliasByKey, recurring),
    aliasGroups: aliases,
    income,
    incomeTotal: round2(income.reduce((s, i) => s + i.current, 0)),
    budgets,
  };
}

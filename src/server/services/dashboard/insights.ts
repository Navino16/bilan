import { visibleAccountIds } from "@/server/services/accounts";
import { aliasMap, listAliasGroups, merchantRowsOf } from "@/server/services/merchants";
import { round2 } from "@/lib/budgets";
import {
  categoryChanges,
  incomeByCategory,
  monthlyCategoryTotals,
  topMerchants,
  type CategoryHistory,
  type InsightsData,
} from "@/lib/insights";
import {
  historyMonths,
  monthPeriod,
  monthsSpan,
  periodInProgress,
  type Comparison,
  type Period,
} from "@/lib/period";
import { firstTransactionDate, loadRows, referenceRows } from "./index";

const TOP_MERCHANTS = 6;
const HISTORY_MONTHS = 12;

export async function getInsights(
  userId: string,
  period: Period,
  comparison: Comparison,
): Promise<InsightsData> {
  const accountIds = await visibleAccountIds(userId);
  const [current, prev, aliases] = await Promise.all([
    loadRows(accountIds, period, { withLabels: true }),
    referenceRows(accountIds, comparison),
    listAliasGroups(userId),
  ]);

  const income = incomeByCategory(current.rows, prev);
  return {
    changes: categoryChanges(current.rows, prev),
    merchants: topMerchants(merchantRowsOf(current.rows), TOP_MERCHANTS, aliasMap(aliases)),
    aliasGroups: aliases,
    income,
    incomeTotal: round2(income.reduce((s, i) => s + i.current, 0)),
  };
}

// One load over the whole window so links spanning two months collapse like on the dashboard.
export async function getCategoryHistory(
  userId: string,
  period: Period,
  now: Date = new Date(),
): Promise<CategoryHistory> {
  const months = historyMonths(period, HISTORY_MONTHS, now);
  const last = months[months.length - 1];
  const accountIds = await visibleAccountIds(userId);
  const [{ rows }, first] = await Promise.all([
    loadRows(accountIds, monthsSpan(months)),
    firstTransactionDate(accountIds),
  ]);
  const dataStart = first
    ? months.findIndex((m) => monthPeriod(m.year, m.month).to >= first)
    : months.length;
  return {
    months,
    inProgress: periodInProgress(monthPeriod(last.year, last.month), now),
    dataStart: dataStart === -1 ? months.length : dataStart,
    series: monthlyCategoryTotals(rows, months),
  };
}

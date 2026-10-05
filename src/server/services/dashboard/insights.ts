import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { listVisibleForUser } from "@/server/services/accounts";
import { round2 } from "@/lib/budgets";
import {
  averageMonthRows,
  categoryChanges,
  incomeByCategory,
  monthlyCategoryTotals,
  topMerchants,
  type AmountRow,
  type CategoryHistory,
  type InsightsData,
  type MerchantRow,
} from "@/lib/insights";
import {
  historyMonths,
  monthPeriod,
  monthsSpan,
  periodInProgress,
  type Comparison,
  type Period,
} from "@/lib/period";
import { loadRows } from "./index";

const TOP_MERCHANTS = 6;
const HISTORY_MONTHS = 12;

export async function getInsights(
  userId: string,
  period: Period,
  comparison: Comparison,
): Promise<InsightsData> {
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);
  const [current, prev] = await Promise.all([
    loadRows(accountIds, period, { withLabels: true }),
    referenceRows(accountIds, comparison),
  ]);

  // Only the rows a merchant can come from are decrypted.
  const merchantRows: MerchantRow[] = current.rows
    .filter((r) => r.amount < 0 && r.type !== "TRANSFER" && r.labelEnc)
    .map((r) => ({
      amount: r.amount,
      categoryId: r.categoryId,
      date: r.date,
      type: r.type,
      label: decrypt(r.labelEnc!, dataKey),
    }));

  const income = incomeByCategory(current.rows, prev);
  return {
    changes: categoryChanges(current.rows, prev),
    merchants: topMerchants(merchantRows, TOP_MERCHANTS),
    income,
    incomeTotal: round2(income.reduce((s, i) => s + i.current, 0)),
  };
}

// The side the period is compared with: the previous period, or one average month
// built from a single load over the N months (links collapse across month boundaries).
async function referenceRows(accountIds: string[], comparison: Comparison): Promise<AmountRow[]> {
  const { months, elapsedDays } = comparison;
  if (months.length === 0) return (await loadRows(accountIds, comparison.previous)).rows;
  const { rows } = await loadRows(accountIds, monthsSpan(months));
  return averageMonthRows(rows, months.length, elapsedDays);
}

// One load over the whole window so links spanning two months collapse like on the dashboard.
export async function getCategoryHistory(
  userId: string,
  period: Period,
  now: Date = new Date(),
): Promise<CategoryHistory> {
  const months = historyMonths(period, HISTORY_MONTHS, now);
  const last = months[months.length - 1];
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);
  const { rows } = await loadRows(accountIds, monthsSpan(months));
  return {
    months,
    inProgress: periodInProgress(monthPeriod(last.year, last.month), now),
    series: monthlyCategoryTotals(rows, months),
  };
}

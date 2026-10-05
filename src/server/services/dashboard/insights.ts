import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { listVisibleForUser } from "@/server/services/accounts";
import { round2 } from "@/lib/budgets";
import {
  categoryChanges,
  incomeByCategory,
  monthlyCategoryTotals,
  topMerchants,
  type CategoryHistory,
  type InsightsData,
  type MerchantRow,
} from "@/lib/insights";
import { historyMonths, monthPeriod, periodInProgress, type Period } from "@/lib/period";
import { loadRows } from "./index";

const TOP_MERCHANTS = 6;
const HISTORY_MONTHS = 12;

export async function getInsights(
  userId: string,
  period: Period,
  previous: Period,
): Promise<InsightsData> {
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);
  const [current, prev] = await Promise.all([
    loadRows(accountIds, period, { withLabels: true }),
    loadRows(accountIds, previous),
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

  const income = incomeByCategory(current.rows, prev.rows);
  return {
    changes: categoryChanges(current.rows, prev.rows),
    merchants: topMerchants(merchantRows, TOP_MERCHANTS),
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
  const first = months[0];
  const last = monthPeriod(months[months.length - 1].year, months[months.length - 1].month);
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);
  const { rows } = await loadRows(accountIds, {
    from: monthPeriod(first.year, first.month).from,
    to: last.to,
    year: null,
    month: null,
  });
  return {
    months,
    inProgress: periodInProgress(last, now),
    series: monthlyCategoryTotals(rows, months),
  };
}

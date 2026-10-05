import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { listVisibleForUser } from "@/server/services/accounts";
import { listAliasGroups } from "@/server/services/merchants";
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
import {
  historyMonths,
  monthPeriod,
  monthsSpan,
  periodInProgress,
  type Comparison,
  type Period,
} from "@/lib/period";
import { loadRows, referenceRows } from "./index";

const TOP_MERCHANTS = 6;
const HISTORY_MONTHS = 12;

export async function getInsights(
  userId: string,
  period: Period,
  comparison: Comparison,
): Promise<InsightsData> {
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);
  const [current, prev, aliases] = await Promise.all([
    loadRows(accountIds, period, { withLabels: true }),
    referenceRows(accountIds, comparison),
    listAliasGroups(userId),
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
    merchants: topMerchants(
      merchantRows,
      TOP_MERCHANTS,
      new Map(aliases.flatMap((g) => g.keys.map((k) => [k, g.name] as const))),
    ),
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
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);
  const { rows } = await loadRows(accountIds, monthsSpan(months));
  return {
    months,
    inProgress: periodInProgress(monthPeriod(last.year, last.month), now),
    series: monthlyCategoryTotals(rows, months),
  };
}

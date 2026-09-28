import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { listVisibleForUser } from "@/server/services/accounts";
import { round2 } from "@/lib/budgets";
import {
  categoryChanges,
  incomeByCategory,
  topMerchants,
  type InsightsData,
  type MerchantRow,
} from "@/lib/insights";
import type { Period } from "@/lib/period";
import { loadRows } from "./index";

const TOP_MERCHANTS = 6;

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

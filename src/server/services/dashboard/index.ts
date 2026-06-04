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

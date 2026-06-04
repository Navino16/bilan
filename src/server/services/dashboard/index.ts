import { db } from "@/server/db";
import { listVisibleForUser } from "@/server/services/accounts";
import { listTransactions, type TransactionListItem } from "@/server/services/transactions";
import type { Period } from "@/lib/period";

export type DashboardTotals = { income: number; expense: number; net: number; count: number };
export type TracePoint = { date: string; amount: number };
// The expense trace adapts its bucket size to the period length so a year or
// quarter doesn't render 365 one-pixel bars: ≤ ~6 weeks → one bucket per day,
// longer → one per calendar month.
export type DashboardTrace = { granularity: "day" | "month"; points: TracePoint[] };
export type DashboardData = {
  totals: DashboardTotals;
  previous: Pick<DashboardTotals, "income" | "expense" | "net">;
  byCategory: { categoryId: string | null; amount: number }[];
  trace: DashboardTrace;
  recent: TransactionListItem[];
};

// Above this span the daily trace becomes unreadable → switch to monthly buckets.
const DAILY_TRACE_MAX_DAYS = 45;

type ExpenseRow = { amount: unknown; date: Date };

// One bucket per UTC day of the period.
function dailyTrace(rows: ExpenseRow[], period: Period): DashboardTrace {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const byDay = new Map<string, number>();
  for (let t = period.from.getTime(); t <= period.to.getTime(); t += 86_400_000) {
    byDay.set(dayKey(new Date(t)), 0);
  }
  for (const r of rows) {
    const k = dayKey(r.date);
    if (byDay.has(k)) byDay.set(k, byDay.get(k)! - Number(r.amount));
  }
  const points = [...byDay.entries()].map(([date, amount]) => ({ date, amount: round2(amount) }));
  points.sort((a, b) => a.date.localeCompare(b.date));
  return { granularity: "day", points };
}

// One bucket per calendar month spanned by the period (keyed by its 1st day).
function monthlyTrace(rows: ExpenseRow[], period: Period): DashboardTrace {
  const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const byMonth = new Map<string, number>();
  let y = period.from.getUTCFullYear();
  let m = period.from.getUTCMonth();
  const endY = period.to.getUTCFullYear();
  const endM = period.to.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    byMonth.set(monthKey(y, m), 0);
    if (++m > 11) {
      m = 0;
      y++;
    }
  }
  for (const r of rows) {
    const k = monthKey(r.date.getUTCFullYear(), r.date.getUTCMonth());
    if (byMonth.has(k)) byMonth.set(k, byMonth.get(k)! - Number(r.amount));
  }
  const points = [...byMonth.entries()].map(([date, amount]) => ({ date, amount: round2(amount) }));
  points.sort((a, b) => a.date.localeCompare(b.date));
  return { granularity: "month", points };
}

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
  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    count: rows.length,
  };
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

  // Day-by-day for short spans, month-by-month for longer ones (quarter/year).
  const spanDays = Math.round((period.to.getTime() - period.from.getTime() + 1) / 86_400_000);
  const trace =
    spanDays > DAILY_TRACE_MAX_DAYS
      ? monthlyTrace(expenseRows, period)
      : dailyTrace(expenseRows, period);

  const { items: recent } = await listTransactions(userId, {
    from: period.from,
    to: period.to,
    take: 6,
  });

  return {
    totals,
    previous: { income: prev.income, expense: prev.expense, net: prev.net },
    byCategory,
    trace,
    recent,
  };
}

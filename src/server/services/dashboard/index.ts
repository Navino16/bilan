import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "@/server/db";
import { visibleAccountIds } from "@/server/services/accounts";
import { linkIdsWhere } from "@/server/services/links/members";
import { listTransactions, type TransactionListItem } from "@/server/services/transactions";
import { collapseLinkedRows, type CollapsibleRow } from "@/lib/links";
import { averageMonthRows, type AmountRow } from "@/lib/insights";
import { monthPeriod, monthsSpan, type Comparison, type Period } from "@/lib/period";
import { netSavings } from "./savings";

export type DashboardTotals = { income: number; expense: number; net: number; count: number };
export type TracePoint = { date: string; amount: number };
// The highest-spend bucket: its date, amount, and the category that drove it.
export type TracePeak = { date: string; amount: number; categoryId: string | null };
// The expense trace adapts its bucket size to the period length so a year or
// quarter doesn't render 365 one-pixel bars: ≤ ~6 weeks → one bucket per day,
// longer → one per calendar month. `avg` is the mean spend per bucket and `peak`
// is the biggest bucket (null when nothing was spent).
export type DashboardTrace = {
  granularity: "day" | "month";
  points: TracePoint[];
  avg: number;
  peak: TracePeak | null;
};
export type DashboardData = {
  totals: DashboardTotals;
  previous: Pick<DashboardTotals, "income" | "expense" | "net">;
  byCategory: { categoryId: string | null; amount: number }[];
  trace: DashboardTrace;
  recent: TransactionListItem[];
  savings: { current: number; previous: number };
};

// Above this span the daily trace becomes unreadable → switch to monthly buckets.
const DAILY_TRACE_MAX_DAYS = 45;

type ExpenseRow = { amount: number; date: Date; categoryId: string | null };

// Mean spend per bucket + the biggest bucket and the category that drove it.
// Buckets in the future or before the first transaction don't dilute the average.
function summarize(
  granularity: "day" | "month",
  points: TracePoint[],
  rows: ExpenseRow[],
  keyOf: (d: Date) => string,
  now: Date,
  first: Date | null,
): DashboardTrace {
  const elapsed = points.filter((p) => p.date <= keyOf(now) && (!first || p.date >= keyOf(first)));
  const avg = elapsed.length
    ? round2(elapsed.reduce((s, p) => s + p.amount, 0) / elapsed.length)
    : 0;

  const top = points.reduce<TracePoint | null>((a, p) => (a && a.amount >= p.amount ? a : p), null);
  let peak: TracePeak | null = null;
  if (top && top.amount > 0) {
    const byCat = new Map<string | null, number>();
    for (const r of rows) {
      if (keyOf(r.date) === top.date) {
        byCat.set(r.categoryId, (byCat.get(r.categoryId) ?? 0) - Number(r.amount));
      }
    }
    const topCat = [...byCat.entries()].reduce<[string | null, number] | null>(
      (a, e) => (a && a[1] >= e[1] ? a : e),
      null,
    );
    peak = { date: top.date, amount: top.amount, categoryId: topCat ? topCat[0] : null };
  }

  return { granularity, points, avg, peak };
}

// One bucket per UTC day of the period.
function dailyTrace(
  rows: ExpenseRow[],
  period: Period,
  now: Date,
  first: Date | null,
): DashboardTrace {
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
  return summarize("day", points, rows, dayKey, now, first);
}

// One bucket per calendar month spanned by the period (keyed by its 1st day).
function monthlyTrace(
  rows: ExpenseRow[],
  period: Period,
  now: Date,
  first: Date | null,
): DashboardTrace {
  const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const dateKey = (d: Date) => monthKey(d.getUTCFullYear(), d.getUTCMonth());
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
    const k = dateKey(r.date);
    if (byMonth.has(k)) byMonth.set(k, byMonth.get(k)! - Number(r.amount));
  }
  const points = [...byMonth.entries()].map(([date, amount]) => ({ date, amount: round2(amount) }));
  points.sort((a, b) => a.date.localeCompare(b.date));
  return summarize("month", points, rows, dateKey, now, first);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type AggRow = CollapsibleRow & { accountId: string; type: string; labelEnc: string | null };

// Loads the period's rows over CLEAR columns only (amount/date/categoryId +
// link id) and collapses links: balanced groups drop out, unbalanced groups
// become one net row on their primary. `count` is the number of REAL
// transactions in the period (pre-collapse) — a linked pair is still two
// transactions the user made. Labels stay encrypted unless `withLabels` asks for
// the ciphertext (merchant rows decrypt it). Rows carry the month they count toward
// (`periodDate`, #341) unless `realDates` asks for the transaction's own date.
export async function loadRows(
  accountIds: string[],
  period: Period,
  opts: { withLabels?: boolean; realDates?: boolean; where?: Prisma.TransactionWhereInput } = {},
): Promise<{ rows: AggRow[]; count: number }> {
  const withLabels = opts.withLabels ?? false;
  const realDates = opts.realDates ?? false;
  if (accountIds.length === 0) return { rows: [], count: 0 };
  const where: Prisma.TransactionWhereInput = {
    accountId: { in: accountIds },
    periodDate: { gte: period.from, lte: period.to },
    ...opts.where,
  };
  const [rows, linkIds] = await Promise.all([
    db.transaction.findMany({
      where,
      select: {
        id: true,
        amount: true,
        periodDate: !realDates,
        date: realDates,
        categoryId: true,
        accountId: true,
        type: true,
        labelEnc: withLabels,
      },
    }),
    linkIdsWhere(where),
  ]);
  const collapsed = collapseLinkedRows(
    rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      date: realDates ? r.date : r.periodDate,
      categoryId: r.categoryId,
      accountId: r.accountId,
      type: r.type,
      labelEnc: withLabels ? r.labelEnc : null,
      linkId: linkIds.get(r.id) ?? null,
    })),
  );
  return { rows: collapsed, count: rows.length };
}

// Memoized per render by array identity: getDashboard passes the same ids twice.
export const firstTransactionDate = cache(async (accountIds: string[]): Promise<Date | null> => {
  if (accountIds.length === 0) return null;
  const first = await db.transaction.findFirst({
    where: { accountId: { in: accountIds } },
    orderBy: { periodDate: "asc" },
    select: { periodDate: true },
  });
  return first?.periodDate ?? null;
});

function totalsOf(rows: { amount: number }[], count: number): DashboardTotals {
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r.amount >= 0) income += r.amount;
    else expense += -r.amount;
  }
  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    count,
  };
}

// The side the period is compared with: the previous period, or one average month
// built from a single load over the N months (links collapse across month boundaries).
export async function referenceRows(
  accountIds: string[],
  comparison: Comparison,
): Promise<AmountRow[]> {
  const { months, elapsedDays } = comparison;
  if (months.length === 0) return (await loadRows(accountIds, comparison.previous)).rows;
  const [{ rows }, first] = await Promise.all([
    loadRows(accountIds, monthsSpan(months)),
    firstTransactionDate(accountIds),
  ]);
  // Months before the first transaction hold no data, not zero spending; while the
  // period is in progress only their first `elapsedDays` days are compared.
  const recorded = months.filter((m) => {
    const { from, to } = monthPeriod(m.year, m.month);
    const end = elapsedDays ? new Date(from.getTime() + elapsedDays * 86_400_000 - 1) : to;
    return first && end >= first;
  });
  return recorded.length ? averageMonthRows(rows, recorded.length, elapsedDays) : [];
}

export async function getDashboard(
  userId: string,
  period: Period,
  comparison: Comparison,
  now: Date = new Date(),
): Promise<DashboardData> {
  const accountIds = await visibleAccountIds(userId);

  // Independent queries for the two periods → run them together.
  const { months } = comparison;
  const [current, previousLoaded, first, savedNow, savedBefore] = await Promise.all([
    loadRows(accountIds, period),
    referenceRows(accountIds, comparison),
    firstTransactionDate(accountIds),
    netSavings(userId, accountIds, period),
    netSavings(userId, accountIds, months.length ? monthsSpan(months) : comparison.previous),
  ]);
  const totals = totalsOf(current.rows, current.count);
  const prev = totalsOf(previousLoaded, 0);

  // Expenses (post-collapse) for by-category + trace.
  const expenseRows: ExpenseRow[] = current.rows
    .filter((r) => r.amount < 0)
    .map((r) => ({ amount: r.amount, date: r.date, categoryId: r.categoryId }));

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
      ? monthlyTrace(expenseRows, period, now, first)
      : dailyTrace(expenseRows, period, now, first);

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
    savings: {
      current: savedNow,
      previous: months.length ? round2(savedBefore / months.length) : savedBefore,
    },
  };
}

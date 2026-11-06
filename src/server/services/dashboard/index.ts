import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { db } from "@/server/db";
import { visibleAccountIds } from "@/server/services/accounts";
import { linkIdsWhere } from "@/server/services/links/members";
import { listTransactions, type TransactionListItem } from "@/server/services/transactions";
import { collapseLinkedRows, type CollapsibleRow } from "@/lib/links";
import { averageMonthRows, type AmountRow } from "@/lib/insights";
import {
  monthPeriod,
  monthsSpan,
  periodInProgress,
  previousPeriod,
  toIsoDay,
  type Comparison,
  type Period,
} from "@/lib/period";
import {
  bucketCount,
  bucketIndex,
  cumulativeSpending,
  paceGranularity,
  type SpendingPace,
} from "@/lib/pace";
import { countedRow, netSavings, savingsScope, type SavingsScope } from "./savings";

export type DashboardTotals = { income: number; expense: number; net: number; count: number };
export type TodoCount = { count: number; amount: number };
export type DashboardData = {
  totals: DashboardTotals;
  previous: Pick<DashboardTotals, "income" | "expense" | "net">;
  byCategory: { categoryId: string | null; amount: number }[];
  pace: SpendingPace;
  recent: TransactionListItem[];
  savings: { current: number; previous: number };
  // Unlinked uncategorized operations dated in the period (a linked one is already accounted for).
  uncategorized: { out: TodoCount; in: TodoCount };
  // Unlinked operations in a neutral subtree: a transfer leg missing its counterpart.
  // `categoryId` is the neutral category holding them all, when there is one.
  neutral: TodoCount & { categoryId: string | null };
};

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
  // Link members outside the period only net their link: a group counts in the period that
  // holds its primary, like budgets (#412).
  const loadedIds = new Set(rows.map((r) => r.id));
  const partners = linkIds.size
    ? await db.transaction.findMany({
        where: {
          AND: [
            { accountId: { in: accountIds } },
            opts.where ?? {},
            { OR: [{ periodDate: { lt: period.from } }, { periodDate: { gt: period.to } }] },
            { linkMembership: { linkId: { in: [...new Set(linkIds.values())] } } },
          ],
        },
        select: {
          id: true,
          amount: true,
          periodDate: !realDates,
          date: realDates,
          categoryId: true,
          accountId: true,
          type: true,
          labelEnc: withLabels,
          linkMembership: { select: { linkId: true } },
        },
      })
    : [];
  const toRow = (r: (typeof rows)[number], linkId: string | null): AggRow => ({
    id: r.id,
    amount: Number(r.amount),
    date: realDates ? r.date : r.periodDate,
    categoryId: r.categoryId,
    accountId: r.accountId,
    type: r.type,
    labelEnc: withLabels ? r.labelEnc : null,
    linkId,
  });
  const collapsed = collapseLinkedRows([
    ...rows.map((r) => toRow(r, linkIds.get(r.id) ?? null)),
    ...partners.map((r) => toRow(r, r.linkMembership!.linkId)),
  ]).filter((r) => loadedIds.has(r.id));
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

// The whole reference side: the previous period, or the months averaged that hold data (`average`
// of them; months before the first transaction hold no data, not zero spending).
type Reference = { rows: AggRow[]; average: number | null };

async function loadReference(
  accountIds: string[],
  period: Period,
  comparison: Comparison,
): Promise<Reference> {
  const { months, elapsedDays } = comparison;
  if (months.length === 0) {
    return { rows: (await loadRows(accountIds, previousPeriod(period))).rows, average: null };
  }
  const [{ rows }, first] = await Promise.all([
    loadRows(accountIds, monthsSpan(months)),
    firstTransactionDate(accountIds),
  ]);
  // While the period is in progress, only each month's first `elapsedDays` days are compared.
  const recorded = months.filter((m) => {
    const { from, to } = monthPeriod(m.year, m.month);
    const end = elapsedDays ? new Date(from.getTime() + elapsedDays * 86_400_000 - 1) : to;
    return first && end >= first;
  });
  return { rows, average: recorded.length };
}

// What the period is compared with: the reference cut to the same date while in progress.
function sameDateRows(reference: Reference, comparison: Comparison): AmountRow[] {
  const { rows, average } = reference;
  if (average === null) return rows.filter((r) => r.date <= comparison.previous.to);
  return average ? averageMonthRows(rows, average, comparison.elapsedDays) : [];
}

export async function referenceRows(
  accountIds: string[],
  period: Period,
  comparison: Comparison,
  keep: (row: AggRow) => boolean = () => true,
): Promise<AmountRow[]> {
  const reference = await loadReference(accountIds, period, comparison);
  return sameDateRows({ ...reference, rows: reference.rows.filter(keep) }, comparison);
}

// Net savings of the reference side, averaged like `referenceRows`: recorded months only,
// each cut to the elapsed days while the period is in progress.
async function savingsReference(scope: SavingsScope, comparison: Comparison): Promise<number> {
  const { months, elapsedDays } = comparison;
  if (months.length === 0) return netSavings(scope, comparison.previous);
  const first = await firstTransactionDate(scope.accountIds);
  const windows = months
    .map((m) => monthPeriod(m.year, m.month))
    .map((p) =>
      elapsedDays ? { ...p, to: new Date(p.from.getTime() + elapsedDays * 86_400_000 - 1) } : p,
    )
    .filter((p) => first && p.to >= first);
  if (windows.length === 0) return 0;
  const sums = await Promise.all(windows.map((p) => netSavings(scope, p)));
  return round2(sums.reduce((a, b) => a + b, 0) / windows.length);
}

// Cumulative spending of the period against the whole reference at the same offsets: the same
// day of an averaged month, else the same day or month of the previous period.
function spendingPace(
  rows: AggRow[],
  reference: Reference,
  period: Period,
  now: Date,
): SpendingPace {
  const granularity = paceGranularity(period);
  const buckets = bucketCount(period, granularity);
  const inProgress = periodInProgress(period, now);
  const current = cumulativeSpending(
    rows,
    (d) => bucketIndex(d, period.from, granularity),
    buckets,
  );
  const refStart = previousPeriod(period).from;
  const hasReference = reference.rows.length > 0 && reference.average !== 0;
  return {
    granularity,
    start: toIsoDay(period.from),
    buckets,
    asOf: toIsoDay(inProgress ? now : period.to),
    current: inProgress
      ? current.slice(0, bucketIndex(now, period.from, granularity) + 1)
      : current,
    reference: hasReference
      ? cumulativeSpending(
          reference.rows,
          reference.average === null
            ? (d) => bucketIndex(d, refStart, granularity)
            : (d) => d.getUTCDate() - 1,
          buckets,
          reference.average === null ? 1 : 1 / reference.average,
        )
      : null,
  };
}

async function uncategorizedCounts(
  accountIds: string[],
  period: Period,
): Promise<DashboardData["uncategorized"]> {
  const count = async (amount: Prisma.DecimalFilter<"Transaction">): Promise<TodoCount> => {
    const { _count, _sum } = await db.transaction.aggregate({
      where: {
        accountId: { in: accountIds },
        categoryId: null,
        date: { gte: period.from, lte: period.to },
        linkMembership: { is: null },
        amount,
      },
      _count: true,
      _sum: { amount: true },
    });
    return { count: _count, amount: round2(Math.abs(Number(_sum.amount ?? 0))) };
  };
  const [out, inflow] = await Promise.all([count({ lt: 0 }), count({ gt: 0 })]);
  return { out, in: inflow };
}

// Amounts summed in absolute value: both legs of a transfer are money to account for.
async function unlinkedNeutral(
  scope: SavingsScope,
  period: Period,
): Promise<DashboardData["neutral"]> {
  const none = { count: 0, amount: 0, categoryId: null };
  if (scope.neutralIds.size === 0) return none;
  const where = {
    accountId: { in: scope.accountIds },
    categoryId: { in: [...scope.neutralIds] },
    date: { gte: period.from, lte: period.to },
    linkMembership: { is: null },
  };
  const [out, inflow] = await Promise.all(
    [{ lt: 0 }, { gt: 0 }].map((amount) =>
      db.transaction.groupBy({
        by: ["categoryId"],
        where: { ...where, amount },
        _count: true,
        _sum: { amount: true },
      }),
    ),
  );
  const groups = [...out, ...inflow];
  if (groups.length === 0) return none;
  const ids = new Set(groups.map((g) => g.categoryId!));
  const parents = new Map(
    (
      await db.category.findMany({
        where: { id: { in: [...scope.neutralIds] } },
        select: { id: true, parentId: true },
      })
    ).map((c) => [c.id, c.parentId]),
  );
  const topOf = (id: string): string => {
    const parent = parents.get(id);
    return parent && scope.neutralIds.has(parent) ? topOf(parent) : id;
  };
  const tops = new Set([...ids].map(topOf));
  return {
    count: groups.reduce((n, g) => n + g._count, 0),
    amount: round2(groups.reduce((s, g) => s + Math.abs(Number(g._sum.amount ?? 0)), 0)),
    categoryId: ids.size === 1 ? [...ids][0] : tops.size === 1 ? [...tops][0] : null,
  };
}

export async function getDashboard(
  userId: string,
  period: Period,
  comparison: Comparison,
  now: Date = new Date(),
): Promise<DashboardData> {
  const accountIds = await visibleAccountIds(userId);

  const [loaded, reference, scope, uncategorized] = await Promise.all([
    loadRows(accountIds, period),
    loadReference(accountIds, period, comparison),
    savingsScope(userId, accountIds),
    uncategorizedCounts(accountIds, period),
  ]);
  const counted = (rows: AggRow[]) => rows.filter((r) => countedRow(scope, r));
  const rows = counted(loaded.rows);
  const referenceSide = { ...reference, rows: counted(reference.rows) };
  const totals = totalsOf(rows, loaded.count);
  const prev = totalsOf(sameDateRows(referenceSide, comparison), 0);

  const byCat = new Map<string | null, number>();
  for (const r of rows) {
    if (r.amount < 0) byCat.set(r.categoryId, (byCat.get(r.categoryId) ?? 0) - r.amount);
  }
  const byCategory = [...byCat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const [savedNow, savedBefore, { items: recent }, neutral] = await Promise.all([
    netSavings(scope, period),
    savingsReference(scope, comparison),
    listTransactions(userId, { from: period.from, to: period.to, take: 6 }),
    unlinkedNeutral(scope, period),
  ]);

  return {
    totals,
    previous: { income: prev.income, expense: prev.expense, net: prev.net },
    byCategory,
    pace: spendingPace(rows, referenceSide, period, now),
    recent,
    savings: { current: savedNow, previous: savedBefore },
    uncategorized,
    neutral,
  };
}

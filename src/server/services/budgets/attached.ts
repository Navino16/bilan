// Budgets attached to an account (design §B–§E): mirrors, transfer context and per-kind sums.
// Every loader runs a constant number of queries for any number of budgets (#299).
import { db } from "@/server/db";
import { AUTO_LINK_WINDOW_DAYS, collapseLinkedRows, pairKeyOf } from "@/lib/links";
import { bucketRow, lineFlow, type MatchLine, type RowBucket } from "@/lib/budget-match";
import {
  budgetLanding,
  lineStatus,
  round2,
  type BudgetLanding,
  type LineStatus,
} from "@/lib/budgets";
import type { BudgetLineKind, TransferDirection } from "@/lib/validation/budget";
import { linkPartners, type LinkPartner } from "@/server/services/links/members";

export type BudgetRow = {
  id: string;
  amount: number;
  date: Date;
  periodDate: Date;
  categoryId: string | null;
  accountId: string;
  linkId: string | null;
};

export type LoadedBudgetRows = {
  rows: BudgetRow[];
  excluded: Set<string>;
  includedIds: Set<string>;
  scope: Set<string>; // account ids the budget's owner scope draws from
};

export type BudgetLineSpec = {
  id: string;
  kind: BudgetLineKind;
  categoryId: string | null;
  accountId: string | null;
  direction: TransferDirection | null;
  counterpartAccountId: string | null;
  label: string | null;
  plannedAmount: number;
  mirrorOf: { budgetId: string; budgetName: string } | null;
};

type AttachedRef = {
  id: string;
  accountId: string | null;
  periodType: string;
  periodStart: Date;
  lines: { kind: string; direction: string | null; counterpartAccountId: string | null }[];
};

const reversed = (d: string | null): TransferDirection => (d === "OUT" ? "IN" : "OUT");

// Transfer lines of other attached budgets pointing at each budget's account, shown there
// read-only (design §C): same period type and start, source readable by the viewer, and no
// own line on that counterpart in that direction.
export async function budgetMirrors(
  budgets: AttachedRef[],
  viewer: { userId: string; groupIds: string[] },
): Promise<Map<string, BudgetLineSpec[]>> {
  const attached = budgets.filter((b) => b.accountId);
  const out = new Map<string, BudgetLineSpec[]>();
  if (attached.length === 0) return out;
  const sources = await db.budgetLine.findMany({
    where: {
      kind: "TRANSFER",
      counterpartAccountId: { in: [...new Set(attached.map((b) => b.accountId!))] },
      budget: {
        archived: false,
        accountId: { not: null },
        periodStart: {
          in: [...new Set(attached.map((b) => b.periodStart.getTime()))].map((t) => new Date(t)),
        },
        OR: [{ userId: viewer.userId }, { groupId: { in: viewer.groupIds } }],
      },
    },
    select: {
      id: true,
      label: true,
      plannedAmount: true,
      direction: true,
      counterpartAccountId: true,
      budget: {
        select: { id: true, name: true, accountId: true, periodType: true, periodStart: true },
      },
    },
    orderBy: { id: "asc" },
  });
  for (const b of attached) {
    const mirrors = sources.flatMap((s) => {
      const direction = reversed(s.direction);
      const from = s.budget.accountId!;
      const matches =
        s.counterpartAccountId === b.accountId &&
        s.budget.id !== b.id &&
        from !== b.accountId &&
        s.budget.periodType === b.periodType &&
        s.budget.periodStart.getTime() === b.periodStart.getTime() &&
        !b.lines.some(
          (l) =>
            l.kind === "TRANSFER" && l.direction === direction && l.counterpartAccountId === from,
        );
      if (!matches) return [];
      return [
        {
          id: `mirror:${s.id}`,
          kind: "TRANSFER" as const,
          categoryId: null,
          accountId: null,
          direction,
          counterpartAccountId: from,
          label: s.label,
          plannedAmount: Number(s.plannedAmount),
          mirrorOf: { budgetId: s.budget.id, budgetName: s.budget.name },
        },
      ];
    });
    if (mirrors.length > 0) out.set(b.id, mirrors);
  }
  return out;
}

type RowContext = { partners: LinkPartner[]; pending: string[] };

export type TransferContext = {
  rows: Map<string, Map<string, RowContext>>; // budget id → row id → context
  accountTypes: Map<string, string>; // counterpart and pending accounts
};

const DAY = 86_400_000;
const cents = (n: number) => Math.round(n * 100);

// Link partners of each attached budget's rows, and for its unlinked rows the accounts holding
// an opposite same-amount unlinked row within the auto-link window (a pending transfer leg).
// Only transfer counterparts and savings accounts count, so a coincidental amount elsewhere
// doesn't turn a refund into a transfer, and neither does a pair the viewer dismissed.
export async function loadTransferContext(
  budgets: {
    id: string;
    accountId: string | null;
    lines: { counterpartAccountId: string | null }[];
  }[],
  loaded: Map<string, LoadedBudgetRows>,
  mirrors: Map<string, BudgetLineSpec[]>,
  viewerId: string,
): Promise<TransferContext> {
  const attached = budgets.filter((b) => b.accountId);
  const ctx: TransferContext = { rows: new Map(), accountTypes: new Map() };
  if (attached.length === 0) return ctx;

  const searchedOf = new Map<string, Set<string>>();
  const unlinkedOwn: BudgetRow[] = [];
  for (const b of attached) {
    const { scope, rows } = loaded.get(b.id)!;
    const searched = new Set([
      ...scope,
      ...(mirrors.get(b.id) ?? []).map((m) => m.counterpartAccountId!),
    ]);
    searched.delete(b.accountId!);
    searchedOf.set(b.id, searched);
    unlinkedOwn.push(...rows.filter((r) => r.accountId === b.accountId && r.linkId == null));
  }
  const allRows = attached.flatMap((b) => loaded.get(b.id)!.rows);
  const searchedAccounts = [...new Set(attached.flatMap((b) => [...searchedOf.get(b.id)!]))];
  const counterparts = attached.flatMap((b) =>
    b.lines.flatMap((l) => (l.counterpartAccountId ? [l.counterpartAccountId] : [])),
  );
  const times = unlinkedOwn.map((r) => r.date.getTime());

  const [partners, candidates, types, dismissed] = await Promise.all([
    linkPartners([...new Set(allRows.flatMap((r) => (r.linkId ? [r.linkId] : [])))]),
    unlinkedOwn.length === 0 || searchedAccounts.length === 0
      ? []
      : db.transaction.findMany({
          where: {
            accountId: { in: searchedAccounts },
            linkMembership: { is: null },
            amount: { in: [...new Set(unlinkedOwn.map((r) => -cents(r.amount) / 100))] },
            date: {
              gte: new Date(Math.min(...times) - AUTO_LINK_WINDOW_DAYS * DAY),
              lte: new Date(Math.max(...times) + AUTO_LINK_WINDOW_DAYS * DAY),
            },
          },
          select: { id: true, accountId: true, amount: true, date: true },
        }),
    db.bankAccount.findMany({
      where: { id: { in: [...new Set([...counterparts, ...searchedAccounts])] } },
      select: { id: true, type: true },
    }),
    unlinkedOwn.length === 0
      ? []
      : db.ignoredLinkSuggestion.findMany({
          where: { userId: viewerId, restoredAt: null },
          select: { pairKey: true },
        }),
  ]);
  const ignored = new Set(dismissed.map((r) => r.pairKey));
  for (const t of types) ctx.accountTypes.set(t.id, t.type);
  for (const b of attached) {
    const counterparts = new Set(b.lines.map((l) => l.counterpartAccountId));
    const searched = searchedOf.get(b.id)!;
    for (const a of searched)
      if (!counterparts.has(a) && ctx.accountTypes.get(a) !== "SAVINGS") searched.delete(a);
  }
  const byCents = new Map<number, { id: string; accountId: string; date: Date }[]>();
  for (const c of candidates) {
    const key = cents(Number(c.amount));
    byCents.set(key, [...(byCents.get(key) ?? []), c]);
  }

  for (const b of attached) {
    const searched = searchedOf.get(b.id)!;
    const rows = new Map<string, RowContext>();
    for (const r of loaded.get(b.id)!.rows) {
      const linked = r.linkId
        ? (partners.get(r.linkId) ?? []).filter(
            (p) => p.transactionId !== r.id && p.accountId !== r.accountId,
          )
        : [];
      const pending =
        r.linkId == null && r.accountId === b.accountId
          ? (byCents.get(-cents(r.amount)) ?? [])
              .filter(
                (c) =>
                  searched.has(c.accountId) &&
                  Math.abs(c.date.getTime() - r.date.getTime()) <= AUTO_LINK_WINDOW_DAYS * DAY &&
                  !ignored.has(pairKeyOf(r.id, c.id)),
              )
              .map((c) => c.accountId)
          : [];
      rows.set(r.id, { partners: linked, pending: [...new Set(pending)] });
    }
    ctx.rows.set(b.id, rows);
  }
  return ctx;
}

export type AttachedSpend = {
  lineSums: number[]; // signed
  lineSumsOnAccount: number[]; // signed, rows on the budget's account dated ≤ now (design §E)
  lineSumsLater: number[]; // signed, rows on the account dated after now
  out: BudgetRow[];
  unplanned: BudgetRow[];
  outOnAccount: number; // signed
  outLater: number; // signed
  fromSavings: number;
  unmatchedTransfers: number;
  counted: BudgetRow[];
  bucketOf: Map<string, RowBucket>;
};

export function computeAttachedSpend(
  b: { id: string; accountId: string },
  lines: BudgetLineSpec[],
  { rows, excluded }: LoadedBudgetRows,
  subtrees: Map<string, Set<string>>,
  ctx: TransferContext,
  now: Date,
): AttachedSpend {
  const matchLines: MatchLine[] = lines.map((l) => ({
    kind: l.kind,
    categoryId: l.categoryId,
    categoryIds: l.categoryId ? (subtrees.get(l.categoryId) ?? new Set([l.categoryId])) : null,
    direction: l.direction,
    counterpartAccountId: l.counterpartAccountId,
  }));
  const rowCtx = ctx.rows.get(b.id) ?? new Map<string, RowContext>();
  const spend: AttachedSpend = {
    lineSums: lines.map(() => 0),
    lineSumsOnAccount: lines.map(() => 0),
    lineSumsLater: lines.map(() => 0),
    out: [],
    unplanned: [],
    outOnAccount: 0,
    outLater: 0,
    fromSavings: 0,
    unmatchedTransfers: 0,
    counted: [],
    bucketOf: new Map(),
  };
  for (const r of collapseLinkedRows(rows)) {
    if (excluded.has(r.id)) continue;
    const c = rowCtx.get(r.id) ?? { partners: [], pending: [] };
    const bucket = bucketRow(
      {
        amount: r.amount,
        categoryId: r.categoryId,
        partnerAccountIds: c.partners.map((p) => p.accountId),
        pendingAccountIds: c.pending,
      },
      matchLines,
    );
    const own = r.accountId === b.accountId;
    const onAccount = own && r.date <= now;
    const later = own && r.date > now;
    spend.counted.push(r);
    spend.bucketOf.set(r.id, bucket);
    if (typeof bucket === "number") {
      spend.lineSums[bucket] += r.amount;
      if (onAccount) spend.lineSumsOnAccount[bucket] += r.amount;
      if (later) spend.lineSumsLater[bucket] += r.amount;
    } else if (bucket === "out") {
      spend.out.push(r);
      if (onAccount) spend.outOnAccount += r.amount;
      if (later) spend.outLater += r.amount;
      if (c.partners.length === 0 && c.pending.length > 0) spend.unmatchedTransfers++;
    } else {
      spend.unplanned.push(r);
      const fromSavings =
        c.partners.length > 0
          ? c.partners.some((p) => p.accountType === "SAVINGS")
          : c.pending.some((a) => ctx.accountTypes.get(a) === "SAVINGS");
      if (fromSavings) spend.fromSavings += r.amount;
    }
  }
  return spend;
}

export type AttachedLineStatus = LineStatus & { counterpartSavings: boolean };

export type AttachedSummary = {
  lines: AttachedLineStatus[];
  plannedTotal: number;
  spentTotal: number;
  percent: number | null;
  status: LineStatus["status"];
  incomePlanned: number;
  incomeReceived: number;
  outOfBudget: { spent: number; count: number; planned: number | null; unmatchedTransfers: number };
  unplannedIncome: { received: number; count: number; fromSavings: number };
};

// Spending side = outgoing lines + out of budget; income side = incoming lines + unplanned
// income. Saving more than planned doesn't push the budget's status over (design item 6).
export function summarizeAttached(
  lines: BudgetLineSpec[],
  margin: number | null,
  spend: AttachedSpend,
  ctx: TransferContext,
): AttachedSummary {
  let plannedTotal = margin ?? 0;
  let savedOnTop = 0;
  let incomePlanned = 0;
  let incomeReceived = spend.unplanned.reduce((s, r) => s + r.amount, 0);
  let spentSum = -spend.out.reduce((s, r) => s + r.amount, 0);
  const statuses = lines.map((l, i) => {
    const counterpartSavings =
      l.counterpartAccountId != null && ctx.accountTypes.get(l.counterpartAccountId) === "SAVINGS";
    if (lineFlow(l) === "in") {
      incomePlanned += l.plannedAmount;
      incomeReceived += spend.lineSums[i];
      return { ...lineStatus(l.plannedAmount, round2(spend.lineSums[i])), counterpartSavings };
    }
    const spent = round2(-spend.lineSums[i]);
    plannedTotal += l.plannedAmount;
    spentSum += spent;
    if (counterpartSavings && l.kind === "TRANSFER")
      savedOnTop += Math.max(spent - l.plannedAmount, 0);
    return { ...lineStatus(l.plannedAmount, spent), counterpartSavings };
  });
  const spentTotal = round2(spentSum);
  const { percent, status } = lineStatus(round2(plannedTotal), round2(spentTotal - savedOnTop));
  return {
    lines: statuses,
    plannedTotal: round2(plannedTotal),
    spentTotal,
    percent,
    status,
    incomePlanned: round2(incomePlanned),
    incomeReceived: round2(incomeReceived),
    outOfBudget: {
      spent: round2(-spend.out.reduce((s, r) => s + r.amount, 0)),
      count: spend.out.length,
      planned: margin,
      unmatchedTransfers: spend.unmatchedTransfers,
    },
    unplannedIncome: {
      received: round2(spend.unplanned.reduce((s, r) => s + r.amount, 0)),
      count: spend.unplanned.length,
      fromSavings: round2(spend.fromSavings),
    },
  };
}

export function attachedLanding(
  lines: BudgetLineSpec[],
  margin: number | null,
  spend: AttachedSpend,
  balance: number,
): BudgetLanding {
  return budgetLanding({
    balance,
    lines: lines.map((l, i) => {
      const sign = lineFlow(l) === "in" ? 1 : -1;
      return {
        flow: lineFlow(l),
        plannedAmount: l.plannedAmount,
        doneOnAccount: sign * spend.lineSumsOnAccount[i],
        doneLater: sign * spend.lineSumsLater[i],
      };
    }),
    margin,
    outOnAccount: -spend.outOnAccount,
    outLater: -spend.outLater,
  });
}

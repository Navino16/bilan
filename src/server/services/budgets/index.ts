import { randomUUID } from "node:crypto";
import type { Budget, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { requireGroupRole } from "@/server/services/groups/roles";
import { groupMemberships } from "@/server/services/groups/memberships";
import { logEvent } from "@/server/services/audit";
import {
  listVisibleForUser,
  visibleAccountIds,
  visibleAccountRefs,
} from "@/server/services/accounts";
import { canReadAccount } from "@/server/services/accounts/sharing";
import {
  assertCategoryAssignable,
  CategoryAccessError,
  withDescendants,
} from "@/server/services/categories";
import { collapseLinkedRows } from "@/lib/links";
import { linkIdsWhere } from "@/server/services/links/members";
import {
  budgetPlannedTotal,
  lineStatus,
  nextPeriod,
  periodEndFor,
  round2,
  type BudgetStatus,
  type LineStatus,
} from "@/lib/budgets";
import { type BudgetPeriodType } from "@/lib/validation/budget";
import { budgetInputSchema, type BudgetInput } from "@/lib/schemas/budget";

export class BudgetAccessError extends Error {}

export type BudgetScope = "USER" | "GROUP";

// Membership + visibility scope shared by the list and the assignable-budgets
// dropdown so both always expose the same set of budgets. `roleByGroup` lets
// callers decide who may manage a given group budget.
async function budgetScopeForUser(
  userId: string,
): Promise<{ groupIds: string[]; roleByGroup: Map<string, string> }> {
  const memberships = await groupMemberships(userId);
  const roleByGroup = new Map(memberships.map((m) => [m.groupId, m.role]));
  return { groupIds: memberships.map((m) => m.groupId), roleByGroup };
}

// Validate the raw input; a Zod failure surfaces as a BudgetAccessError so
// callers only ever have to catch one error type.
function parseInput(input: BudgetInput) {
  const parsed = budgetInputSchema.safeParse(input);
  if (!parsed.success) throw new BudgetAccessError("INVALID");
  return parsed.data;
}

// Personal budget → nothing beyond a session. Group budget → actor must be ADMIN+.
async function assertCanManageScope(groupId: string | undefined, actorId: string): Promise<void> {
  if (groupId) {
    try {
      await requireGroupRole(groupId, actorId, "ADMIN");
    } catch {
      throw new BudgetAccessError("FORBIDDEN");
    }
  }
}

function utcBounds(
  periodType: BudgetPeriodType,
  startDay: string,
  endDay: string,
): { start: Date; end: Date } {
  const start = new Date(`${startDay}T00:00:00.000Z`);
  const end = new Date(`${endDay}T23:59:59.999Z`);
  if (end.getTime() < start.getTime()) throw new BudgetAccessError("INVALID_PERIOD");
  if (periodType !== "CUSTOM" && periodEndFor(periodType, startDay) !== endDay) {
    throw new BudgetAccessError("PERIOD_MISMATCH");
  }
  return { start, end };
}

// Lines may only reference accounts the budget draws from, and categories the
// actor may use: their own or, for a group budget, that group's (#155). Ids kept
// from the budget's current lines stay valid, so another admin can still edit it.
async function assertLinesInScope(
  lines: { categoryId?: string; accountId?: string }[],
  scope: { userId: string | null; groupId: string | null },
  actorId: string,
  current: { categoryId: string | null; accountId: string | null }[] = [],
): Promise<void> {
  const keptCategories = new Set(current.map((l) => l.categoryId));
  const keptAccounts = new Set(current.map((l) => l.accountId));
  const categoryIds = [
    ...new Set(lines.flatMap((l) => (l.categoryId ? [l.categoryId] : []))),
  ].filter((id) => !keptCategories.has(id));
  for (const id of categoryIds) {
    try {
      await assertCategoryAssignable(id, actorId);
    } catch (e) {
      if (e instanceof CategoryAccessError) throw new BudgetAccessError("INVALID_LINE");
      throw e;
    }
    if (scope.groupId) {
      const cat = await db.category.findUnique({ where: { id }, select: { groupId: true } });
      if (cat?.groupId && cat.groupId !== scope.groupId)
        throw new BudgetAccessError("INVALID_LINE");
    }
  }
  const accountIds = lines.flatMap((l) =>
    l.accountId && !keptAccounts.has(l.accountId) ? [l.accountId] : [],
  );
  if (accountIds.length === 0) return;
  const allowed = new Set(await budgetAccountIds(scope));
  if (accountIds.some((id) => !allowed.has(id))) throw new BudgetAccessError("INVALID_LINE");
}

export async function createBudget(
  input: BudgetInput,
  actor: { id: string },
): Promise<{ id: string }> {
  const data = parseInput(input);
  await assertCanManageScope(data.groupId, actor.id);
  const { start, end } = utcBounds(data.periodType, data.periodStart, data.periodEnd);
  await assertLinesInScope(
    data.lines,
    { userId: data.groupId ? null : actor.id, groupId: data.groupId ?? null },
    actor.id,
  );

  const budget = await db.budget.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      userId: data.groupId ? null : actor.id,
      groupId: data.groupId ?? null,
      periodType: data.periodType,
      periodStart: start,
      periodEnd: end,
      recurring: data.recurring ?? false,
      createdById: actor.id,
      lines: {
        create: data.lines.map((l) => ({
          categoryId: l.categoryId ?? null,
          accountId: l.accountId ?? null,
          label: l.label ?? null,
          plannedAmount: l.plannedAmount,
        })),
      },
    },
  });
  await logEvent({
    userId: actor.id,
    action: "budget.created",
    entity: "Budget",
    entityId: budget.id,
  });
  return { id: budget.id };
}

// Loads a budget the actor may manage: own (userId) or a group where actor is ADMIN+.
async function manageableOrThrow(id: string, actorId: string) {
  const b = await db.budget.findUnique({ where: { id } });
  if (!b) throw new BudgetAccessError("NOT_FOUND");
  if (b.groupId) {
    try {
      await requireGroupRole(b.groupId, actorId, "ADMIN");
    } catch {
      throw new BudgetAccessError("FORBIDDEN");
    }
  } else if (b.userId !== actorId) {
    throw new BudgetAccessError("FORBIDDEN");
  }
  return b;
}

export async function updateBudget(
  id: string,
  input: BudgetInput,
  actor: { id: string },
): Promise<void> {
  const existing = await manageableOrThrow(id, actor.id);
  const data = parseInput(input);
  const { start, end } = utcBounds(data.periodType, data.periodStart, data.periodEnd);
  const current = await db.budgetLine.findMany({
    where: { budgetId: id },
    select: { categoryId: true, accountId: true },
  });
  await assertLinesInScope(data.lines, existing, actor.id, current);
  // Scope (user vs group) is immutable here — recreate to move it.
  await db.$transaction([
    db.budgetLine.deleteMany({ where: { budgetId: id } }),
    db.budget.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? null,
        periodType: data.periodType,
        periodStart: start,
        periodEnd: end,
        recurring: data.recurring ?? false,
        lines: {
          create: data.lines.map((l) => ({
            categoryId: l.categoryId ?? null,
            accountId: l.accountId ?? null,
            label: l.label ?? null,
            plannedAmount: l.plannedAmount,
          })),
        },
      },
    }),
  ]);
  await logEvent({ userId: actor.id, action: "budget.updated", entity: "Budget", entityId: id });
}

export async function deleteBudget(id: string, actor: { id: string }): Promise<void> {
  await manageableOrThrow(id, actor.id);
  // Deleting a series template promotes its oldest instance so the series stays linked.
  await db.$transaction(async (tx) => {
    const [heir, ...rest] = await tx.budget.findMany({
      where: { parentBudgetId: id },
      select: { id: true },
      orderBy: { periodStart: "asc" },
    });
    if (heir) {
      await tx.budget.updateMany({
        where: { id: { in: rest.map((r) => r.id) } },
        data: { parentBudgetId: heir.id },
      });
      await tx.budget.update({ where: { id: heir.id }, data: { parentBudgetId: null } });
    }
    await tx.budget.delete({ where: { id } });
  });
  await logEvent({ userId: actor.id, action: "budget.deleted", entity: "Budget", entityId: id });
}

// Archived budgets leave the list, the dashboard, the assignment menu and the roll cron.
export async function archiveBudget(id: string, actor: { id: string }): Promise<void> {
  await manageableOrThrow(id, actor.id);
  await db.budget.update({ where: { id }, data: { archived: true } });
  await logEvent({ userId: actor.id, action: "budget.archived", entity: "Budget", entityId: id });
}

export async function unarchiveBudget(id: string, actor: { id: string }): Promise<void> {
  await manageableOrThrow(id, actor.id);
  await db.budget.update({ where: { id }, data: { archived: false } });
  await logEvent({
    userId: actor.id,
    action: "budget.unarchived",
    entity: "Budget",
    entityId: id,
  });
}

export type BudgetListItem = {
  id: string;
  name: string;
  scope: BudgetScope;
  groupId: string | null;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  recurring: boolean;
  plannedTotal: number;
  spentTotal: number;
  percent: number | null;
  status: BudgetStatus;
  description: string | null;
  archived: boolean;
  parentBudgetId: string | null;
  lines: {
    categoryId: string | null;
    accountId: string | null;
    label: string | null;
    plannedAmount: number;
  }[];
  started: boolean; // period has begun
  ended: boolean; // period is over (eligible for a recurring roll)
  rollable: boolean; // recurring, ended, manageable and its next instance doesn't exist yet
  canManage: boolean; // actor may edit/delete/roll (own, or ADMIN+ of the group)
};

// True when the actor may manage a budget of this scope: a personal budget is
// managed by its owner; a group budget requires ADMIN or OWNER in that group.
function canManageBudget(groupId: string | null, roleByGroup: Map<string, string>): boolean {
  if (!groupId) return true;
  const role = roleByGroup.get(groupId);
  return role === "ADMIN" || role === "OWNER";
}

// The user's own budgets + those of groups they belong to, active or archived ones.
export async function listBudgetsForUser(
  userId: string,
  { archived = false }: { archived?: boolean } = {},
): Promise<BudgetListItem[]> {
  const { groupIds, roleByGroup } = await budgetScopeForUser(userId);
  const rows = await db.budget.findMany({
    where: { archived, OR: [{ userId }, { groupId: { in: groupIds } }] },
    include: {
      lines: { select: { plannedAmount: true, categoryId: true, accountId: true, label: true } },
    },
    orderBy: { periodStart: "desc" },
  });
  const now = Date.now();
  const ended = rows.filter(
    (b) =>
      b.recurring &&
      !b.archived &&
      b.periodEnd.getTime() < now &&
      canManageBudget(b.groupId, roleByGroup),
  );
  const [loaded, subtrees, rolled] = await Promise.all([
    loadBudgetRows(rows),
    withDescendants(lineCategoryIds(rows)),
    withNextInstance(ended),
  ]);
  const spends = await Promise.all(
    rows.map((b) => computeBudgetSpend(b, loaded.get(b.id)!, subtrees)),
  );
  const rollable = rows.map((b) => ended.includes(b) && !rolled.has(b.id));
  return rows.map((b, i) => {
    const plannedTotal = budgetPlannedTotal(
      b.lines.map((l) => ({ plannedAmount: Number(l.plannedAmount) })),
    );
    const { spent, percent, status } = lineStatus(plannedTotal, round2(-spends[i].totalSum));
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      archived: b.archived,
      scope: b.groupId ? "GROUP" : "USER",
      groupId: b.groupId,
      parentBudgetId: b.parentBudgetId,
      periodType: b.periodType,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      recurring: b.recurring,
      lines: b.lines.map((l) => ({
        categoryId: l.categoryId,
        accountId: l.accountId,
        label: l.label,
        plannedAmount: Number(l.plannedAmount),
      })),
      plannedTotal,
      spentTotal: spent,
      percent,
      status,
      started: b.periodStart.getTime() <= now,
      ended: b.periodEnd.getTime() < now,
      rollable: rollable[i],
      canManage: canManageBudget(b.groupId, roleByGroup),
    };
  });
}

type BudgetRow = {
  id: string;
  amount: number;
  date: Date;
  periodDate: Date;
  categoryId: string | null;
  accountId: string;
  linkId: string | null;
};

// A user may READ a budget they own or that belongs to a group they're in.
async function readableOrThrow(id: string, userId: string) {
  const b = await db.budget.findUnique({ where: { id }, include: { lines: true } });
  if (!b) throw new BudgetAccessError("NOT_FOUND");
  if (b.groupId) {
    try {
      await requireGroupRole(b.groupId, userId, "MEMBER");
    } catch {
      throw new BudgetAccessError("FORBIDDEN");
    }
  } else if (b.userId !== userId) {
    throw new BudgetAccessError("FORBIDDEN");
  }
  return b;
}

// The account set a budget draws from: a GROUP budget uses the accounts shared
// with the group (so every member computes the same total and personal accounts
// never leak in); a PERSONAL budget uses the owner's visible accounts.
async function budgetAccountIds(budget: {
  userId: string | null;
  groupId: string | null;
}): Promise<string[]> {
  if (budget.groupId) {
    const shares = await db.accountShare.findMany({
      where: { groupId: budget.groupId },
      select: { accountId: true },
    });
    return shares.map((s) => s.accountId);
  }
  if (!budget.userId) return [];
  return visibleAccountIds(budget.userId);
}

export type BudgetAccountOption = {
  id: string;
  name: string;
  groupIds: string[];
  archived: boolean;
};

// The user's accounts with the groups each is shared with: a personal budget may
// use any of them, a group budget only those shared with it. Archived ones are only
// offered back to the lines that already use them.
export async function listBudgetAccountOptions(userId: string): Promise<BudgetAccountOption[]> {
  const accounts = await listVisibleForUser(userId, { includeArchived: true });
  const { groupIds } = await budgetScopeForUser(userId);
  const shares = await db.accountShare.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) }, groupId: { in: groupIds } },
    select: { accountId: true, groupId: true },
  });
  const groupsOf = new Map<string, string[]>();
  for (const sh of shares)
    groupsOf.set(sh.accountId, [...(groupsOf.get(sh.accountId) ?? []), sh.groupId]);
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    groupIds: groupsOf.get(a.id) ?? [],
    archived: a.archived,
  }));
}

type BudgetRef = {
  id: string;
  userId: string | null;
  groupId: string | null;
  periodStart: Date;
  periodEnd: Date;
};

type LoadedBudgetRows = {
  rows: BudgetRow[];
  excluded: Set<string>;
  includedIds: Set<string>;
};

const scopeKey = (b: { userId: string | null; groupId: string | null }) =>
  b.groupId ? `g:${b.groupId}` : `u:${b.userId}`;

// The account ids of each budget scope, in one query for every group scope.
async function budgetScopeAccounts(budgets: BudgetRef[]): Promise<Map<string, Set<string>>> {
  const groupIds = [...new Set(budgets.flatMap((b) => (b.groupId ? [b.groupId] : [])))];
  const userIds = [...new Set(budgets.flatMap((b) => (!b.groupId && b.userId ? [b.userId] : [])))];
  const [shares, userAccounts] = await Promise.all([
    groupIds.length === 0
      ? []
      : db.accountShare.findMany({
          where: { groupId: { in: groupIds } },
          select: { groupId: true, accountId: true },
        }),
    Promise.all(userIds.map(visibleAccountIds)),
  ]);
  const scopes = new Map<string, Set<string>>(groupIds.map((g) => [`g:${g}`, new Set()]));
  for (const s of shares) scopes.get(`g:${s.groupId}`)!.add(s.accountId);
  userIds.forEach((u, i) => scopes.set(`u:${u}`, new Set(userAccounts[i])));
  return scopes;
}

// Loads every budget's candidate rows in a constant number of queries (#299): transactions on
// the budget's account scope within its period, PLUS any transaction explicitly assigned to
// it regardless of account or period, so an INCLUDE can pull in an out-of-period or
// personal-into-shared transaction, and an EXCLUDE always resolves.
async function loadBudgetRows(budgets: BudgetRef[]): Promise<Map<string, LoadedBudgetRows>> {
  if (budgets.length === 0) return new Map();
  const [assignments, scopes] = await Promise.all([
    db.budgetAssignment.findMany({
      where: { budgetId: { in: budgets.map((b) => b.id) } },
      select: { budgetId: true, transactionId: true, mode: true },
    }),
    budgetScopeAccounts(budgets),
  ]);

  const periodsByScope = new Map<string, { gte: Date; lte: Date }[]>();
  for (const b of budgets) {
    const periods = periodsByScope.get(scopeKey(b)) ?? [];
    periods.push({ gte: b.periodStart, lte: b.periodEnd });
    periodsByScope.set(scopeKey(b), periods);
  }
  const orClauses: Prisma.TransactionWhereInput[] = [];
  for (const [key, periods] of periodsByScope) {
    const accountIds = [...scopes.get(key)!];
    if (accountIds.length === 0) continue;
    orClauses.push({
      accountId: { in: accountIds },
      OR: periods.map((periodDate) => ({ periodDate })),
    });
  }
  const assignedIds = [...new Set(assignments.map((a) => a.transactionId))];
  if (assignedIds.length > 0) orClauses.push({ id: { in: assignedIds } });

  let rows: BudgetRow[] = [];
  if (orClauses.length > 0) {
    const where = { OR: orClauses };
    const [txs, linkIds] = await Promise.all([
      db.transaction.findMany({
        where,
        select: {
          id: true,
          amount: true,
          date: true,
          periodDate: true,
          categoryId: true,
          accountId: true,
        },
      }),
      linkIdsWhere(where),
    ]);
    rows = txs.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      date: r.date,
      periodDate: r.periodDate,
      categoryId: r.categoryId,
      accountId: r.accountId,
      linkId: linkIds.get(r.id) ?? null,
    }));
  }

  const loaded = new Map<string, LoadedBudgetRows>(
    budgets.map((b) => [b.id, { rows: [], excluded: new Set(), includedIds: new Set() }]),
  );
  for (const a of assignments) {
    const l = loaded.get(a.budgetId)!;
    (a.mode === "EXCLUDE" ? l.excluded : l.includedIds).add(a.transactionId);
  }
  for (const b of budgets) {
    const l = loaded.get(b.id)!;
    const accounts = scopes.get(scopeKey(b))!;
    const from = b.periodStart.getTime();
    const to = b.periodEnd.getTime();
    l.rows = rows.filter(
      (r) =>
        (accounts.has(r.accountId) &&
          r.periodDate.getTime() >= from &&
          r.periodDate.getTime() <= to) ||
        l.includedIds.has(r.id) ||
        l.excluded.has(r.id),
    );
  }
  return loaded;
}

type LineFilter = { categoryId: string | null; accountId: string | null };

function lineCategoryIds(budgets: { lines: LineFilter[] }[]): string[] {
  return budgets.flatMap((b) => b.lines.flatMap((l) => (l.categoryId ? [l.categoryId] : [])));
}
type LineMatcher = {
  categoryId: string | null;
  categoryIds: Set<string> | null;
  accountId: string | null;
};

// A line auto-matches a row by its category (itself or any descendant) and/or
// account. Without a category it only takes expenses, so income never counts as
// negative spending. A line with neither filter is the catch-all (see below).
function matchesLine(r: BudgetRow, line: LineMatcher): boolean {
  if (line.categoryIds == null && line.accountId == null) return false;
  if (line.categoryIds == null && r.amount >= 0) return false;
  if (line.categoryIds != null && (r.categoryId == null || !line.categoryIds.has(r.categoryId)))
    return false;
  if (line.accountId != null && r.accountId !== line.accountId) return false;
  return true;
}

// Lines a row counts toward: the most specific matching category lines win
// (#154); a row no line matches falls to the catch-all lines if it's an expense.
function matchingLines(r: BudgetRow, filters: LineMatcher[]): number[] {
  const matched = filters.flatMap((f, i) => (matchesLine(r, f) ? [i] : []));
  if (matched.length === 0) {
    if (r.amount >= 0) return [];
    return filters.flatMap((f, i) => (f.categoryIds == null && f.accountId == null ? [i] : []));
  }
  return matched.filter((i) => {
    const outer = filters[i];
    return !matched.some((j) => {
      const inner = filters[j].categoryId;
      return inner != null && inner !== outer.categoryId && !!outer.categoryIds?.has(inner);
    });
  });
}

export type BudgetDetail = {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  scope: BudgetScope;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  recurring: boolean;
  lines: (LineStatus & {
    id: string;
    categoryId: string | null;
    accountId: string | null;
    label: string | null;
  })[];
  plannedTotal: number;
  spentTotal: number;
  outOfBudget: { spent: number; count: number } | null; // INCLUDEs no line matches (#345)
  groupId: string | null;
  canManage: boolean;
  previousId: string | null; // neighbouring periods of the same recurring series
  nextId: string | null;
  transactions: BudgetTransaction[]; // newest first, capped at BUDGET_TRANSACTIONS_SHOWN
  transactionCount: number;
};

const BUDGET_TRANSACTIONS_SHOWN = 100;

export type BudgetTransaction = {
  id: string;
  date: Date;
  periodDate: Date;
  amount: number;
  label: string | null;
  categoryId: string | null;
  accountName: string | null;
};

// Per-line sums for display + a budget-wide dedup sum for the total: a tx that
// matches several lines is counted once in the total; an INCLUDE'd tx that
// matches no line counts in the total and in the out-of-budget sum, never in a line.
async function computeBudgetSpend(
  b: { lines: LineFilter[] },
  { rows, excluded, includedIds }: LoadedBudgetRows,
  subtrees?: Map<string, Set<string>>,
): Promise<{
  lineSums: number[];
  outOfBudget: BudgetRow[];
  totalSum: number;
  counted: BudgetRow[];
}> {
  // Collapse links across the WHOLE loaded scope first, so a linked group split
  // across categories nets correctly (the offsetting member is not dropped by a
  // per-line filter). Each surviving row carries its primary's category/account.
  const collapsed = collapseLinkedRows(rows);
  const lineSubtrees = subtrees ?? (await withDescendants(lineCategoryIds([b])));
  const filters: LineMatcher[] = b.lines.map((l) => ({
    categoryId: l.categoryId,
    categoryIds: l.categoryId ? lineSubtrees.get(l.categoryId)! : null,
    accountId: l.accountId,
  }));

  const lineSums = new Array<number>(b.lines.length).fill(0);
  const outOfBudget: BudgetRow[] = [];
  let totalSum = 0;
  const counted: BudgetRow[] = [];
  for (const r of collapsed) {
    if (excluded.has(r.id)) continue;
    const matchedIdx = matchingLines(r, filters);
    if (matchedIdx.length === 0 && !includedIds.has(r.id)) continue; // not in this budget
    counted.push(r);
    totalSum += r.amount; // counted once toward the total
    if (matchedIdx.length === 0) outOfBudget.push(r);
    for (const i of matchedIdx) lineSums[i] += r.amount;
  }
  return { lineSums, outOfBudget, totalSum, counted };
}

async function seriesNeighbours(b: {
  id: string;
  parentBudgetId: string | null;
}): Promise<{ previousId: string | null; nextId: string | null }> {
  const template = b.parentBudgetId ?? b.id;
  const series = await db.budget.findMany({
    where: { archived: false, OR: [{ id: template }, { parentBudgetId: template }] },
    select: { id: true },
    orderBy: { periodStart: "asc" },
  });
  const i = series.findIndex((x) => x.id === b.id);
  if (i < 0) return { previousId: null, nextId: null };
  return { previousId: series[i - 1]?.id ?? null, nextId: series[i + 1]?.id ?? null };
}

async function readableAccountNames(userId: string): Promise<Map<string, string>> {
  return new Map((await visibleAccountRefs(userId)).map((a) => [a.id, a.name]));
}

// Names of the accounts whose counted transactions the viewer sees in full; the
// write-time INCLUDE guard is re-checked here so stale assignments stop exposing
// rows (spec §2.2). Group budget: account shared with the group or owner still a member.
async function displayableAccountNames(
  accountIds: string[],
  viewerId: string,
  groupId: string | null,
): Promise<Map<string, string>> {
  if (!groupId) return readableAccountNames(viewerId);
  const accounts = await db.bankAccount.findMany({
    where: {
      id: { in: accountIds },
      OR: [
        { shares: { some: { groupId } } },
        { owner: { groupMemberships: { some: { groupId } } } },
      ],
    },
    select: { id: true, name: true },
  });
  return new Map(accounts.map((a) => [a.id, a.name]));
}

async function budgetTransactions(
  counted: BudgetRow[],
  viewerId: string,
  groupId: string | null,
): Promise<BudgetTransaction[]> {
  const shown = [...counted]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, BUDGET_TRANSACTIONS_SHOWN);
  const visible = await displayableAccountNames(
    [...new Set(shown.map((r) => r.accountId))],
    viewerId,
    groupId,
  );
  const rows = await db.transaction.findMany({
    where: { id: { in: shown.filter((r) => visible.has(r.accountId)).map((r) => r.id) } },
    select: { id: true, labelEnc: true },
  });
  const labels = new Map(rows.map((r) => [r.id, decrypt(r.labelEnc, dataKey)]));
  return shown.map((r, i) =>
    visible.has(r.accountId)
      ? {
          id: r.id,
          date: r.date,
          periodDate: r.periodDate,
          amount: r.amount,
          label: labels.get(r.id) ?? "",
          categoryId: r.categoryId,
          accountName: visible.get(r.accountId)!,
        }
      : {
          id: `hidden-${i}`,
          date: r.date,
          periodDate: r.periodDate,
          amount: r.amount,
          label: null,
          categoryId: null,
          accountName: null,
        },
  );
}

export async function getBudgetDetail(
  id: string,
  viewerId: string,
  { withTransactions = true }: { withTransactions?: boolean } = {},
): Promise<BudgetDetail> {
  const b = await readableOrThrow(id, viewerId);
  const { lineSums, outOfBudget, totalSum, counted } = await computeBudgetSpend(
    b,
    (await loadBudgetRows([b])).get(b.id)!,
  );
  const { roleByGroup } = await budgetScopeForUser(viewerId);

  const lines = b.lines.map((l, i) => ({
    id: l.id,
    categoryId: l.categoryId,
    accountId: l.accountId,
    label: l.label,
    ...lineStatus(Number(l.plannedAmount), round2(-lineSums[i])),
  }));
  const plannedTotal = budgetPlannedTotal(
    b.lines.map((l) => ({ plannedAmount: Number(l.plannedAmount) })),
  );
  const spentTotal = round2(-totalSum);
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    archived: b.archived,
    scope: b.groupId ? "GROUP" : "USER",
    groupId: b.groupId,
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    recurring: b.recurring,
    lines,
    plannedTotal,
    spentTotal,
    outOfBudget:
      outOfBudget.length === 0
        ? null
        : {
            spent: round2(-outOfBudget.reduce((sum, r) => sum + r.amount, 0)),
            count: outOfBudget.length,
          },
    canManage: canManageBudget(b.groupId, roleByGroup),
    ...(await seriesNeighbours(b)),
    transactions: withTransactions ? await budgetTransactions(counted, viewerId, b.groupId) : [],
    transactionCount: counted.length,
  };
}

// The budget shown on the dashboard: one whose period contains `now`, personal
// budgets first, then the latest started. `others` counts the remaining ones.
export async function getCurrentBudget(
  userId: string,
  now: Date = new Date(),
): Promise<{
  detail: BudgetDetail;
  others: number;
  accountNames: Record<string, string>;
} | null> {
  const { groupIds } = await budgetScopeForUser(userId);
  const current = await db.budget.findMany({
    where: {
      archived: false,
      periodStart: { lte: now },
      periodEnd: { gte: now },
      OR: [{ userId }, { groupId: { in: groupIds } }],
    },
    select: { id: true, groupId: true },
    orderBy: { periodStart: "desc" },
  });
  if (current.length === 0) return null;
  const first = current.find((b) => !b.groupId) ?? current[0];
  const detail = await getBudgetDetail(first.id, userId, { withTransactions: false });
  const names = await readableAccountNames(userId);
  const accountNames = Object.fromEntries(
    detail.lines.flatMap((l) =>
      l.accountId && names.has(l.accountId) ? [[l.accountId, names.get(l.accountId)!]] : [],
    ),
  );
  return { detail, others: current.length - 1, accountNames };
}

export async function assignTransaction(
  input: { budgetId: string; transactionId: string; mode: "INCLUDE" | "EXCLUDE" },
  actor: { id: string },
): Promise<void> {
  if (input.mode !== "INCLUDE" && input.mode !== "EXCLUDE") throw new BudgetAccessError("INVALID");
  const budget = await readableOrThrow(input.budgetId, actor.id);
  if (budget.archived) throw new BudgetAccessError("ARCHIVED");
  const txRow = await db.transaction.findUnique({
    where: { id: input.transactionId },
    select: { accountId: true },
  });
  if (!txRow) throw new BudgetAccessError("NOT_FOUND");
  if (!(await canReadAccount(actor.id, txRow.accountId))) throw new BudgetAccessError("FORBIDDEN");
  // An INCLUDE shows the transaction to every group member (spec §2.2), so reading the
  // account through another group isn't enough.
  if (input.mode === "INCLUDE" && budget.groupId) {
    const includable = await db.bankAccount.count({
      where: {
        id: txRow.accountId,
        OR: [{ ownerId: actor.id }, { shares: { some: { groupId: budget.groupId } } }],
      },
    });
    if (includable === 0) throw new BudgetAccessError("FORBIDDEN");
  }

  await db.budgetAssignment.upsert({
    where: {
      budgetId_transactionId: {
        budgetId: input.budgetId,
        transactionId: input.transactionId,
      },
    },
    update: { mode: input.mode, assignedById: actor.id },
    create: {
      budgetId: input.budgetId,
      transactionId: input.transactionId,
      mode: input.mode,
      assignedById: actor.id,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "budget.assignment.create",
    entity: "BudgetAssignment",
    entityId: `${input.budgetId}:${input.transactionId}`,
    metadata: { mode: input.mode },
  });
}

export async function unassignTransaction(
  input: { budgetId: string; transactionId: string },
  actor: { id: string },
): Promise<void> {
  await readableOrThrow(input.budgetId, actor.id);
  await db.budgetAssignment
    .delete({
      where: {
        budgetId_transactionId: { budgetId: input.budgetId, transactionId: input.transactionId },
      },
    })
    .catch(() => undefined);
  await logEvent({
    userId: actor.id,
    action: "budget.assignment.delete",
    entity: "BudgetAssignment",
    entityId: `${input.budgetId}:${input.transactionId}`,
  });
}

// Budgets the actor may assign a transaction to: their own + their groups'.
export type AssignableBudget = {
  id: string;
  name: string;
  scope: BudgetScope;
  groupId: string | null;
  groupName: string | null;
  periodStart: Date;
  periodEnd: Date;
  archived: boolean;
};

const assignableSelect = {
  id: true,
  name: true,
  groupId: true,
  group: { select: { name: true } },
  periodStart: true,
  periodEnd: true,
  archived: true,
} as const;

function toAssignable(b: {
  id: string;
  name: string;
  groupId: string | null;
  group: { name: string } | null;
  periodStart: Date;
  periodEnd: Date;
  archived: boolean;
}): AssignableBudget {
  return {
    id: b.id,
    name: b.name,
    scope: b.groupId ? "GROUP" : "USER",
    groupId: b.groupId,
    groupName: b.group?.name ?? null,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    archived: b.archived,
  };
}

export async function listAssignableBudgets(userId: string): Promise<AssignableBudget[]> {
  const { groupIds } = await budgetScopeForUser(userId);
  const rows = await db.budget.findMany({
    where: { archived: false, OR: [{ userId }, { groupId: { in: groupIds } }] },
    select: assignableSelect,
    orderBy: [{ periodStart: "desc" }, { name: "asc" }],
  });
  return rows.map(toAssignable);
}

export type TxAssignment = { budgetId: string; mode: string; budget: AssignableBudget };

// The assignments on a transaction for the detail panel, on budgets the viewer can
// read, archived ones included so they stay removable.
export async function listAssignmentsForTx(
  transactionId: string,
  viewerId: string,
): Promise<TxAssignment[]> {
  const { groupIds } = await budgetScopeForUser(viewerId);
  const rows = await db.budgetAssignment.findMany({
    where: {
      transactionId,
      budget: { OR: [{ userId: viewerId }, { groupId: { in: groupIds } }] },
    },
    select: { budgetId: true, mode: true, budget: { select: assignableSelect } },
    orderBy: { assignedAt: "asc" },
  });
  return rows.map((r) => ({ budgetId: r.budgetId, mode: r.mode, budget: toAssignable(r.budget) }));
}

type SeriesRef = {
  id: string;
  parentBudgetId: string | null;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
};

async function nextInstanceExists(b: SeriesRef): Promise<boolean> {
  // Any later period of the series counts, so a deleted middle period isn't recreated.
  const period = nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd);
  const template = b.parentBudgetId ?? b.id;
  const existing = await db.budget.findFirst({
    where: {
      OR: [{ id: template }, { parentBudgetId: template }],
      periodStart: { gte: period.start },
    },
    select: { id: true },
  });
  return existing != null;
}

// The budgets of `budgets` whose series already has a later period, in one query.
async function withNextInstance(budgets: SeriesRef[]): Promise<Set<string>> {
  if (budgets.length === 0) return new Set();
  const templates = [...new Set(budgets.map((b) => b.parentBudgetId ?? b.id))];
  const series = await db.budget.findMany({
    where: { OR: [{ id: { in: templates } }, { parentBudgetId: { in: templates } }] },
    select: { id: true, parentBudgetId: true, periodStart: true },
  });
  const starts = new Map<string, number[]>();
  for (const s of series) {
    for (const key of [s.id, s.parentBudgetId]) {
      if (key) starts.set(key, [...(starts.get(key) ?? []), s.periodStart.getTime()]);
    }
  }
  return new Set(
    budgets
      .filter((b) => {
        const next = nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd);
        const later = starts.get(b.parentBudgetId ?? b.id) ?? [];
        return later.some((t) => t >= next.start.getTime());
      })
      .map((b) => b.id),
  );
}

// Core roll: create the next-period instance of a recurring budget if it doesn't
// already exist (idempotent). `createdById` owns the new row; `auditUserId` is the
// acting user (null for the system cron → anonymous audit).
async function rollFrom(
  b: Budget,
  createdById: string,
  auditUserId: string | null,
): Promise<{ created: boolean; id?: string }> {
  if (!b.recurring) throw new BudgetAccessError("NOT_RECURRING");
  if (b.archived) return { created: false };
  const template = b.parentBudgetId ?? b.id; // chain instances off the original template
  const period = nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd);
  if (await nextInstanceExists(b)) return { created: false };

  const lines = await db.budgetLine.findMany({ where: { budgetId: b.id } });
  const instance = await db.budget.create({
    data: {
      name: b.name,
      description: b.description,
      userId: b.userId,
      groupId: b.groupId,
      periodType: b.periodType,
      periodStart: period.start,
      periodEnd: period.end,
      recurring: true,
      parentBudgetId: template,
      createdById,
      lines: {
        create: lines.map((l) => ({
          categoryId: l.categoryId,
          accountId: l.accountId,
          label: l.label,
          plannedAmount: l.plannedAmount,
        })),
      },
    },
  });
  await logEvent({
    userId: auditUserId,
    action: "budget.created",
    entity: "Budget",
    entityId: instance.id,
    metadata: { rolledFrom: b.id, system: auditUserId === null },
  });
  return { created: true, id: instance.id };
}

export async function rollRecurring(
  id: string,
  actor: { id: string },
): Promise<{ created: boolean; id?: string }> {
  const b = await manageableOrThrow(id, actor.id);
  return rollFrom(b, actor.id, actor.id);
}

// Recurring budgets whose period has ended and whose series has no later period yet.
async function dueBudgets(now: Date) {
  const ended = await db.budget.findMany({
    where: { recurring: true, archived: false, periodEnd: { lt: now } },
    include: { lines: true },
  });
  const rolled = await withNextInstance(ended);
  return ended.filter((b) => !rolled.has(b.id));
}

export async function listRollableTemplates(now: Date): Promise<{ id: string }[]> {
  return (await dueBudgets(now)).map((b) => ({ id: b.id }));
}

// The roll cron in a constant number of queries (#304): each due budget's next instance, its
// lines and its anonymous audit row go in three bulk inserts. The new instance inherits the
// template's creator.
export async function rollRecurringBudgets(
  now: Date,
): Promise<{ checked: number; rolled: number }> {
  const due = await dueBudgets(now);
  if (due.length === 0) return { checked: 0, rolled: 0 };
  const instances = due.map((b) => ({
    b,
    id: randomUUID(),
    period: nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd),
  }));
  await db.$transaction([
    db.budget.createMany({
      data: instances.map(({ b, id, period }) => ({
        id,
        name: b.name,
        description: b.description,
        userId: b.userId,
        groupId: b.groupId,
        periodType: b.periodType,
        periodStart: period.start,
        periodEnd: period.end,
        recurring: true,
        parentBudgetId: b.parentBudgetId ?? b.id,
        createdById: b.createdById,
      })),
    }),
    db.budgetLine.createMany({
      data: instances.flatMap(({ b, id }) =>
        b.lines.map((l) => ({
          budgetId: id,
          categoryId: l.categoryId,
          accountId: l.accountId,
          label: l.label,
          plannedAmount: l.plannedAmount,
        })),
      ),
    }),
    db.auditLog.createMany({
      data: instances.map(({ b, id }) => ({
        userId: null,
        action: "budget.created",
        entity: "Budget",
        entityId: id,
        metadata: { rolledFrom: b.id, system: true },
      })),
    }),
  ]);
  return { checked: due.length, rolled: due.length };
}

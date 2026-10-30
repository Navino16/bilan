import { randomUUID } from "node:crypto";
import type { Budget, BudgetLine, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { requireGroupRole } from "@/server/services/groups/roles";
import { groupMemberships } from "@/server/services/groups/memberships";
import { logEvent } from "@/server/services/audit";
import {
  accountBalances,
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
  type BudgetLanding,
  type BudgetStatus,
  type LineStatus,
} from "@/lib/budgets";
import {
  type BudgetLineKind,
  type BudgetPeriodType,
  type TransferDirection,
} from "@/lib/validation/budget";
import { budgetInputSchema, type BudgetInput } from "@/lib/schemas/budget";
import {
  attachedLanding,
  budgetMirrors,
  computeAttachedSpend,
  loadTransferContext,
  summarizeAttached,
  type AttachedSpend,
  type BudgetLineSpec,
  type BudgetRow,
  type LoadedBudgetRows,
} from "./attached";

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
  lines: { categoryId?: string; accountId?: string; counterpartAccountId?: string }[],
  scope: { userId: string | null; groupId: string | null },
  actorId: string,
  current: {
    categoryId: string | null;
    accountId: string | null;
    counterpartAccountId: string | null;
  }[] = [],
): Promise<void> {
  const keptCategories = new Set(current.map((l) => l.categoryId));
  const keptAccounts = new Set(current.flatMap((l) => [l.accountId, l.counterpartAccountId]));
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
    [l.accountId, l.counterpartAccountId].filter(
      (id): id is string => !!id && !keptAccounts.has(id),
    ),
  );
  if (accountIds.length === 0) return;
  const allowed = new Set(await budgetAccountIds(scope));
  if (accountIds.some((id) => !allowed.has(id))) throw new BudgetAccessError("INVALID_LINE");
}

// The account of an attached budget must be one its scope draws from; an edit may keep
// the current one (e.g. since archived), as lines do.
// A personal budget may only follow an account its owner holds (design §B).
async function assertBudgetAccount(
  accountId: string,
  scope: { userId: string | null; groupId: string | null },
  kept: string | null = null,
): Promise<void> {
  if (accountId === kept) return;
  const allowed = scope.groupId
    ? (await budgetAccountIds(scope)).includes(accountId)
    : (await db.bankAccount.count({ where: { id: accountId, ownerId: scope.userId! } })) > 0;
  if (!allowed) throw new BudgetAccessError("INVALID_ACCOUNT");
}

// Attached budgets that still hold their account: a household budget whose account was
// unshared counts nothing and must not block the account (one query).
async function stillAttached<T extends { accountId: string | null; groupId: string | null }>(
  budgets: T[],
): Promise<T[]> {
  const grouped = budgets.filter((b) => b.groupId && b.accountId);
  const shares =
    grouped.length === 0
      ? []
      : await db.accountShare.findMany({
          where: { OR: grouped.map((b) => ({ accountId: b.accountId!, groupId: b.groupId! })) },
          select: { accountId: true, groupId: true },
        });
  const shared = new Set(shares.map((sh) => `${sh.accountId}|${sh.groupId}`));
  return budgets.filter((b) => !b.groupId || shared.has(`${b.accountId}|${b.groupId}`));
}

// At most one non-archived attached budget per account covers a given day (design §B).
async function attachedOverlap(
  accountId: string,
  start: Date,
  end: Date,
  excludeId?: string,
): Promise<boolean> {
  const others = await db.budget.findMany({
    where: {
      accountId,
      archived: false,
      periodStart: { lte: end },
      periodEnd: { gte: start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { accountId: true, groupId: true },
  });
  return (await stillAttached(others)).length > 0;
}

type ParsedBudget = ReturnType<typeof parseInput>;

// Lines of an attached budget filter on its account implicitly; only transfers keep a
// direction and a counterpart.
function lineData(l: ParsedBudget["lines"][number], attached: boolean) {
  const transfer = l.kind === "TRANSFER";
  return {
    kind: l.kind,
    categoryId: transfer ? null : (l.categoryId ?? null),
    accountId: attached ? null : (l.accountId ?? null),
    direction: transfer ? (l.direction ?? null) : null,
    counterpartAccountId: transfer ? (l.counterpartAccountId ?? null) : null,
    label: l.label ?? null,
    plannedAmount: l.plannedAmount,
  };
}

async function assertAttachable(
  data: ParsedBudget,
  scope: { userId: string | null; groupId: string | null },
  period: { start: Date; end: Date },
  current?: { id: string; accountId: string | null },
): Promise<void> {
  if (!data.accountId) return;
  await assertBudgetAccount(data.accountId, scope, current?.accountId);
  if (await attachedOverlap(data.accountId, period.start, period.end, current?.id))
    throw new BudgetAccessError("ACCOUNT_OVERLAP");
}

export async function createBudget(
  input: BudgetInput,
  actor: { id: string },
): Promise<{ id: string }> {
  const data = parseInput(input);
  await assertCanManageScope(data.groupId, actor.id);
  const { start, end } = utcBounds(data.periodType, data.periodStart, data.periodEnd);
  const scope = { userId: data.groupId ? null : actor.id, groupId: data.groupId ?? null };
  await assertLinesInScope(data.lines, scope, actor.id);
  await assertAttachable(data, scope, { start, end });

  const budget = await db.budget.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      userId: data.groupId ? null : actor.id,
      groupId: data.groupId ?? null,
      accountId: data.accountId ?? null,
      outOfBudgetPlanned: data.outOfBudgetPlanned ?? null,
      periodType: data.periodType,
      periodStart: start,
      periodEnd: end,
      recurring: data.recurring ?? false,
      createdById: actor.id,
      lines: { create: data.lines.map((l) => lineData(l, !!data.accountId)) },
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
    select: { categoryId: true, accountId: true, counterpartAccountId: true },
  });
  await assertLinesInScope(data.lines, existing, actor.id, current);
  await assertAttachable(data, existing, { start, end }, existing);
  // Scope (user vs group) is immutable here — recreate to move it.
  await db.$transaction([
    db.budgetLine.deleteMany({ where: { budgetId: id } }),
    db.budget.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? null,
        accountId: data.accountId ?? null,
        outOfBudgetPlanned: data.outOfBudgetPlanned ?? null,
        periodType: data.periodType,
        periodStart: start,
        periodEnd: end,
        recurring: data.recurring ?? false,
        lines: { create: data.lines.map((l) => lineData(l, !!data.accountId)) },
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
  const b = await manageableOrThrow(id, actor.id);
  if (b.accountId && (await attachedOverlap(b.accountId, b.periodStart, b.periodEnd, b.id)))
    throw new BudgetAccessError("ACCOUNT_OVERLAP");
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
  accountId: string | null;
  outOfBudgetPlanned: number | null;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  recurring: boolean;
  plannedTotal: number;
  spentTotal: number;
  percent: number | null;
  status: BudgetStatus;
  incomePlanned: number;
  incomeReceived: number;
  unplannedIncome: UnplannedIncome | null;
  landing: BudgetLanding | null; // attached budget in progress (design §E)
  description: string | null;
  archived: boolean;
  parentBudgetId: string | null;
  lines: {
    kind: BudgetLineKind;
    categoryId: string | null;
    accountId: string | null;
    direction: TransferDirection | null;
    counterpartAccountId: string | null;
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
  { archived = false, now: at = new Date() }: { archived?: boolean; now?: Date } = {},
): Promise<BudgetListItem[]> {
  const { groupIds, roleByGroup } = await budgetScopeForUser(userId);
  const rows = await db.budget.findMany({
    where: { archived, OR: [{ userId }, { groupId: { in: groupIds } }] },
    include: {
      lines: true,
    },
    orderBy: { periodStart: "desc" },
  });
  const now = at.getTime();
  const ended = rows.filter(
    (b) =>
      b.recurring &&
      !b.archived &&
      b.periodEnd.getTime() < now &&
      canManageBudget(b.groupId, roleByGroup),
  );
  const [evaluations, rolled, free] = await Promise.all([
    evaluateBudgets(rows, { userId, groupIds }, at),
    withNextInstance(ended),
    withoutAttachedOverlap(
      ended.map((b) => ({
        b,
        period: nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd),
      })),
    ),
  ]);
  const renewable = new Set(free.map((f) => f.b.id));
  const rollable = rows.map((b) => ended.includes(b) && !rolled.has(b.id) && renewable.has(b.id));
  return rows.map((b, i) => {
    const e = evaluations[i];
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      archived: b.archived,
      scope: b.groupId ? "GROUP" : "USER",
      groupId: b.groupId,
      accountId: b.accountId,
      outOfBudgetPlanned: b.outOfBudgetPlanned == null ? null : Number(b.outOfBudgetPlanned),
      parentBudgetId: b.parentBudgetId,
      periodType: b.periodType,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      recurring: b.recurring,
      lines: b.lines.map((l) => ({
        kind: l.kind as BudgetLineKind,
        categoryId: l.categoryId,
        accountId: l.accountId,
        direction: l.direction as TransferDirection | null,
        counterpartAccountId: l.counterpartAccountId,
        label: l.label,
        plannedAmount: Number(l.plannedAmount),
      })),
      plannedTotal: e.plannedTotal,
      spentTotal: e.spentTotal,
      percent: e.percent,
      status: e.status,
      incomePlanned: e.incomePlanned,
      incomeReceived: e.incomeReceived,
      unplannedIncome: e.unplannedIncome,
      landing: e.landing,
      started: b.periodStart.getTime() <= now,
      ended: b.periodEnd.getTime() < now,
      rollable: rollable[i],
      canManage: canManageBudget(b.groupId, roleByGroup),
    };
  });
}

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
  accountId: string | null;
  periodStart: Date;
  periodEnd: Date;
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
    budgets.map((b) => [
      b.id,
      {
        rows: [],
        excluded: new Set(),
        includedIds: new Set(),
        scope: scopes.get(scopeKey(b)) ?? new Set(),
      },
    ]),
  );
  for (const a of assignments) {
    const l = loaded.get(a.budgetId)!;
    (a.mode === "EXCLUDE" ? l.excluded : l.includedIds).add(a.transactionId);
  }
  for (const b of budgets) {
    const l = loaded.get(b.id)!;
    const accounts = budgetRowAccounts(b, scopes.get(scopeKey(b))!);
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

// An attached budget draws from its account only, and only while its scope still holds it
// (design §B): loading the scope would net a linked transfer's two legs to zero.
function budgetRowAccounts(b: { accountId: string | null }, scope: Set<string>): Set<string> {
  if (!b.accountId) return scope;
  return scope.has(b.accountId) ? new Set([b.accountId]) : new Set();
}

type LineFilter = { kind: string; categoryId: string | null; accountId: string | null };

function lineCategoryIds(budgets: { lines: LineFilter[] }[]): string[] {
  return budgets.flatMap((b) => b.lines.flatMap((l) => (l.categoryId ? [l.categoryId] : [])));
}
type LineMatcher = {
  kind: string;
  categoryId: string | null;
  categoryIds: Set<string> | null;
  accountId: string | null;
};

// A line auto-matches a row by its category (itself or any descendant) and/or
// account. Without a category it only takes expenses, so income never counts as
// negative spending. A line with neither filter is the catch-all (see below).
function matchesLine(r: BudgetRow, line: LineMatcher): boolean {
  if (line.kind !== "EXPENSE") return false;
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
    return filters.flatMap((f, i) =>
      f.kind === "EXPENSE" && f.categoryIds == null && f.accountId == null ? [i] : [],
    );
  }
  return matched.filter((i) => {
    const outer = filters[i];
    return !matched.some((j) => {
      const inner = filters[j].categoryId;
      return inner != null && inner !== outer.categoryId && !!outer.categoryIds?.has(inner);
    });
  });
}

export type BudgetDetailLine = LineStatus & {
  id: string;
  kind: BudgetLineKind;
  categoryId: string | null;
  accountId: string | null;
  direction: TransferDirection | null;
  counterpartAccountId: string | null;
  label: string | null;
  counterpartSavings: boolean;
  mirrorOf: { budgetId: string; budgetName: string } | null; // read-only, design §C
};

export type OutOfBudget = {
  spent: number;
  count: number;
  planned: number | null;
  unmatchedTransfers: number;
};
export type UnplannedIncome = { received: number; count: number; fromSavings: number };

type BudgetWithLines = Budget & { lines: BudgetLine[] };

type BudgetEvaluation = {
  lines: BudgetDetailLine[];
  plannedTotal: number;
  spentTotal: number;
  percent: number | null;
  status: BudgetStatus;
  incomePlanned: number;
  incomeReceived: number;
  outOfBudget: OutOfBudget | null;
  unplannedIncome: UnplannedIncome | null;
  landing: BudgetLanding | null;
  counted: BudgetRow[];
  shown: { out: BudgetRow[]; unplanned: BudgetRow[] };
  attached: { specs: BudgetLineSpec[]; spend: AttachedSpend } | null;
};

function lineSpecs(b: BudgetWithLines, mirrors: Map<string, BudgetLineSpec[]>): BudgetLineSpec[] {
  return [
    ...b.lines.map((l) => ({
      id: l.id,
      kind: l.kind as BudgetLineKind,
      categoryId: l.categoryId,
      accountId: l.accountId,
      direction: l.direction as TransferDirection | null,
      counterpartAccountId: l.counterpartAccountId,
      label: l.label,
      plannedAmount: Number(l.plannedAmount),
      mirrorOf: null,
    })),
    ...(b.accountId ? (mirrors.get(b.id) ?? []) : []),
  ];
}

// Spend of every budget as `viewer` sees it, in a constant number of queries (#299).
async function evaluateBudgets(
  budgets: BudgetWithLines[],
  viewer: { userId: string; groupIds: string[] },
  now: Date = new Date(),
): Promise<BudgetEvaluation[]> {
  const [loaded, subtrees, mirrors] = await Promise.all([
    loadBudgetRows(budgets),
    withDescendants(lineCategoryIds(budgets)),
    budgetMirrors(budgets, viewer),
  ]);
  const landing = budgets.filter(
    (b) =>
      b.accountId &&
      !b.archived &&
      loaded.get(b.id)!.scope.has(b.accountId) &&
      b.periodStart <= now &&
      now <= b.periodEnd,
  );
  const [ctx, balances] = await Promise.all([
    loadTransferContext(
      budgets.map((b) => ({ ...b, lines: lineSpecs(b, mirrors) })),
      loaded,
      mirrors,
      viewer.userId,
    ),
    balancesAsOf([...new Set(landing.map((b) => b.accountId!))], now),
  ]);
  return Promise.all(
    budgets.map(async (b) => {
      const specs = lineSpecs(b, mirrors);
      if (b.accountId) {
        const margin = b.outOfBudgetPlanned == null ? null : Number(b.outOfBudgetPlanned);
        const spend = computeAttachedSpend(
          { id: b.id, accountId: b.accountId },
          specs,
          loaded.get(b.id)!,
          subtrees,
          ctx,
          now,
        );
        const sum = summarizeAttached(specs, margin, spend, ctx);
        return {
          ...sum,
          landing: landing.includes(b)
            ? attachedLanding(specs, margin, spend, balances.get(b.accountId)!)
            : null,
          lines: specs.map((l, i) => ({ ...detailLine(l), ...sum.lines[i] })),
          counted: spend.counted,
          shown: { out: spend.out, unplanned: spend.unplanned },
          attached: { specs, spend },
        };
      }
      const { lineSums, outOfBudget, totalSum, counted } = await computeBudgetSpend(
        b,
        loaded.get(b.id)!,
        subtrees,
      );
      const plannedTotal = budgetPlannedTotal(specs.filter((l) => l.kind === "EXPENSE"));
      const { spent, percent, status } = lineStatus(plannedTotal, round2(-totalSum));
      return {
        lines: specs.map((l, i) => ({
          ...detailLine(l),
          ...lineStatus(l.plannedAmount, round2(-lineSums[i])),
          counterpartSavings: false,
        })),
        plannedTotal,
        spentTotal: spent,
        percent,
        status,
        incomePlanned: 0,
        incomeReceived: 0,
        outOfBudget:
          outOfBudget.length === 0
            ? null
            : {
                spent: round2(-outOfBudget.reduce((sum, r) => sum + r.amount, 0)),
                count: outOfBudget.length,
                planned: null,
                unmatchedTransfers: 0,
              },
        unplannedIncome: null,
        landing: null,
        counted,
        shown: { out: outOfBudget, unplanned: [] },
        attached: null,
      };
    }),
  );
}

async function balancesAsOf(accountIds: string[], asOf: Date): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const accounts = await db.bankAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, initialBalance: true },
  });
  return accountBalances(accounts, { asOf });
}

function detailLine(l: BudgetLineSpec) {
  return {
    id: l.id,
    kind: l.kind,
    categoryId: l.categoryId,
    accountId: l.accountId,
    direction: l.direction,
    counterpartAccountId: l.counterpartAccountId,
    label: l.label,
    mirrorOf: l.mirrorOf,
  };
}

export type BudgetDetail = {
  id: string;
  name: string;
  accountId: string | null;
  outOfBudgetPlanned: number | null;
  description: string | null;
  archived: boolean;
  scope: BudgetScope;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  recurring: boolean;
  lines: BudgetDetailLine[];
  plannedTotal: number;
  spentTotal: number;
  // Attached: rows no line takes, with the optional margin. Unattached: INCLUDEs no line matches (#345).
  outOfBudget: OutOfBudget | null;
  unplannedIncome: UnplannedIncome | null; // attached only
  incomePlanned: number;
  incomeReceived: number;
  forecast: BudgetForecast | null;
  landing: BudgetLanding | null;
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
    kind: l.kind,
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

export type BudgetForecast = { balance: number; remaining: number; endBalance: number };

// Projected balance at the end of the current period (#347): the scope's checking
// accounts minus what the lines still plan to spend. Income to come isn't anticipated.
async function budgetForecast(
  b: {
    userId: string | null;
    groupId: string | null;
    accountId: string | null;
    periodStart: Date;
    periodEnd: Date;
  },
  lines: { remaining: number }[],
  now: Date,
): Promise<BudgetForecast | null> {
  if (b.accountId || now < b.periodStart || now > b.periodEnd) return null;
  const accounts = await db.bankAccount.findMany({
    where: { id: { in: await budgetAccountIds(b) }, type: "CHECKING", archived: false },
    select: { id: true, initialBalance: true },
  });
  if (accounts.length === 0) return null;
  const balances = await accountBalances(accounts);
  const balance = round2([...balances.values()].reduce((sum, v) => sum + v, 0));
  const remaining = round2(lines.reduce((sum, l) => sum + Math.max(l.remaining, 0), 0));
  return { balance, remaining, endBalance: round2(balance - remaining) };
}

export async function getBudgetDetail(
  id: string,
  viewerId: string,
  {
    withTransactions = true,
    now = new Date(),
    show,
  }: { withTransactions?: boolean; now?: Date; show?: "out" | "unplanned" } = {},
): Promise<BudgetDetail> {
  const b = await readableOrThrow(id, viewerId);
  const { groupIds, roleByGroup } = await budgetScopeForUser(viewerId);
  const [e] = await evaluateBudgets([b], { userId: viewerId, groupIds }, now);
  const listed = show ? e.shown[show] : e.counted;
  return {
    id: b.id,
    name: b.name,
    accountId: b.accountId,
    outOfBudgetPlanned: b.outOfBudgetPlanned == null ? null : Number(b.outOfBudgetPlanned),
    description: b.description,
    archived: b.archived,
    scope: b.groupId ? "GROUP" : "USER",
    groupId: b.groupId,
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    recurring: b.recurring,
    lines: e.lines,
    plannedTotal: e.plannedTotal,
    spentTotal: e.spentTotal,
    outOfBudget: e.outOfBudget,
    unplannedIncome: e.unplannedIncome,
    incomePlanned: e.incomePlanned,
    incomeReceived: e.incomeReceived,
    forecast: await budgetForecast(
      b,
      e.lines.filter((l) => l.kind === "EXPENSE"),
      now,
    ),
    landing: e.landing,
    canManage: canManageBudget(b.groupId, roleByGroup),
    ...(await seriesNeighbours(b)),
    transactions: withTransactions ? await budgetTransactions(listed, viewerId, b.groupId) : [],
    transactionCount: listed.length,
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
  const detail = await getBudgetDetail(first.id, userId, { withTransactions: false, now });
  const names = await readableAccountNames(userId);
  const accountNames = Object.fromEntries(
    detail.lines.flatMap((l) =>
      [l.accountId, l.counterpartAccountId].flatMap((id) =>
        id && names.has(id) ? [[id, names.get(id)!]] : [],
      ),
    ),
  );
  return { detail, others: current.length - 1, accountNames };
}

export type CurrentLanding = Pick<BudgetListItem, "id" | "periodEnd" | "unplannedIncome"> & {
  accountId: string;
  accountName: string;
  landing: BudgetLanding;
};

// The landing of every account-attached budget the user reads whose period contains `now`
// (design §E, dashboard), evaluated together like the list (#299).
export async function listCurrentLandings(
  userId: string,
  now: Date = new Date(),
): Promise<CurrentLanding[]> {
  const { groupIds } = await budgetScopeForUser(userId);
  const rows = await db.budget.findMany({
    where: {
      archived: false,
      accountId: { not: null },
      periodStart: { lte: now },
      periodEnd: { gte: now },
      OR: [{ userId }, { groupId: { in: groupIds } }],
    },
    include: { lines: true },
    orderBy: { periodStart: "desc" },
  });
  if (rows.length === 0) return [];
  const [evaluations, names] = await Promise.all([
    evaluateBudgets(rows, { userId, groupIds }, now),
    readableAccountNames(userId),
  ]);
  return rows.flatMap((b, i) => {
    const { landing, unplannedIncome } = evaluations[i];
    if (!landing || !b.accountId) return [];
    return [
      {
        id: b.id,
        accountId: b.accountId,
        accountName: names.get(b.accountId) ?? "",
        periodEnd: b.periodEnd,
        landing,
        unplannedIncome,
      },
    ];
  });
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

const attachedFields = (b: Budget) => ({
  accountId: b.accountId,
  outOfBudgetPlanned: b.outOfBudgetPlanned,
});

const copiedLine = (l: BudgetLine) => ({
  kind: l.kind,
  categoryId: l.categoryId,
  accountId: l.accountId,
  direction: l.direction,
  counterpartAccountId: l.counterpartAccountId,
  label: l.label,
  plannedAmount: l.plannedAmount,
});

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
  if (b.accountId && (await attachedOverlap(b.accountId, period.start, period.end)))
    throw new BudgetAccessError("ACCOUNT_OVERLAP");

  const lines = await db.budgetLine.findMany({ where: { budgetId: b.id } });
  const instance = await db.budget.create({
    data: {
      name: b.name,
      description: b.description,
      userId: b.userId,
      groupId: b.groupId,
      ...attachedFields(b),
      periodType: b.periodType,
      periodStart: period.start,
      periodEnd: period.end,
      recurring: true,
      parentBudgetId: template,
      createdById,
      lines: { create: lines.map(copiedLine) },
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
  const planned = due.map((b) => ({
    b,
    id: randomUUID(),
    period: nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd),
  }));
  const instances = await withoutAttachedOverlap(planned);
  if (instances.length === 0) return { checked: due.length, rolled: 0 };
  await db.$transaction([
    db.budget.createMany({
      data: instances.map(({ b, id, period }) => ({
        id,
        name: b.name,
        description: b.description,
        userId: b.userId,
        groupId: b.groupId,
        ...attachedFields(b),
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
        b.lines.map((l) => ({ budgetId: id, ...copiedLine(l) })),
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
  return { checked: due.length, rolled: instances.length };
}

// Renewals whose period another attached budget doesn't already cover on the same account
// (design §B), for every budget at once.
async function withoutAttachedOverlap<T extends { b: Budget; period: { start: Date; end: Date } }>(
  planned: T[],
): Promise<T[]> {
  const attached = planned.filter((p) => p.b.accountId);
  if (attached.length === 0) return planned;
  const taken = await stillAttached(
    await db.budget.findMany({
      where: {
        archived: false,
        accountId: { in: [...new Set(attached.map((p) => p.b.accountId!))] },
        periodStart: { lte: new Date(Math.max(...attached.map((p) => p.period.end.getTime()))) },
        periodEnd: { gte: new Date(Math.min(...attached.map((p) => p.period.start.getTime()))) },
      },
      select: { accountId: true, groupId: true, periodStart: true, periodEnd: true },
    }),
  );
  return planned.filter(
    ({ b, period }) =>
      !b.accountId ||
      !taken.some(
        (t) =>
          t.accountId === b.accountId && t.periodStart <= period.end && t.periodEnd >= period.start,
      ),
  );
}

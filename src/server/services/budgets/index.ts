import type { Budget } from "@prisma/client";
import { db } from "@/server/db";
import { requireGroupRole } from "@/server/services/groups/roles";
import { logEvent } from "@/server/services/audit";
import { listVisibleForUser } from "@/server/services/accounts";
import { canReadAccount } from "@/server/services/accounts/sharing";
import { collapseLinkedRows } from "@/lib/links";
import { budgetPlannedTotal, lineStatus, nextPeriod, round2, type LineStatus } from "@/lib/budgets";
import {
  budgetInputSchema,
  type BudgetInput,
  type BudgetPeriodType,
} from "@/lib/validation/budget";

export class BudgetAccessError extends Error {}

export type BudgetScope = "USER" | "GROUP";

// Membership + visibility scope shared by the list and the assignable-budgets
// dropdown so both always expose the same set of budgets. `roleByGroup` lets
// callers decide who may manage a given group budget.
async function budgetScopeForUser(
  userId: string,
): Promise<{ groupIds: string[]; roleByGroup: Map<string, string> }> {
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true, role: true },
  });
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

function utcBounds(startDay: string, endDay: string): { start: Date; end: Date } {
  const start = new Date(`${startDay}T00:00:00.000Z`);
  const end = new Date(`${endDay}T23:59:59.999Z`);
  if (end.getTime() < start.getTime()) throw new BudgetAccessError("INVALID_PERIOD");
  return { start, end };
}

export async function createBudget(
  input: BudgetInput,
  actor: { id: string },
): Promise<{ id: string }> {
  const data = parseInput(input);
  await assertCanManageScope(data.groupId, actor.id);
  const { start, end } = utcBounds(data.periodStart, data.periodEnd);

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
  await manageableOrThrow(id, actor.id);
  const data = parseInput(input);
  const { start, end } = utcBounds(data.periodStart, data.periodEnd);
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
  await db.budget.delete({ where: { id } });
  await logEvent({ userId: actor.id, action: "budget.deleted", entity: "Budget", entityId: id });
}

export async function archiveBudget(id: string, actor: { id: string }): Promise<void> {
  await manageableOrThrow(id, actor.id);
  await db.budget.update({ where: { id }, data: { archived: true } });
  await logEvent({ userId: actor.id, action: "budget.archived", entity: "Budget", entityId: id });
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
  ended: boolean; // period is over (eligible for a recurring roll)
  canManage: boolean; // actor may edit/delete/roll (own, or ADMIN+ of the group)
};

// True when the actor may manage a budget of this scope: a personal budget is
// managed by its owner; a group budget requires ADMIN or OWNER in that group.
function canManageBudget(groupId: string | null, roleByGroup: Map<string, string>): boolean {
  if (!groupId) return true;
  const role = roleByGroup.get(groupId);
  return role === "ADMIN" || role === "OWNER";
}

// The user's own budgets + those of groups they belong to (not archived).
export async function listBudgetsForUser(userId: string): Promise<BudgetListItem[]> {
  const { groupIds, roleByGroup } = await budgetScopeForUser(userId);
  const rows = await db.budget.findMany({
    where: { archived: false, OR: [{ userId }, { groupId: { in: groupIds } }] },
    include: { lines: { select: { plannedAmount: true } } },
    orderBy: { periodStart: "desc" },
  });
  const now = Date.now();
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    scope: b.groupId ? "GROUP" : "USER",
    groupId: b.groupId,
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    recurring: b.recurring,
    plannedTotal: budgetPlannedTotal(
      b.lines.map((l) => ({ plannedAmount: Number(l.plannedAmount) })),
    ),
    ended: b.periodEnd.getTime() < now,
    canManage: canManageBudget(b.groupId, roleByGroup),
  }));
}

type BudgetRow = {
  id: string;
  amount: number;
  date: Date;
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
  return (await listVisibleForUser(budget.userId)).map((a) => a.id);
}

// Loads the budget's candidate rows once: transactions on the budget's account
// scope within its period, PLUS any transaction explicitly assigned to this
// budget regardless of account or period — so an INCLUDE can pull in an
// out-of-period or personal-into-shared transaction, and an EXCLUDE always
// resolves.
async function loadBudgetRows(budget: {
  id: string;
  userId: string | null;
  groupId: string | null;
  periodStart: Date;
  periodEnd: Date;
}): Promise<{
  rows: BudgetRow[];
  excluded: Set<string>;
  includedIds: Set<string>;
}> {
  const assignments = await db.budgetAssignment.findMany({
    where: { budgetId: budget.id },
    select: { transactionId: true, mode: true },
  });
  const excluded = new Set(
    assignments.filter((a) => a.mode === "EXCLUDE").map((a) => a.transactionId),
  );
  const includedIds = new Set(
    assignments.filter((a) => a.mode === "INCLUDE").map((a) => a.transactionId),
  );

  const accountIds = await budgetAccountIds(budget);
  const assignedIds = [...includedIds, ...excluded];

  const orClauses: object[] = [];
  if (accountIds.length > 0) {
    orClauses.push({
      accountId: { in: accountIds },
      date: { gte: budget.periodStart, lte: budget.periodEnd },
    });
  }
  if (assignedIds.length > 0) orClauses.push({ id: { in: assignedIds } });

  const rows: BudgetRow[] =
    orClauses.length === 0
      ? []
      : (
          await db.transaction.findMany({
            where: { OR: orClauses },
            select: {
              id: true,
              amount: true,
              date: true,
              categoryId: true,
              accountId: true,
              linkMembership: { select: { linkId: true } },
            },
          })
        ).map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          date: r.date,
          categoryId: r.categoryId,
          accountId: r.accountId,
          linkId: r.linkMembership?.linkId ?? null,
        }));

  return { rows, excluded, includedIds };
}

type LineFilter = { categoryId: string | null; accountId: string | null };

// A line auto-matches a row by its category and/or account filter. A line with
// neither filter auto-matches nothing (spend comes only from INCLUDE).
function matchesLine(r: BudgetRow, line: LineFilter): boolean {
  if (line.categoryId == null && line.accountId == null) return false;
  if (line.categoryId != null && r.categoryId !== line.categoryId) return false;
  if (line.accountId != null && r.accountId !== line.accountId) return false;
  return true;
}

export type BudgetDetail = {
  id: string;
  name: string;
  description: string | null;
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
};

export async function getBudgetDetail(id: string, viewerId: string): Promise<BudgetDetail> {
  const b = await readableOrThrow(id, viewerId);
  const { rows, excluded, includedIds } = await loadBudgetRows(b);

  // Collapse links across the WHOLE loaded scope first, so a linked group split
  // across categories nets correctly (the offsetting member is not dropped by a
  // per-line filter). Each surviving row carries its primary's category/account.
  const collapsed = collapseLinkedRows(rows);
  const filters: LineFilter[] = b.lines.map((l) => ({
    categoryId: l.categoryId,
    accountId: l.accountId,
  }));

  // Per-line sums for display + a budget-wide dedup sum for the total: a tx that
  // matches several lines is counted once in the total; an INCLUDE'd tx that
  // matches no line is attributed to the first line for display.
  const lineSums = new Array<number>(b.lines.length).fill(0);
  let totalSum = 0;
  for (const r of collapsed) {
    if (excluded.has(r.id)) continue;
    const matchedIdx = filters.flatMap((f, i) => (matchesLine(r, f) ? [i] : []));
    if (matchedIdx.length === 0 && !includedIds.has(r.id)) continue; // not in this budget
    totalSum += r.amount; // counted once toward the total
    if (matchedIdx.length > 0) {
      for (const i of matchedIdx) lineSums[i] += r.amount;
    } else if (b.lines.length > 0) {
      lineSums[0] += r.amount; // pure INCLUDE with no matching line
    }
  }

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
    scope: b.groupId ? "GROUP" : "USER",
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    recurring: b.recurring,
    lines,
    plannedTotal,
    spentTotal,
  };
}

export async function assignTransaction(
  input: { budgetId: string; transactionId: string; mode: "INCLUDE" | "EXCLUDE" },
  actor: { id: string },
): Promise<void> {
  if (input.mode !== "INCLUDE" && input.mode !== "EXCLUDE") throw new BudgetAccessError("INVALID");
  await readableOrThrow(input.budgetId, actor.id);
  const txRow = await db.transaction.findUnique({
    where: { id: input.transactionId },
    select: { accountId: true },
  });
  if (!txRow) throw new BudgetAccessError("NOT_FOUND");
  if (!(await canReadAccount(actor.id, txRow.accountId))) throw new BudgetAccessError("FORBIDDEN");

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
export async function listAssignableBudgets(
  userId: string,
): Promise<{ id: string; name: string; scope: BudgetScope }[]> {
  const { groupIds } = await budgetScopeForUser(userId);
  const rows = await db.budget.findMany({
    where: { archived: false, OR: [{ userId }, { groupId: { in: groupIds } }] },
    select: { id: true, name: true, groupId: true },
    orderBy: { periodStart: "desc" },
  });
  return rows.map((b) => ({ id: b.id, name: b.name, scope: b.groupId ? "GROUP" : "USER" }));
}

// The assignments on a transaction (for the detail panel to show current state).
export async function listAssignmentsForTx(
  transactionId: string,
): Promise<{ budgetId: string; mode: string }[]> {
  return db.budgetAssignment.findMany({
    where: { transactionId },
    select: { budgetId: true, mode: true },
  });
}

// Creates the next-period instance of a recurring budget (copies scope + lines,
// links parentBudgetId). Idempotent: no-op if that next instance already exists.
// Core roll: create the next-period instance of a recurring budget if it doesn't
// already exist (idempotent). `createdById` owns the new row; `auditUserId` is the
// acting user (null for the system cron → anonymous audit).
async function rollFrom(
  b: Budget,
  createdById: string,
  auditUserId: string | null,
): Promise<{ created: boolean; id?: string }> {
  if (!b.recurring) throw new BudgetAccessError("NOT_RECURRING");
  const template = b.parentBudgetId ?? b.id; // chain instances off the original template
  const period = nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd);

  const existing = await db.budget.findFirst({
    where: { parentBudgetId: template, periodStart: period.start },
    select: { id: true },
  });
  if (existing) return { created: false };

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

// System (cron) roll: no actor/permission check; the new instance inherits the
// template's creator and the audit entry is anonymous.
export async function rollRecurringSystem(id: string): Promise<{ created: boolean; id?: string }> {
  const b = await db.budget.findUnique({ where: { id } });
  if (!b) throw new BudgetAccessError("NOT_FOUND");
  return rollFrom(b, b.createdById, null);
}

// Recurring budgets whose period has ended and whose next-period instance doesn't
// exist yet — the work list for the roll cron (each roll is independently idempotent).
export async function listRollableTemplates(now: Date): Promise<{ id: string }[]> {
  const ended = await db.budget.findMany({
    where: { recurring: true, archived: false, periodEnd: { lt: now } },
    select: {
      id: true,
      parentBudgetId: true,
      periodType: true,
      periodStart: true,
      periodEnd: true,
    },
  });
  const rollable: { id: string }[] = [];
  for (const b of ended) {
    const template = b.parentBudgetId ?? b.id;
    const period = nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd);
    const existing = await db.budget.findFirst({
      where: { parentBudgetId: template, periodStart: period.start },
      select: { id: true },
    });
    if (!existing) rollable.push({ id: b.id });
  }
  return rollable;
}

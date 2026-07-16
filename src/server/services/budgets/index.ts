import { db } from "@/server/db";
import { requireGroupRole } from "@/server/services/groups/roles";
import { logEvent } from "@/server/services/audit";
import { listVisibleForUser } from "@/server/services/accounts";
import { collapseLinkedRows } from "@/lib/links";
import { lineStatus, type LineStatus } from "@/lib/budgets";
import { budgetInputSchema, type BudgetInput } from "@/lib/validation/budget";

export class BudgetAccessError extends Error {}

export type BudgetScope = "USER" | "GROUP";

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
};

// The user's own budgets + those of groups they belong to (not archived).
export async function listBudgetsForUser(userId: string): Promise<BudgetListItem[]> {
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.budget.findMany({
    where: { archived: false, OR: [{ userId }, { groupId: { in: groupIds } }] },
    include: { lines: { select: { plannedAmount: true } } },
    orderBy: { periodStart: "desc" },
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    scope: b.groupId ? "GROUP" : "USER",
    groupId: b.groupId,
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    recurring: b.recurring,
    plannedTotal: Math.round(b.lines.reduce((s, l) => s + Number(l.plannedAmount), 0) * 100) / 100,
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

// Loads the budget's candidate rows once: transactions visible to `viewerId`
// within the period, plus this budget's INCLUDE/EXCLUDE assignments.
async function loadBudgetRows(
  budget: { id: string; periodStart: Date; periodEnd: Date },
  viewerId: string,
): Promise<{
  rows: BudgetRow[];
  excluded: Set<string>;
  includedIds: Set<string>;
}> {
  const accountIds = (await listVisibleForUser(viewerId)).map((a) => a.id);
  const rows: BudgetRow[] =
    accountIds.length === 0
      ? []
      : (
          await db.transaction.findMany({
            where: {
              accountId: { in: accountIds },
              date: { gte: budget.periodStart, lte: budget.periodEnd },
            },
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
  return { rows, excluded, includedIds };
}

// Computes one line's spend against a preloaded candidate set (spec §5.7).
export function computeLine(
  line: { categoryId: string | null; accountId: string | null; plannedAmount: number },
  loaded: { rows: BudgetRow[]; excluded: Set<string>; includedIds: Set<string> },
): LineStatus {
  const matched = loaded.rows.filter((r) => {
    if (loaded.excluded.has(r.id)) return false;
    if (loaded.includedIds.has(r.id)) return true; // explicit include wins
    if (line.categoryId && r.categoryId !== line.categoryId) return false;
    if (line.accountId && r.accountId !== line.accountId) return false;
    // A line with neither filter auto-matches nothing.
    return line.categoryId != null || line.accountId != null;
  });
  const collapsed = collapseLinkedRows(matched);
  const sumEffective = collapsed.reduce((s, r) => s + r.amount, 0);
  const spent = Math.round(-sumEffective * 100) / 100;
  return lineStatus(Number(line.plannedAmount), spent);
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
  // Compute against the transactions visible to the budget's owner scope: for a
  // group budget that is the group's shared accounts; for a personal budget it
  // is the owner's own visible set. Use the budget owner as the viewer.
  const ownerViewer = b.userId ?? viewerId;
  const loaded = await loadBudgetRows(b, ownerViewer);
  const lines = b.lines.map((l) => ({
    id: l.id,
    categoryId: l.categoryId,
    accountId: l.accountId,
    label: l.label,
    ...computeLine(
      { categoryId: l.categoryId, accountId: l.accountId, plannedAmount: Number(l.plannedAmount) },
      loaded,
    ),
  }));
  const plannedTotal = Math.round(lines.reduce((s, l) => s + l.plannedAmount, 0) * 100) / 100;
  const spentTotal = Math.round(lines.reduce((s, l) => s + l.spent, 0) * 100) / 100;
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

import { db } from "@/server/db";
import { requireGroupRole } from "@/server/services/groups/roles";
import { logEvent } from "@/server/services/audit";
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
  await logEvent({ userId: actor.id, action: "budget.created", entity: "Budget", entityId: budget.id });
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
  const memberships = await db.groupMember.findMany({ where: { userId }, select: { groupId: true } });
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

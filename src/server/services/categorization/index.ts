import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { requireGroupRole } from "@/server/services/groups/roles";
import { assertCategoryAssignable, CategoryAccessError } from "@/server/services/categories";
import { ruleInputSchema, type RuleInput } from "@/lib/validation/rule";
import { isValidRulePattern } from "./regex";
import { compareRules, pickByPriority, type Rule } from "./match";
import type { RuleMatchType } from "@/lib/validation/rule";

export class RuleAccessError extends Error {}
export class RuleValidationError extends Error {}

function assertValidPattern(data: { pattern: string; matchType: string }): void {
  if (data.matchType === "REGEX" && !isValidRulePattern(data.pattern)) {
    throw new RuleValidationError("INVALID_REGEX");
  }
}

// Rejects a rule categoryId the actor cannot see (a forged id pointing at another
// user's private category). The category must be one the actor can see — their
// own or one of their groups'. Surfaced as RuleAccessError.
export async function assertRuleCategory(categoryId: string, actorId: string): Promise<void> {
  try {
    await assertCategoryAssignable(categoryId, actorId);
  } catch (e) {
    if (e instanceof CategoryAccessError) throw new RuleAccessError("INVALID_CATEGORY");
    throw e;
  }
}

export type Suggestion = { categoryId: string | null; ruleId: string | null };
export type Scope = { userId: string };

// Loads the user's own + their groups' enabled rules once, highest priority
// first. Shared by suggest (single) and suggestMany (batch import preview).
export async function loadRules(scope: Scope): Promise<Rule[]> {
  const memberships = await db.groupMember.findMany({
    where: { userId: scope.userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.categorizationRule.findMany({
    where: { enabled: true, OR: [{ userId: scope.userId }, { groupId: { in: groupIds } }] },
    orderBy: { priority: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    pattern: r.pattern,
    matchType: r.matchType as RuleMatchType,
    caseSensitive: r.caseSensitive,
    priority: r.priority,
    createdAt: r.createdAt.getTime(),
  }));
}

function match(rules: Rule[], rawLabel: string): Suggestion {
  const hit = pickByPriority(rules, rawLabel);
  return hit ? { categoryId: hit.categoryId, ruleId: hit.id } : { categoryId: null, ruleId: null };
}

// Suggests a category for a label by matching the user's own + their groups'
// enabled rules, highest priority first. Used by manual entry (3.4).
export async function suggest(rawLabel: string, scope: Scope): Promise<Suggestion> {
  return match(await loadRules(scope), rawLabel);
}

// Batch variant: loads the rules ONCE then matches every label. Used by the
// import preview and commit so N rows don't trigger N rule loads.
export async function suggestMany(rawLabels: string[], scope: Scope): Promise<Suggestion[]> {
  const rules = await loadRules(scope);
  return rawLabels.map((label) => match(rules, label));
}

// Takes back hits credited by an import that is being reverted, never below zero.
export async function revokeHits(
  ruleHits: Record<string, number>,
  client: Prisma.TransactionClient = db,
): Promise<void> {
  for (const [id, n] of Object.entries(ruleHits)) {
    const { count } = await client.categorizationRule.updateMany({
      where: { id, hits: { gte: n } },
      data: { hits: { decrement: n } },
    });
    if (count === 0) {
      await client.categorizationRule.updateMany({ where: { id }, data: { hits: 0 } });
    }
  }
}

// Rules sharing the same increment are batched into one updateMany; a rule
// deleted meanwhile is silently skipped.
export async function recordHits(
  ruleIds: (string | null)[],
  client: Prisma.TransactionClient = db,
): Promise<void> {
  const perRule = new Map<string, number>();
  for (const id of ruleIds) if (id) perRule.set(id, (perRule.get(id) ?? 0) + 1);
  const byCount = new Map<number, string[]>();
  for (const [id, n] of perRule) byCount.set(n, [...(byCount.get(n) ?? []), id]);
  for (const [n, ids] of byCount) {
    await client.categorizationRule.updateMany({
      where: { id: { in: ids } },
      data: { hits: { increment: n } },
    });
  }
}

export async function createRule(input: RuleInput, actor: { id: string }): Promise<{ id: string }> {
  const data = ruleInputSchema.parse(input);
  assertValidPattern(data);
  if (data.groupId) {
    try {
      await requireGroupRole(data.groupId, actor.id, "ADMIN");
    } catch {
      throw new RuleAccessError("FORBIDDEN");
    }
  }
  await assertRuleCategory(data.categoryId, actor.id);
  const rule = await db.categorizationRule.create({
    data: {
      pattern: data.pattern,
      matchType: data.matchType,
      caseSensitive: data.caseSensitive,
      priority: data.priority,
      categoryId: data.categoryId,
      userId: data.groupId ? null : actor.id,
      groupId: data.groupId ?? null,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "rule.created",
    entity: "CategorizationRule",
    entityId: rule.id,
  });
  return { id: rule.id };
}

export async function listRulesForUser(userId: string) {
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const rules = await db.categorizationRule.findMany({
    where: { OR: [{ userId }, { groupId: { in: groupIds } }] },
    include: {
      category: { select: { id: true, name: true, color: true } },
      group: { select: { id: true, name: true } },
    },
  });
  const key = (r: (typeof rules)[number]) => ({ ...r, createdAt: r.createdAt.getTime() });
  return rules.sort((a, b) => compareRules(key(a), key(b)));
}

// Loads a rule and checks the actor may manage it: own rules (userId) or group
// rules where the actor is at least ADMIN. Throws RuleAccessError otherwise.
export async function loadManageableRule(id: string, actorId: string) {
  const rule = await db.categorizationRule.findUnique({ where: { id } });
  if (!rule) throw new RuleAccessError("NOT_FOUND");
  if (rule.groupId) {
    try {
      await requireGroupRole(rule.groupId, actorId, "ADMIN");
    } catch {
      throw new RuleAccessError("FORBIDDEN");
    }
  } else if (rule.userId !== actorId) {
    throw new RuleAccessError("FORBIDDEN");
  }
  return rule;
}

// Updates a rule's pattern/match/priority/category. Scope (user vs group) is
// immutable here — recreate the rule to move it.
export async function updateRule(
  id: string,
  input: RuleInput,
  actor: { id: string },
): Promise<void> {
  await loadManageableRule(id, actor.id);
  const data = ruleInputSchema.parse(input);
  assertValidPattern(data);
  await assertRuleCategory(data.categoryId, actor.id);
  await db.categorizationRule.update({
    where: { id },
    data: {
      pattern: data.pattern,
      matchType: data.matchType,
      caseSensitive: data.caseSensitive,
      priority: data.priority,
      categoryId: data.categoryId,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "rule.updated",
    entity: "CategorizationRule",
    entityId: id,
  });
}

export async function deleteRule(id: string, actor: { id: string }): Promise<void> {
  await loadManageableRule(id, actor.id);
  await db.categorizationRule.delete({ where: { id } });
  await logEvent({
    userId: actor.id,
    action: "rule.deleted",
    entity: "CategorizationRule",
    entityId: id,
  });
}

export async function toggleRule(
  id: string,
  enabled: boolean,
  actor: { id: string },
): Promise<void> {
  await loadManageableRule(id, actor.id);
  await db.categorizationRule.update({ where: { id }, data: { enabled } });
  await logEvent({
    userId: actor.id,
    action: enabled ? "rule.enabled" : "rule.disabled",
    entity: "CategorizationRule",
    entityId: id,
  });
}

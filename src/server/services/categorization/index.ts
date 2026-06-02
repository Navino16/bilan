import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { requireGroupRole } from "@/server/services/groups/roles";
import { ruleInputSchema, type RuleInput } from "@/lib/validation/rule";
import { pickByPriority, proposeRule, type Rule } from "./match";
import type { RuleMatchType } from "@/lib/validation/rule";

export class RuleAccessError extends Error {}

export type Suggestion = { categoryId: string | null; ruleId: string | null };
export type Scope = { userId: string };

// Suggests a category for a label by matching the user's own + their groups'
// enabled rules, highest priority first. Used by manual entry (3.4) and import (4.x).
export async function suggest(rawLabel: string, scope: Scope): Promise<Suggestion> {
  const memberships = await db.groupMember.findMany({
    where: { userId: scope.userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.categorizationRule.findMany({
    where: { enabled: true, OR: [{ userId: scope.userId }, { groupId: { in: groupIds } }] },
    orderBy: { priority: "desc" },
  });
  const rules: Rule[] = rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    pattern: r.pattern,
    matchType: r.matchType as RuleMatchType,
    caseSensitive: r.caseSensitive,
    priority: r.priority,
  }));
  const hit = pickByPriority(rules, rawLabel);
  return hit ? { categoryId: hit.categoryId, ruleId: hit.id } : { categoryId: null, ruleId: null };
}

export async function createRule(input: RuleInput, actor: { id: string }): Promise<{ id: string }> {
  const data = ruleInputSchema.parse(input);
  if (data.groupId) {
    try {
      await requireGroupRole(data.groupId, actor.id, "ADMIN");
    } catch {
      throw new RuleAccessError("FORBIDDEN");
    }
  }
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
  return db.categorizationRule.findMany({
    where: { OR: [{ userId }, { groupId: { in: groupIds } }] },
    orderBy: { priority: "desc" },
  });
}

export { proposeRule };

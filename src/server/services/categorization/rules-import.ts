import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { logEvent } from "@/server/services/audit";
import { requireGroupRole } from "@/server/services/groups/roles";
import {
  categoryPathKey,
  planRulesImport,
  resolveCategoryPaths,
  type CategoryDecision,
  type ExistingRule,
  type ImportCategory,
  type ImportDecisions,
  type ImportPlan,
  type PathResolution,
} from "@/lib/rules-import";
import type { FileRule, RejectedRule } from "@/lib/validation/rules-file";
import type { RuleMatchType } from "@/lib/validation/rule";
import { RuleAccessError, RuleValidationError } from "./index";
import { parseRulesFile } from "./rules-file";

type Target = { groupId: string | null };
type Client = Prisma.TransactionClient;

export type RulesImportPreview = {
  rules: FileRule[];
  rejected: RejectedRule[];
  resolutions: PathResolution[];
  existing: ExistingRule[];
};

export type RulesImportSummary = {
  created: number;
  moved: number;
  identical: number;
  duplicates: number;
  ignored: number;
  rejected: number;
};

export type RulesImportResult = {
  createdRuleIds: string[];
  movedRuleIds: string[];
  summary: RulesImportSummary;
};

async function assertCanImport(target: Target, actorId: string): Promise<void> {
  if (!target.groupId) return;
  try {
    await requireGroupRole(target.groupId, actorId, "ADMIN");
  } catch {
    throw new RuleAccessError("FORBIDDEN");
  }
}

function parseOrThrow(text: string) {
  const parsed = parseRulesFile(text);
  if (!parsed.ok) throw new RuleValidationError(parsed.error);
  return parsed;
}

const targetOwner = (target: Target, actorId: string) =>
  target.groupId ? { userId: null, groupId: target.groupId } : { userId: actorId, groupId: null };

// Same set as `listForUser`, read through `client` so the commit sees it inside its transaction.
async function loadCategories(
  client: Client,
  target: Target,
  actorId: string,
): Promise<ImportCategory[]> {
  const memberships = await client.groupMember.findMany({
    where: { userId: actorId },
    select: { groupId: true },
  });
  const rows = await client.category.findMany({
    where: { OR: [{ userId: actorId }, { groupId: { in: memberships.map((m) => m.groupId) } }] },
    select: { id: true, name: true, parentId: true, userId: true, groupId: true },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    inTarget: target.groupId
      ? c.groupId === target.groupId
      : c.groupId === null && c.userId === actorId,
  }));
}

// Root-first names; a category outside the actor's categories only gives its own name, as on export.
function categoryPath(id: string, fallback: string, byId: Map<string, ImportCategory>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (
    let c = byId.get(id);
    c && !seen.has(c.id);
    c = c.parentId ? byId.get(c.parentId) : undefined
  ) {
    seen.add(c.id);
    names.unshift(c.name);
  }
  return names.length > 0 ? names : [fallback];
}

async function loadExisting(
  client: Client,
  target: Target,
  actorId: string,
  categories: ImportCategory[],
) {
  const rows = await client.categorizationRule.findMany({
    where: target.groupId ? { groupId: target.groupId } : { userId: actorId, groupId: null },
    include: { category: { select: { name: true } } },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));
  return rows.map((r): ExistingRule => {
    const path = categoryPath(r.categoryId, r.category.name, byId);
    return {
      id: r.id,
      pattern: r.pattern,
      matchType: r.matchType as RuleMatchType,
      caseSensitive: r.caseSensitive,
      categoryId: r.categoryId,
      categoryPath: path,
      categoryPathKey: categoryPathKey(path.map((name) => ({ name }))),
    };
  });
}

export async function previewRulesImport(
  text: string,
  target: Target,
  actor: { id: string },
): Promise<RulesImportPreview> {
  await assertCanImport(target, actor.id);
  const { rules, rejected } = parseOrThrow(text);
  const categories = await loadCategories(db, target, actor.id);
  return {
    rules,
    rejected,
    resolutions: resolveCategoryPaths(rules, categories),
    existing: await loadExisting(db, target, actor.id, categories),
  };
}

const decisionOf = (decisions: ImportDecisions, key: string): CategoryDecision | undefined =>
  Object.hasOwn(decisions.categories, key) ? decisions.categories[key] : undefined;

function assertDecisions(
  plan: ImportPlan,
  resolutions: PathResolution[],
  categories: ImportCategory[],
  decisions: ImportDecisions,
): void {
  if (plan.undecided.length > 0) throw new RuleValidationError("INVALID_DECISION");
  const assignable = new Set(categories.map((c) => c.id));
  for (const r of resolutions) {
    const decision = r.categoryId === null ? decisionOf(decisions, r.key) : undefined;
    if (decision?.action === "map" && !assignable.has(decision.categoryId)) {
      throw new RuleValidationError("INVALID_DECISION");
    }
  }
  const conflicting = new Set(plan.conflicts.map((c) => c.ruleId));
  if (decisions.moves.some((id) => !conflicting.has(id))) {
    throw new RuleValidationError("INVALID_DECISION");
  }
}

// Resolves each path key to its category, creating the missing levels of a Create path on first
// use; levels shared by several paths are keyed by anchor + normalized prefix and created once.
function categoryResolver(
  tx: Client,
  resolutions: PathResolution[],
  decisions: ImportDecisions,
  owner: ReturnType<typeof targetOwner>,
) {
  const byKey = new Map(resolutions.map((r) => [r.key, r]));
  const createdLevels = new Map<string, string>();

  return async (pathKey: string): Promise<string> => {
    const resolution = byKey.get(pathKey)!;
    if (resolution.categoryId) return resolution.categoryId;
    const decision = decisionOf(decisions, pathKey);
    if (decision?.action === "map") return decision.categoryId;

    const depth = resolution.path.length - resolution.missing.length;
    let parentId = resolution.anchorId;
    for (let i = 0; i < resolution.missing.length; i++) {
      const prefix = categoryPathKey(resolution.path.slice(depth, depth + i + 1));
      const levelKey = JSON.stringify([resolution.anchorId, prefix]);
      let id = createdLevels.get(levelKey);
      if (!id) {
        const level = resolution.missing[i];
        id = (
          await tx.category.create({
            data: {
              name: level.name,
              color: level.color ?? null,
              icon: level.icon ?? null,
              parentId,
              isDefault: false,
              ...owner,
            },
            select: { id: true },
          })
        ).id;
        createdLevels.set(levelKey, id);
      }
      parentId = id;
    }
    return parentId!;
  };
}

export async function commitRulesImport(
  text: string,
  target: Target,
  decisions: ImportDecisions,
  actor: { id: string },
): Promise<RulesImportResult> {
  await assertCanImport(target, actor.id);
  const { rules, rejected } = parseOrThrow(text);
  const owner = targetOwner(target, actor.id);

  const result = await db.$transaction(async (tx) => {
    const categories = await loadCategories(tx, target, actor.id);
    const resolutions = resolveCategoryPaths(rules, categories);
    const existing = await loadExisting(tx, target, actor.id, categories);
    const plan = planRulesImport(rules, resolutions, existing, decisions);
    assertDecisions(plan, resolutions, categories, decisions);

    const categoryOf = categoryResolver(tx, resolutions, decisions, owner);
    const createdRuleIds: string[] = [];
    // The file lists rules winner-first; the first one is created newest so ties keep their
    // order under the createdAt tie-break of compareRules (#291).
    const base = Date.now();
    for (const [index, rule] of plan.create.entries()) {
      const created = await tx.categorizationRule.create({
        data: {
          createdAt: new Date(base - index),
          pattern: rule.pattern,
          matchType: rule.matchType,
          caseSensitive: rule.caseSensitive,
          priority: rule.priority,
          enabled: rule.enabled,
          categoryId: await categoryOf(rule.pathKey),
          ...owner,
        },
        select: { id: true },
      });
      createdRuleIds.push(created.id);
    }
    for (const move of plan.move) {
      await tx.categorizationRule.update({
        where: { id: move.ruleId },
        data: { categoryId: await categoryOf(move.pathKey) },
      });
    }
    return {
      createdRuleIds,
      movedRuleIds: plan.move.map((m) => m.ruleId),
      summary: {
        created: plan.create.length,
        moved: plan.move.length,
        identical: plan.identical,
        duplicates: plan.duplicates,
        ignored: plan.ignored,
        rejected: rejected.length,
      },
    };
  }, LONG_TX_TIMEOUT);

  await logEvent({
    userId: actor.id,
    action: "rule.imported",
    entity: "CategorizationRule",
    metadata: { ...result.summary, groupId: target.groupId },
  });
  return result;
}

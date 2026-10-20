import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { listForUser, type CategoryNode } from "@/server/services/categories";
import { getMembership } from "@/server/services/groups/roles";
import {
  RULES_FILE_FORMAT,
  RULES_FILE_VERSION,
  type CategoryLevel,
  type FileRule,
  type RulesFile,
} from "@/lib/validation/rules-file";
import type { RuleMatchType } from "@/lib/validation/rule";
import { RuleAccessError } from "./index";
import { compareRules } from "./match";

type Appearance = { name: string; color: string | null; icon: string | null };

function level({ name, color, icon }: Appearance): CategoryLevel {
  return { name, ...(color ? { color } : {}), ...(icon ? { icon } : {}) };
}

function indexTree(nodes: CategoryNode[], into = new Map<string, CategoryNode>()) {
  for (const n of nodes) {
    into.set(n.id, n);
    indexTree(n.children, into);
  }
  return into;
}

// Root-first chain for a category the actor can see; a category outside their tree
// (e.g. another member's personal one on a household rule) only discloses name and color.
function categoryChain(
  row: Appearance & { id: string },
  tree: Map<string, CategoryNode>,
): CategoryLevel[] {
  if (!tree.has(row.id)) return [level({ ...row, icon: null })];
  const chain: CategoryLevel[] = [];
  for (
    let node = tree.get(row.id);
    node;
    node = node.parentId ? tree.get(node.parentId) : undefined
  ) {
    chain.unshift(level(node));
  }
  return chain;
}

export async function exportRules(
  target: { groupId: string | null },
  actor: { id: string },
): Promise<RulesFile> {
  if (target.groupId && !(await getMembership(target.groupId, actor.id))) {
    throw new RuleAccessError("FORBIDDEN");
  }
  const rows = await db.categorizationRule.findMany({
    where: target.groupId ? { groupId: target.groupId } : { userId: actor.id, groupId: null },
    include: { category: { select: { id: true, name: true, color: true, icon: true } } },
  });
  const tree = indexTree(await listForUser(actor.id));

  const rules: FileRule[] = rows
    .sort((a, b) =>
      compareRules(
        { ...a, createdAt: a.createdAt.getTime() },
        { ...b, createdAt: b.createdAt.getTime() },
      ),
    )
    .map((r) => ({
      pattern: r.pattern,
      matchType: r.matchType as RuleMatchType,
      caseSensitive: r.caseSensitive,
      priority: r.priority,
      enabled: r.enabled,
      category: categoryChain(r.category, tree),
    }));

  await logEvent({
    userId: actor.id,
    action: "rules.exported",
    entity: "CategorizationRule",
    metadata: { count: rules.length, groupId: target.groupId },
  });
  return {
    format: RULES_FILE_FORMAT,
    version: RULES_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    rules,
  };
}

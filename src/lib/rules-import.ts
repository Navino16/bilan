import { normalizeText } from "@/lib/text";
import type { CategoryLevel, FileRule } from "@/lib/validation/rules-file";
import type { RuleMatchType } from "@/lib/validation/rule";

export type ImportCategory = {
  id: string;
  name: string;
  parentId: string | null;
  inTarget: boolean;
};

export type PathResolution = {
  key: string;
  path: CategoryLevel[];
  ruleCount: number;
  categoryId: string | null;
  anchorId: string | null;
  missing: CategoryLevel[];
};

export type ExistingRule = {
  id: string;
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  categoryId: string;
  categoryPath: string[];
  // null when the category is outside the actor's categories: its path is unknown.
  categoryPathKey: string | null;
};

export type CategoryDecision =
  | { action: "create" }
  | { action: "map"; categoryId: string }
  | { action: "ignore" };

export type ImportDecisions = {
  categories: Record<string, CategoryDecision>;
  moves: string[];
};

export type ImportPlan = {
  create: (FileRule & { pathKey: string })[];
  conflicts: { ruleId: string; pattern: string; currentCategoryPath: string[]; pathKey: string }[];
  move: { ruleId: string; pathKey: string }[];
  identical: number;
  duplicates: number;
  ignored: number;
  undecided: string[];
};

const KEY_SEPARATOR = "\u001f";

const levelKeys = (path: { name: string }[]): string[] =>
  path.map((level) => normalizeText(level.name));

export function categoryPathKey(path: { name: string }[]): string {
  return levelKeys(path).join(KEY_SEPARATOR);
}

type Chained = { category: ImportCategory; chain: string[]; rooted: boolean };

// Root-first normalized names; `rooted` is false when an ancestor is missing or the parents loop.
function buildChains(categories: ImportCategory[]): Chained[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categories.map((category) => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: ImportCategory | undefined = category;
    let rooted = false;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.unshift(normalizeText(current.name));
      if (current.parentId === null) {
        rooted = true;
        break;
      }
      current = byId.get(current.parentId);
    }
    return { category, chain, rooted };
  });
}

function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// Code-point order, so the pick does not depend on the runtime's ICU data.
function pickFirst(candidates: Chained[]): ImportCategory | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort(
    (a, b) =>
      compareCodePoints(a.category.name, b.category.name) ||
      compareCodePoints(a.category.id, b.category.id),
  );
  return sorted[0].category;
}

function sameChain(chain: string[], keys: string[]): boolean {
  return chain.length === keys.length && chain.every((name, i) => name === keys[i]);
}

function endsWith(chain: string[], keys: string[]): boolean {
  if (chain.length < keys.length) return false;
  const offset = chain.length - keys.length;
  return keys.every((name, i) => chain[offset + i] === name);
}

export function resolveCategoryPaths(
  rules: FileRule[],
  categories: ImportCategory[],
): PathResolution[] {
  const chains = buildChains(categories);
  const targetRooted = chains.filter((c) => c.category.inTarget && c.rooted);
  const resolutions = new Map<string, PathResolution>();

  for (const rule of rules) {
    const keys = levelKeys(rule.category);
    const key = keys.join(KEY_SEPARATOR);
    const known = resolutions.get(key);
    if (known) {
      known.ruleCount++;
      continue;
    }
    const anchored = pickFirst(targetRooted.filter((c) => sameChain(c.chain, keys)));
    let categoryId = anchored?.id ?? null;
    if (categoryId === null) {
      const suffixed = chains.filter((c) => endsWith(c.chain, keys));
      if (suffixed.length === 1) categoryId = suffixed[0].category.id;
    }
    let anchorId: string | null = null;
    let missing: CategoryLevel[] = [];
    if (categoryId === null) {
      for (let depth = keys.length - 1; depth >= 1 && anchorId === null; depth--) {
        const prefix = keys.slice(0, depth);
        anchorId = pickFirst(targetRooted.filter((c) => sameChain(c.chain, prefix)))?.id ?? null;
        if (anchorId !== null) missing = rule.category.slice(depth);
      }
      if (anchorId === null) missing = rule.category;
    }
    resolutions.set(key, {
      key,
      path: rule.category,
      ruleCount: 1,
      categoryId,
      anchorId,
      missing,
    });
  }
  return [...resolutions.values()];
}

function identityOf(rule: { pattern: string; matchType: string; caseSensitive: boolean }): string {
  return JSON.stringify([rule.pattern, rule.matchType, rule.caseSensitive]);
}

export function planRulesImport(
  rules: FileRule[],
  resolutions: PathResolution[],
  existing: ExistingRule[],
  decisions: ImportDecisions,
): ImportPlan {
  const resolutionByKey = new Map(resolutions.map((r) => [r.key, r]));
  const existingByIdentity = new Map<string, ExistingRule[]>();
  for (const rule of existing) {
    const identity = identityOf(rule);
    const same = existingByIdentity.get(identity);
    if (same) same.push(rule);
    else existingByIdentity.set(identity, [rule]);
  }
  const moves = new Set(decisions.moves);
  const seen = new Set<string>();
  const undecided = new Set<string>();
  const plan: ImportPlan = {
    create: [],
    conflicts: [],
    move: [],
    identical: 0,
    duplicates: 0,
    ignored: 0,
    undecided: [],
  };

  for (const rule of rules) {
    const identity = identityOf(rule);
    if (seen.has(identity)) {
      plan.duplicates++;
      continue;
    }
    seen.add(identity);

    const pathKey = categoryPathKey(rule.category);
    const resolvedId = resolutionByKey.get(pathKey)?.categoryId ?? null;
    let effectiveId: string | null = resolvedId;
    if (resolvedId === null) {
      const decision = Object.hasOwn(decisions.categories, pathKey)
        ? decisions.categories[pathKey]
        : undefined;
      if (decision?.action === "ignore") {
        plan.ignored++;
        continue;
      }
      if (!decision) {
        undecided.add(pathKey);
        continue;
      }
      effectiveId = decision.action === "map" ? decision.categoryId : null;
    }

    const matches = existingByIdentity.get(identity);
    // Same path, other category: re-importing one's own export resolves a household path to the
    // target's same-named category, which is not a change. Only for an automatic resolution (#291).
    const isIdentical = (r: ExistingRule) =>
      r.categoryId === effectiveId || (resolvedId !== null && r.categoryPathKey === pathKey);
    if (!matches) {
      plan.create.push({ ...rule, pathKey });
    } else if (matches.some(isIdentical)) {
      plan.identical++;
    } else {
      const current = matches[0];
      plan.conflicts.push({
        ruleId: current.id,
        pattern: current.pattern,
        currentCategoryPath: current.categoryPath,
        pathKey,
      });
      if (moves.has(current.id)) plan.move.push({ ruleId: current.id, pathKey });
    }
  }
  plan.undecided = [...undecided];
  return plan;
}

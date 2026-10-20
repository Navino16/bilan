import { matchRule, pickByPriority, type Rule } from "./match";

export type PlanRow = { id: string; rawLabel: string; categoryId: string | null; manual: boolean };

export type RuleApplicationPlan = {
  matched: number;
  moveIds: string[];
  movingFromOther: number;
  alreadyInCategory: number;
  manual: number;
  keptBy: { ruleId: string; pattern: string; count: number }[];
};

// Applying a rule to the past runs the same engine as an import (spec §5.6): only the rows the
// applied rule wins move; manual rows and rows a stronger rule wins stay as they are.
export function planRuleApplication(
  applied: Rule,
  rules: Rule[],
  rows: PlanRow[],
): RuleApplicationPlan {
  const plan: RuleApplicationPlan = {
    matched: 0,
    moveIds: [],
    movingFromOther: 0,
    alreadyInCategory: 0,
    manual: 0,
    keptBy: [],
  };
  const kept = new Map<string, { ruleId: string; pattern: string; count: number }>();
  for (const row of rows) {
    if (!matchRule(applied, row.rawLabel)) continue;
    plan.matched++;
    if (row.manual) {
      plan.manual++;
      continue;
    }
    const winner = pickByPriority(rules, row.rawLabel);
    if (winner && winner.id !== applied.id) {
      const entry = kept.get(winner.id) ?? { ruleId: winner.id, pattern: winner.pattern, count: 0 };
      entry.count++;
      kept.set(winner.id, entry);
    } else if (row.categoryId === applied.categoryId) {
      plan.alreadyInCategory++;
    } else {
      plan.moveIds.push(row.id);
      if (row.categoryId !== null) plan.movingFromOther++;
    }
  }
  plan.keptBy = sortKept([...kept.values()]);
  return plan;
}

function sortKept(kept: RuleApplicationPlan["keptBy"]): RuleApplicationPlan["keptBy"] {
  return kept.sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
}

// Sums per-page plans, so the caller only holds one page of decrypted labels at a time.
export function mergePlans(plans: RuleApplicationPlan[]): RuleApplicationPlan {
  const merged: RuleApplicationPlan = {
    matched: 0,
    moveIds: [],
    movingFromOther: 0,
    alreadyInCategory: 0,
    manual: 0,
    keptBy: [],
  };
  const kept = new Map<string, { ruleId: string; pattern: string; count: number }>();
  for (const p of plans) {
    merged.matched += p.matched;
    merged.movingFromOther += p.movingFromOther;
    merged.alreadyInCategory += p.alreadyInCategory;
    merged.manual += p.manual;
    for (const id of p.moveIds) merged.moveIds.push(id);
    for (const k of p.keptBy) {
      const entry = kept.get(k.ruleId);
      if (entry) entry.count += k.count;
      else kept.set(k.ruleId, { ...k });
    }
  }
  merged.keptBy = sortKept([...kept.values()]);
  return merged;
}

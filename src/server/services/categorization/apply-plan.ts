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
  plan.keptBy = [...kept.values()].sort(
    (a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern),
  );
  return plan;
}

import { pickPrepared, prepareLabel, prepareRules, type PreparedRule, type Rule } from "./match";
import { createRegexCompiler } from "./regex";

export type PlanRow = { id: string; rawLabel: string; categoryId: string | null; manual: boolean };

export type RuleApplicationPlan = {
  matched: number;
  moves: { id: string; ruleId: string; categoryId: string }[];
  movingFromOther: number;
  alreadyInCategory: number;
  manual: number;
  keptBy: { ruleId: string; pattern: string; count: number }[];
};

export type PreparedApplication = {
  applied: PreparedRule[];
  appliedIds: Set<string>;
  rules: PreparedRule[];
};

// Prepared once per apply and reused for every page: folding and regex compilation are the
// hot path at thousands of rules (#291).
export function prepareApplication(applied: Rule[], rules: Rule[]): PreparedApplication {
  const compile = createRegexCompiler();
  return {
    applied: prepareRules(applied, compile),
    appliedIds: new Set(applied.map((r) => r.id)),
    rules: prepareRules(rules, compile),
  };
}

export function planRulesApplication(
  applied: Rule[],
  rules: Rule[],
  rows: PlanRow[],
): RuleApplicationPlan {
  return planPreparedApplication(prepareApplication(applied, rules), rows);
}

// Applying rules to the past runs the same engine as an import (spec §5.6): only the rows an
// applied rule wins move; manual rows and rows a rule outside the set wins stay as they are.
export function planPreparedApplication(
  prepared: PreparedApplication,
  rows: PlanRow[],
): RuleApplicationPlan {
  const plan: RuleApplicationPlan = {
    matched: 0,
    moves: [],
    movingFromOther: 0,
    alreadyInCategory: 0,
    manual: 0,
    keptBy: [],
  };
  const kept = new Map<string, { ruleId: string; pattern: string; count: number }>();
  for (const row of rows) {
    const label = prepareLabel(row.rawLabel);
    if (!prepared.applied.some((r) => r.test(label))) continue;
    plan.matched++;
    if (row.manual) {
      plan.manual++;
      continue;
    }
    const winner = pickPrepared(prepared.rules, label);
    if (!winner) continue;
    if (!prepared.appliedIds.has(winner.id)) {
      const entry = kept.get(winner.id) ?? { ruleId: winner.id, pattern: winner.pattern, count: 0 };
      entry.count++;
      kept.set(winner.id, entry);
    } else if (row.categoryId === winner.categoryId) {
      plan.alreadyInCategory++;
    } else {
      plan.moves.push({ id: row.id, ruleId: winner.id, categoryId: winner.categoryId });
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
    moves: [],
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
    for (const m of p.moves) merged.moves.push(m);
    for (const k of p.keptBy) {
      const entry = kept.get(k.ruleId);
      if (entry) entry.count += k.count;
      else kept.set(k.ruleId, { ...k });
    }
  }
  merged.keptBy = sortKept([...kept.values()]);
  return merged;
}

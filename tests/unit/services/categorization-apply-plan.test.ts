import { describe, it, expect } from "vitest";
import {
  mergePlans,
  planPreparedApplication,
  planRulesApplication,
  prepareApplication,
  type PlanRow,
  type RuleApplicationPlan,
} from "@/server/services/categorization/apply-plan";
import { matchRule, pickByPriority, type Rule } from "@/server/services/categorization/match";

const rule = (id: string, pattern: string, categoryId: string, priority = 100): Rule => ({
  id,
  pattern,
  categoryId,
  priority,
  matchType: "CONTAINS",
  caseSensitive: false,
});
const row = (id: string, rawLabel: string, categoryId: string | null, manual = false): PlanRow => ({
  id,
  rawLabel,
  categoryId,
  manual,
});

const prime = rule("prime", "amazon prime", "subs");
const amazon = rule("amazon", "amazon", "shops");

describe("planRulesApplication", () => {
  it("ignores rows the applied rule does not match", () => {
    const plan = planRulesApplication([prime], [prime], [row("t1", "CB LECLERC", null)]);
    expect(plan.matched).toBe(0);
    expect(plan.moves).toEqual([]);
  });

  it("never moves a manual row", () => {
    const plan = planRulesApplication([prime], [prime], [row("t1", "AMAZON PRIME", "food", true)]);
    expect(plan.manual).toBe(1);
    expect(plan.moves).toEqual([]);
  });

  it("moves an uncategorized row", () => {
    const plan = planRulesApplication([prime], [prime], [row("t1", "AMAZON PRIME", null)]);
    expect(plan.moves).toEqual([{ id: "t1", ruleId: "prime", categoryId: "subs" }]);
    expect(plan.movingFromOther).toBe(0);
  });

  it("takes a row from a more general rule", () => {
    const plan = planRulesApplication(
      [prime],
      [amazon, prime],
      [row("t1", "AMAZON PRIME FR", "shops")],
    );
    expect(plan.moves).toEqual([{ id: "t1", ruleId: "prime", categoryId: "subs" }]);
    expect(plan.movingFromOther).toBe(1);
  });

  it("leaves rows a higher-priority rule wins", () => {
    const strong = rule("strong", "amazon", "shops", 200);
    const plan = planRulesApplication([prime], [strong, prime], [row("t1", "AMAZON PRIME", null)]);
    expect(plan.moves).toEqual([]);
    expect(plan.keptBy).toEqual([{ ruleId: "strong", pattern: "amazon", count: 1 }]);
  });

  it("does not count a row already in the target category", () => {
    const plan = planRulesApplication([prime], [prime], [row("t1", "AMAZON PRIME", "subs")]);
    expect(plan.alreadyInCategory).toBe(1);
    expect(plan.moves).toEqual([]);
  });

  it("sorts keptBy by count, then pattern", () => {
    const a = rule("a", "amazon", "x", 200);
    const b = rule("b", "prime", "y", 300);
    const rows = [
      row("t1", "AMAZON PRIME", null),
      row("t2", "PRIME APP", null),
      row("t3", "AMAZON", null),
    ];
    const plan = planRulesApplication([rule("all", "a", "z")], [a, b, rule("all", "a", "z")], rows);
    expect(plan.keptBy.map((k) => [k.pattern, k.count])).toEqual([
      ["prime", 2],
      ["amazon", 1],
    ]);
  });
});

describe("planRulesApplication (batch)", () => {
  it("batch: a row won by a batch rule moves to that rule's category", () => {
    const rows = [row("t1", "AMAZON PRIME", null), row("t2", "LECLERC", null)];
    const leclerc = rule("leclerc", "leclerc", "food");
    const plan = planRulesApplication([prime, leclerc], [prime, leclerc, amazon], rows);
    expect(plan.matched).toBe(2);
    expect(plan.moves).toEqual([
      { id: "t1", ruleId: "prime", categoryId: "subs" },
      { id: "t2", ruleId: "leclerc", categoryId: "food" },
    ]);
  });

  it("batch: a row won by a non-batch rule is kept", () => {
    const strong = rule("strong", "amazon", "shops", 200);
    const plan = planRulesApplication([prime], [strong, prime], [row("t1", "AMAZON PRIME", null)]);
    expect(plan.moves).toEqual([]);
    expect(plan.keptBy).toEqual([{ ruleId: "strong", pattern: "amazon", count: 1 }]);
  });

  it("batch: a row matched by two batch rules moves once, to the stronger", () => {
    const plan = planRulesApplication(
      [prime, amazon],
      [prime, amazon],
      [row("t1", "AMAZON PRIME", null)],
    );
    expect(plan.matched).toBe(1);
    expect(plan.moves).toEqual([{ id: "t1", ruleId: "prime", categoryId: "subs" }]);
  });
});

describe("planRulesApplication (prepared matching)", () => {
  // The planner as it was before rules were prepared: matchRule + pickByPriority per row.
  function reference(applied: Rule[], rules: Rule[], rows: PlanRow[]) {
    const appliedIds = new Set(applied.map((r) => r.id));
    const plan = { matched: 0, moves: [] as RuleApplicationPlan["moves"], manual: 0, kept: 0 };
    for (const r of rows) {
      if (!applied.some((a) => matchRule(a, r.rawLabel))) continue;
      plan.matched++;
      if (r.manual) {
        plan.manual++;
        continue;
      }
      const winner = pickByPriority(rules, r.rawLabel);
      if (!winner) continue;
      if (!appliedIds.has(winner.id)) plan.kept++;
      else if (r.categoryId !== winner.categoryId) {
        plan.moves.push({ id: r.id, ruleId: winner.id, categoryId: winner.categoryId });
      }
    }
    return plan;
  }

  it("plans exactly like matchRule + pickByPriority over mixed rules", () => {
    const types = ["EXACT", "STARTS_WITH", "CONTAINS", "REGEX"] as const;
    const patterns = ["amazon", "AMAZON PRIME", "Crème", "^cb ", "prime$", " leclerc", "(", "é"];
    const rules: Rule[] = patterns.flatMap((pattern, p) =>
      types.flatMap((matchType, t) =>
        [true, false].map((caseSensitive) => ({
          id: `r${p}${t}${caseSensitive ? "s" : "i"}`,
          categoryId: `c${(p + t) % 3}`,
          pattern,
          matchType,
          caseSensitive,
          priority: [100, 100, 200][(p * t) % 3],
          createdAt: p % 2,
        })),
      ),
    );
    const labels = [
      "AMAZON PRIME",
      "cb amazon",
      "CREME brûlée",
      "Crème",
      " LECLERC",
      "x prime",
      "é",
    ];
    const rows = labels.flatMap((l, i) => [
      row(`t${i}a`, l, null),
      row(`t${i}b`, l, "c1"),
      row(`t${i}c`, l, "c2", true),
    ]);
    for (const applied of [rules.slice(0, 20), rules.filter((_, i) => i % 3 === 0), rules]) {
      const plan = planRulesApplication(applied, rules, rows);
      const ref = reference(applied, rules, rows);
      expect(plan.matched).toBe(ref.matched);
      expect(plan.manual).toBe(ref.manual);
      expect(plan.moves).toEqual(ref.moves);
      expect(plan.keptBy.reduce((n, k) => n + k.count, 0)).toBe(ref.kept);
    }
  });

  it("a prepared application plans every page like the unprepared planner", () => {
    const rows = [row("t1", "AMAZON PRIME", null), row("t2", "AMAZON", "food")];
    const prepared = prepareApplication([amazon], [prime, amazon]);
    expect(planPreparedApplication(prepared, rows)).toEqual(
      planRulesApplication([amazon], [prime, amazon], rows),
    );
  });

  it("plans a batch of more REGEX rules than the global regex cache holds", () => {
    const rules: Rule[] = Array.from({ length: 600 }, (_, i) => ({
      id: `re${i}`,
      categoryId: `c${i}`,
      pattern: `^ref-${i}$`,
      matchType: "REGEX",
      caseSensitive: false,
    }));
    const rows = rules.map((_, i) => row(`t${i}`, `REF-${i}`, null));
    const plan = planRulesApplication(rules, rules, rows);
    expect(plan.matched).toBe(600);
    expect(plan.moves).toEqual(
      rows.map((_, i) => ({ id: `t${i}`, ruleId: `re${i}`, categoryId: `c${i}` })),
    );
  });
});

describe("mergePlans", () => {
  it("matches planning every row at once", () => {
    const rules = [prime, amazon];
    const rows = [
      row("t1", "AMAZON PRIME", null),
      row("t2", "AMAZON PRIME", "food"),
      row("t3", "AMAZON PRIME", "subs"),
      row("t4", "AMAZON PRIME", "food", true),
      row("t5", "AMAZON", null),
    ];
    const whole = planRulesApplication([amazon], rules, rows);
    const paged = mergePlans([
      planRulesApplication([amazon], rules, rows.slice(0, 2)),
      planRulesApplication([amazon], rules, rows.slice(2)),
    ]);
    expect(paged).toEqual(whole);
  });

  it("returns an empty plan for no pages", () => {
    expect(mergePlans([])).toEqual({
      matched: 0,
      moves: [],
      movingFromOther: 0,
      alreadyInCategory: 0,
      manual: 0,
      keptBy: [],
    });
  });
});

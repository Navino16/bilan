import { describe, it, expect } from "vitest";
import { planRuleApplication, type PlanRow } from "@/server/services/categorization/apply-plan";
import type { Rule } from "@/server/services/categorization/match";

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

describe("planRuleApplication", () => {
  it("ignores rows the applied rule does not match", () => {
    const plan = planRuleApplication(prime, [prime], [row("t1", "CB LECLERC", null)]);
    expect(plan.matched).toBe(0);
    expect(plan.moveIds).toEqual([]);
  });

  it("never moves a manual row", () => {
    const plan = planRuleApplication(prime, [prime], [row("t1", "AMAZON PRIME", "food", true)]);
    expect(plan.manual).toBe(1);
    expect(plan.moveIds).toEqual([]);
  });

  it("moves an uncategorized row", () => {
    const plan = planRuleApplication(prime, [prime], [row("t1", "AMAZON PRIME", null)]);
    expect(plan.moveIds).toEqual(["t1"]);
    expect(plan.movingFromOther).toBe(0);
  });

  it("takes a row from a more general rule", () => {
    const plan = planRuleApplication(
      prime,
      [amazon, prime],
      [row("t1", "AMAZON PRIME FR", "shops")],
    );
    expect(plan.moveIds).toEqual(["t1"]);
    expect(plan.movingFromOther).toBe(1);
  });

  it("leaves rows a higher-priority rule wins", () => {
    const strong = rule("strong", "amazon", "shops", 200);
    const plan = planRuleApplication(prime, [strong, prime], [row("t1", "AMAZON PRIME", null)]);
    expect(plan.moveIds).toEqual([]);
    expect(plan.keptBy).toEqual([{ ruleId: "strong", pattern: "amazon", count: 1 }]);
  });

  it("does not count a row already in the target category", () => {
    const plan = planRuleApplication(prime, [prime], [row("t1", "AMAZON PRIME", "subs")]);
    expect(plan.alreadyInCategory).toBe(1);
    expect(plan.moveIds).toEqual([]);
  });

  it("sorts keptBy by count, then pattern", () => {
    const a = rule("a", "amazon", "x", 200);
    const b = rule("b", "prime", "y", 300);
    const rows = [
      row("t1", "AMAZON PRIME", null),
      row("t2", "PRIME APP", null),
      row("t3", "AMAZON", null),
    ];
    const plan = planRuleApplication(rule("all", "a", "z"), [a, b, rule("all", "a", "z")], rows);
    expect(plan.keptBy.map((k) => [k.pattern, k.count])).toEqual([
      ["prime", 2],
      ["amazon", 1],
    ]);
  });
});

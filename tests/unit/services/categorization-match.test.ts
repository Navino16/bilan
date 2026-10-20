import { describe, it, expect } from "vitest";
import {
  matchRule,
  pickByPriority,
  proposeRule,
  type Rule,
} from "@/server/services/categorization/match";

const base = { id: "r", categoryId: "c", caseSensitive: false } as const;

describe("matchRule", () => {
  it("CONTAINS is case-insensitive by default", () => {
    expect(
      matchRule({ ...base, matchType: "CONTAINS", pattern: "carrefour" }, "CB CARREFOUR CITY"),
    ).toBe(true);
    expect(
      matchRule({ ...base, matchType: "CONTAINS", pattern: "leclerc" }, "CB CARREFOUR CITY"),
    ).toBe(false);
  });

  it("EXACT matches the whole normalized string", () => {
    expect(matchRule({ ...base, matchType: "EXACT", pattern: "loyer" }, "Loyer")).toBe(true);
    expect(matchRule({ ...base, matchType: "EXACT", pattern: "loyer" }, "Loyer mai")).toBe(false);
  });

  it("STARTS_WITH matches a prefix", () => {
    expect(
      matchRule({ ...base, matchType: "STARTS_WITH", pattern: "vir" }, "VIR SEPA SALAIRE"),
    ).toBe(true);
    expect(
      matchRule({ ...base, matchType: "STARTS_WITH", pattern: "sepa" }, "VIR SEPA SALAIRE"),
    ).toBe(false);
  });

  it("REGEX matches the source pattern", () => {
    expect(
      matchRule({ ...base, matchType: "REGEX", pattern: "carrefour|leclerc" }, "ticket leclerc"),
    ).toBe(true);
    expect(matchRule({ ...base, matchType: "REGEX", pattern: "^uber" }, "UBER EATS")).toBe(true);
  });

  it("caseSensitive=true respects case", () => {
    expect(
      matchRule(
        { ...base, caseSensitive: true, matchType: "CONTAINS", pattern: "Carrefour" },
        "carrefour",
      ),
    ).toBe(false);
  });

  it("an invalid regex never throws and returns false", () => {
    expect(matchRule({ ...base, matchType: "REGEX", pattern: "(" }, "anything")).toBe(false);
  });

  it("runs catastrophic-backtracking patterns in linear time (no ReDoS)", () => {
    const label = `${"a".repeat(5_000)}!`;
    const started = performance.now();
    for (const pattern of ["(a+)+$", "(a|aa)+$", "(a*)*b"]) {
      expect(matchRule({ ...base, matchType: "REGEX", pattern }, label)).toBe(false);
    }
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("REGEX honours caseSensitive", () => {
    const rule = { ...base, matchType: "REGEX" as const, pattern: "^Uber" };
    expect(matchRule({ ...rule, caseSensitive: true }, "uber eats")).toBe(false);
    expect(matchRule({ ...rule, caseSensitive: true }, "Uber eats")).toBe(true);
  });

  it("case-insensitive rules ignore accents on both sides (#161)", () => {
    for (const matchType of ["CONTAINS", "STARTS_WITH", "EXACT"] as const) {
      expect(matchRule({ ...base, matchType, pattern: "creme" }, "Crème")).toBe(true);
      expect(matchRule({ ...base, matchType, pattern: "Crème" }, "CREME")).toBe(true);
    }
    expect(
      matchRule({ ...base, matchType: "CONTAINS", pattern: "epicerie" }, "CB ÉPICERIE DU COIN"),
    ).toBe(true);
  });

  it("case-sensitive rules keep accents significant", () => {
    const rule = { ...base, caseSensitive: true, matchType: "CONTAINS" as const };
    expect(matchRule({ ...rule, pattern: "Creme" }, "Crème brûlée")).toBe(false);
    expect(matchRule({ ...rule, pattern: "Crème" }, "Crème brûlée")).toBe(true);
  });

  it("a rule proposed from an accented label matches that label", () => {
    const proposed = proposeRule("Crème")!;
    expect(proposed.pattern).toBe("creme");
    expect(matchRule({ ...base, ...proposed }, "Crème")).toBe(true);
  });
});

describe("pickByPriority", () => {
  it("returns the highest-priority matching rule", () => {
    const rules: Rule[] = [
      { ...base, id: "low", matchType: "CONTAINS", pattern: "city", priority: 10, categoryId: "A" },
      {
        ...base,
        id: "high",
        matchType: "CONTAINS",
        pattern: "carrefour",
        priority: 200,
        categoryId: "B",
      },
    ];
    expect(pickByPriority(rules, "CARREFOUR CITY")?.id).toBe("high");
  });

  it("returns null when nothing matches", () => {
    expect(
      pickByPriority([{ ...base, matchType: "EXACT", pattern: "x", priority: 1 }], "y"),
    ).toBeNull();
  });
});

describe("pickByPriority tie-break", () => {
  const rule = (id: string, pattern: string, priority = 100, createdAt = 0): Rule => ({
    ...base,
    id,
    matchType: "CONTAINS",
    pattern,
    priority,
    createdAt,
  });

  it("prefers the longer pattern at equal priority", () => {
    const general = rule("general", "amazon");
    const specific = rule("specific", "amazon prime");
    expect(pickByPriority([general, specific], "PRLV AMAZON PRIME FR")?.id).toBe("specific");
    expect(pickByPriority([specific, general], "PRLV AMAZON PRIME FR")?.id).toBe("specific");
  });

  it("prefers the newer rule at equal priority and length", () => {
    const older = rule("older", "netflix", 100, 1000);
    const newer = rule("newer", "NETFLIX", 100, 2000);
    expect(pickByPriority([older, newer], "NETFLIX.COM")?.id).toBe("newer");
    expect(pickByPriority([newer, older], "NETFLIX.COM")?.id).toBe("newer");
  });

  it("priority still wins over length", () => {
    const general = rule("general", "amazon", 200);
    const specific = rule("specific", "amazon prime", 100);
    expect(pickByPriority([specific, general], "PRLV AMAZON PRIME FR")?.id).toBe("general");
  });

  it("falls back to the id when priority, length and creation time are equal", () => {
    const a = rule("rule-a", "netflix", 100, 5);
    const b = rule("rule-b", "netflix", 100, 5);
    expect(pickByPriority([a, b], "NETFLIX.COM")?.id).toBe("rule-a");
    expect(pickByPriority([b, a], "NETFLIX.COM")?.id).toBe("rule-a");
  });
});

describe("proposeRule", () => {
  it("proposes the longest distinctive token as a CONTAINS pattern", () => {
    expect(proposeRule("CB CARREFOUR CITY PARIS")).toEqual({
      pattern: "carrefour",
      matchType: "CONTAINS",
    });
  });
  it("returns null when there is no token ≥ 3 chars", () => {
    expect(proposeRule("a b cd")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  matchRule,
  pickByPriority,
  pickPrepared,
  prepareLabel,
  prepareRules,
  proposeRule,
  type Rule,
} from "@/server/services/categorization/match";
import type { RuleMatchType } from "@/lib/validation/rule";

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

describe("prepareRules / pickPrepared", () => {
  const MATCH_TYPES: RuleMatchType[] = ["EXACT", "STARTS_WITH", "CONTAINS", "REGEX"];
  const PATTERNS = [
    "ab",
    "Ab",
    "a",
    "é",
    "E",
    " ab ",
    "b",
    "ab|é",
    "^a",
    "(",
    "a.",
    "B$",
    "",
    "\\bab\\b",
    "^\\s*ab$",
  ];
  const LABELS = ["ab", "AB", " ab", "abé", "É", "e", "ba", "a b", "Ab ", "", "xyz", "éAB", "b"];

  // Deterministic generator: few patterns, priorities and timestamps, so ties are frequent.
  function mixedRules(count: number, seed: number): Rule[] {
    let state = seed;
    const next = (n: number) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % n;
    };
    return Array.from({ length: count }, (_, i) => ({
      id: `r${next(count)}-${i}`,
      categoryId: `c${i}`,
      pattern: PATTERNS[next(PATTERNS.length)],
      matchType: MATCH_TYPES[next(MATCH_TYPES.length)],
      caseSensitive: next(2) === 0,
      ...(next(4) === 0 ? {} : { priority: [50, 100, 200][next(3)] }),
      ...(next(4) === 0 ? {} : { createdAt: next(3) }),
    }));
  }

  it("gives the same winner as pickByPriority over a mixed rule set, whatever the input order", () => {
    for (const seed of [1, 7, 42, 2026]) {
      const rules = mixedRules(60, seed);
      for (const order of [
        rules,
        [...rules].reverse(),
        [...rules.slice(30), ...rules.slice(0, 30)],
      ]) {
        const prepared = prepareRules(order);
        for (const label of LABELS) {
          expect(pickPrepared(prepared, prepareLabel(label))).toBe(pickByPriority(order, label));
        }
      }
    }
  });

  it("each prepared rule matches exactly like matchRule", () => {
    const rules = PATTERNS.flatMap((pattern) =>
      MATCH_TYPES.flatMap((matchType) =>
        [true, false].map((caseSensitive) => ({ ...base, pattern, matchType, caseSensitive })),
      ),
    );
    const prepared = prepareRules(rules);
    for (const label of LABELS) {
      const prep = prepareLabel(label);
      for (const p of prepared) expect(p.test(prep)).toBe(matchRule(p.rule, label));
    }
  });

  it("keeps the input order among rules equal for compareRules, like pickByPriority", () => {
    const twin = { ...base, matchType: "CONTAINS" as const, pattern: "x", priority: 1 };
    const first = { ...twin, categoryId: "first" };
    const second = { ...twin, categoryId: "second" };
    expect(pickPrepared(prepareRules([first, second]), prepareLabel("x"))).toBe(first);
    expect(pickByPriority([first, second], "x")).toBe(first);
  });

  it("handles more REGEX rules than the global regex cache holds", () => {
    const rules: Rule[] = Array.from({ length: 700 }, (_, i) => ({
      ...base,
      id: `re${i}`,
      categoryId: `c${i}`,
      matchType: "REGEX",
      pattern: `^ref-${i}$`,
      caseSensitive: i % 2 === 0,
    }));
    const prepared = prepareRules(rules);
    for (let i = 0; i < 700; i++) {
      const label = i % 2 === 0 ? `ref-${i}` : `REF-${i}`;
      expect(pickPrepared(prepared, prepareLabel(label))?.id).toBe(`re${i}`);
    }
    expect(pickPrepared(prepared, prepareLabel("REF-0"))).toBeNull();
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

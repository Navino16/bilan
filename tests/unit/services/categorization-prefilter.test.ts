import { describe, it, expect } from "vitest";
import { searchPrefixes } from "@/lib/text";
import { matchRule, type Rule } from "@/server/services/categorization/match";
import { ruleIndexTerm } from "@/server/services/categorization/prefilter";
import type { RuleMatchType } from "@/lib/validation/rule";

const rule = (pattern: string, matchType: RuleMatchType, caseSensitive = false): Rule => ({
  id: "r",
  categoryId: "c",
  pattern,
  matchType,
  caseSensitive,
});

describe("ruleIndexTerm (#302)", () => {
  it("takes the longest anchored word of the pattern", () => {
    expect(ruleIndexTerm(rule("CB CARREFOUR MARKET", "CONTAINS"))).toBe("carrefour");
    expect(ruleIndexTerm(rule("Crème brûlée", "EXACT"))).toBe("brulee");
    expect(ruleIndexTerm(rule("PRLV SEPA", "STARTS_WITH"))).toBe("prlv");
    expect(ruleIndexTerm(rule("internationalisation", "EXACT"))).toBe("internationa");
  });

  it("never anchors a CONTAINS pattern's first word unless a separator opens it", () => {
    expect(ruleIndexTerm(rule("carrefour", "CONTAINS"))).toBeNull();
    expect(ruleIndexTerm(rule("carrefour ab", "CONTAINS"))).toBeNull();
    expect(ruleIndexTerm(rule(" carrefour", "CONTAINS"))).toBe("carrefour");
  });

  it("gives up on REGEX rules and on words too short to be indexed", () => {
    expect(ruleIndexTerm(rule("^CARREFOUR", "REGEX"))).toBeNull();
    expect(ruleIndexTerm(rule("AB CD", "EXACT"))).toBeNull();
  });

  // Every label a rule matches carries the rule's term among its search tokens.
  it("is a search token of every label the rule matches", () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const pieces = [
      "car",
      "Carre",
      "FOUR",
      "é",
      "É",
      " ",
      "  ",
      "*",
      "-",
      "x",
      "Market",
      "1",
      "ß",
      "İ",
    ];
    const text = (n: number) =>
      Array.from({ length: n }, () => pieces[rand(pieces.length)]).join("");
    const types: RuleMatchType[] = ["CONTAINS", "EXACT", "STARTS_WITH"];
    let checked = 0;
    for (let i = 0; i < 20000; i++) {
      const label = text(1 + rand(8));
      const start = rand(label.length);
      const pattern =
        rand(3) === 0 ? text(1 + rand(4)) : label.slice(start, start + 1 + rand(label.length));
      const r = rule(pattern, types[rand(3)], rand(4) === 0);
      const term = ruleIndexTerm(r);
      if (!term || !matchRule(r, label)) continue;
      checked++;
      expect(searchPrefixes(label)).toContain(term);
    }
    expect(checked).toBeGreaterThan(500);
  });
});

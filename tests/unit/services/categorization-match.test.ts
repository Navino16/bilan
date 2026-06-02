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

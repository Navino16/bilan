import { describe, expect, it } from "vitest";
import {
  categoryPathKey,
  planRulesImport,
  resolveCategoryPaths,
  type ExistingRule,
  type ImportCategory,
  type ImportDecisions,
} from "@/lib/rules-import";
import type { FileRule } from "@/lib/validation/rules-file";

const rule = (pattern: string, names: string[], over: Partial<FileRule> = {}): FileRule => ({
  pattern,
  matchType: "CONTAINS",
  caseSensitive: false,
  priority: 0,
  enabled: true,
  category: names.map((name) => ({ name })),
  ...over,
});

const cat = (
  id: string,
  name: string,
  parentId: string | null,
  inTarget = true,
): ImportCategory => ({ id, name, parentId, inTarget });

const noDecisions: ImportDecisions = { categories: {}, moves: [] };

describe("resolveCategoryPaths", () => {
  it("resolves an anchored path in the target scope", () => {
    const categories = [cat("a", "Food", null), cat("b", "Groceries", "a")];
    const [res] = resolveCategoryPaths([rule("lidl", ["Food", "Groceries"])], categories);
    expect(res.categoryId).toBe("b");
    expect(res.missing).toEqual([]);
  });

  it("folds case, accents and whitespace", () => {
    const categories = [cat("a", "Café & snacks", null)];
    const [res] = resolveCategoryPaths([rule("x", ["cafe  & SNACKS"])], categories);
    expect(res.categoryId).toBe("a");
  });

  it("falls back to a unique category outside the target scope", () => {
    const categories = [
      cat("h1", "Alimentation", null, false),
      cat("h2", "Courses", "h1", false),
      cat("p1", "Loisirs", null),
    ];
    const [res] = resolveCategoryPaths([rule("x", ["Alimentation", "Courses"])], categories);
    expect(res.categoryId).toBe("h2");
  });

  it("stays unresolved when the fallback is ambiguous", () => {
    const categories = [
      cat("h1", "Alimentation", null, false),
      cat("h2", "Courses", "h1", false),
      cat("g1", "Alimentation", null, false),
      cat("g2", "Courses", "g1", false),
    ];
    const [res] = resolveCategoryPaths([rule("x", ["Alimentation", "Courses"])], categories);
    expect(res.categoryId).toBeNull();
    expect(res.anchorId).toBeNull();
    expect(res.missing.map((l) => l.name)).toEqual(["Alimentation", "Courses"]);
  });

  it("a single-level path resolves by suffix", () => {
    const categories = [cat("h1", "Alimentation", null, false), cat("h2", "Courses", "h1", false)];
    const [res] = resolveCategoryPaths([rule("x", ["Courses"])], categories);
    expect(res.categoryId).toBe("h2");
  });

  it("anchorId/missing point at the deepest existing target ancestor", () => {
    const categories = [cat("a", "Food", null), cat("b", "Groceries", "a")];
    const [res] = resolveCategoryPaths(
      [rule("x", ["Food", "Groceries", "Bio", "Fruit"])],
      categories,
    );
    expect(res.categoryId).toBeNull();
    expect(res.anchorId).toBe("b");
    expect(res.missing.map((l) => l.name)).toEqual(["Bio", "Fruit"]);
  });

  it("same-name siblings resolve deterministically", () => {
    const categories = [cat("z", "food", null), cat("y", "Food", null), cat("x", "Food", null)];
    const [res] = resolveCategoryPaths([rule("x", ["FOOD"])], categories);
    expect(res.categoryId).toBe("z");
    const [reversed] = resolveCategoryPaths([rule("x", ["FOOD"])], [...categories].reverse());
    expect(reversed.categoryId).toBe("z");
    const ties = [cat("y", "Food", null), cat("x", "Food", null)];
    expect(resolveCategoryPaths([rule("x", ["FOOD"])], ties)[0].categoryId).toBe("x");
  });

  it("keeps the first path and counts every rule using the key", () => {
    const res = resolveCategoryPaths(
      [rule("a", ["Food"]), rule("b", ["FOOD"]), rule("c", ["Other"])],
      [],
    );
    expect(res.map((r) => [r.key, r.ruleCount, r.path[0].name])).toEqual([
      ["food", 2, "Food"],
      ["other", 1, "Other"],
    ]);
  });
});

describe("planRulesImport", () => {
  const categories = [cat("a", "Food", null), cat("b", "Transport", null)];
  const existingRule = (over: Partial<ExistingRule> = {}): ExistingRule => ({
    id: "r1",
    pattern: "lidl",
    matchType: "CONTAINS",
    caseSensitive: false,
    categoryId: "a",
    categoryPath: ["Food"],
    categoryPathKey: "food",
    ...over,
  });
  const plan = (rules: FileRule[], existing: ExistingRule[], decisions = noDecisions) =>
    planRulesImport(rules, resolveCategoryPaths(rules, categories), existing, decisions);

  it("identical existing rule is skipped", () => {
    const p = plan([rule("lidl", ["Food"])], [existingRule()]);
    expect(p.identical).toBe(1);
    expect(p.create).toEqual([]);
    expect(p.conflicts).toEqual([]);
  });

  it("different category is a conflict, moved only when its id is in decisions.moves", () => {
    const rules = [rule("lidl", ["Transport"])];
    const kept = plan(rules, [existingRule()]);
    expect(kept.conflicts).toEqual([
      { ruleId: "r1", pattern: "lidl", currentCategoryPath: ["Food"], pathKey: "transport" },
    ]);
    expect(kept.move).toEqual([]);
    expect(kept.create).toEqual([]);
    const moved = plan(rules, [existingRule()], { categories: {}, moves: ["r1"] });
    expect(moved.move).toEqual([{ ruleId: "r1", pathKey: "transport" }]);
    expect(moved.create).toEqual([]);
  });

  it("an existing rule on another category with the same path is identical, not a conflict", () => {
    const elsewhere = existingRule({ categoryId: "household-food", categoryPath: ["FOOD"] });
    const p = plan([rule("lidl", ["Food"])], [elsewhere]);
    expect(p.identical).toBe(1);
    expect(p.conflicts).toEqual([]);
    const nested = existingRule({
      categoryId: "x",
      categoryPath: ["Home", "Food"],
      categoryPathKey: "home\u001ffood",
    });
    expect(plan([rule("lidl", ["Food"])], [nested]).conflicts).toEqual([
      { ruleId: "r1", pattern: "lidl", currentCategoryPath: ["Home", "Food"], pathKey: "food" },
    ]);
  });

  it("map onto the existing rule's category makes it identical", () => {
    const rules = [rule("lidl", ["Unknown"])];
    const p = plan(rules, [existingRule()], {
      categories: { unknown: { action: "map", categoryId: "a" } },
      moves: [],
    });
    expect(p.identical).toBe(1);
    expect(p.conflicts).toEqual([]);
  });

  it("create always conflicts with an existing same-identity rule", () => {
    const rules = [rule("lidl", ["Food", "New"])];
    const p = plan(rules, [existingRule()], {
      categories: { [categoryPathKey(rules[0].category)]: { action: "create" } },
      moves: [],
    });
    expect(p.identical).toBe(0);
    expect(p.conflicts).toHaveLength(1);
    expect(p.create).toEqual([]);
  });

  it("ignore drops the path's rules", () => {
    const p = plan([rule("a", ["Unknown"]), rule("b", ["Unknown"])], [], {
      categories: { unknown: { action: "ignore" } },
      moves: [],
    });
    expect(p.ignored).toBe(2);
    expect(p.create).toEqual([]);
    expect(p.undecided).toEqual([]);
  });

  it("undecided lists unresolved paths without a decision, once per key", () => {
    const p = plan([rule("a", ["Unknown"]), rule("b", ["UNKNOWN"]), rule("c", ["Food"])], []);
    expect(p.undecided).toEqual(["unknown"]);
    expect(p.create.map((r) => r.pattern)).toEqual(["c"]);
  });

  it("inherited object keys are not decisions", () => {
    const p = plan([rule("a", ["Constructor"]), rule("b", ["__proto__"])], []);
    expect(p.undecided).toEqual(["constructor", "__proto__"]);
    expect(p.create).toEqual([]);
  });

  it("later duplicates in the file are counted, the first wins", () => {
    const p = plan([rule("lidl", ["Food"]), rule("lidl", ["Transport"])], []);
    expect(p.duplicates).toBe(1);
    expect(p.create).toHaveLength(1);
    expect(p.create[0]).toMatchObject({ pattern: "lidl", pathKey: "food" });
  });

  it("ignores a decision for a path that resolved automatically", () => {
    const p = plan([rule("lidl", ["Food"])], [], {
      categories: { food: { action: "ignore" } },
      moves: [],
    });
    expect(p.ignored).toBe(0);
    expect(p.create).toHaveLength(1);
  });
});

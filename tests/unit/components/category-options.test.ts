import { describe, it, expect } from "vitest";
import { categoryOptions, pickableCategories } from "@/components/categories/category-options";

type Node = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  groupId: string | null;
  savings?: boolean;
  neutral?: boolean;
  children: Node[];
};

const node = (
  id: string,
  extra: { color?: string; groupId?: string; parentId?: string } = {},
  children: Node[] = [],
): Node => ({
  id,
  name: id,
  color: extra.color ?? null,
  parentId: extra.parentId ?? null,
  groupId: extra.groupId ?? null,
  children,
});

const tree = [
  node("a", { color: "#111111" }, [
    node("a1", { parentId: "a" }, [node("a11", { parentId: "a1" })]),
    node("a2", { parentId: "a", color: "#222222" }),
  ]),
  node("b"),
  node("g", { groupId: "grp" }),
];

describe("categoryOptions", () => {
  it("flattens depth-first with inherited colours", () => {
    expect(categoryOptions(tree).map((c) => [c.id, c.depth, c.color])).toEqual([
      ["a", 0, "#111111"],
      ["a1", 1, "#111111"],
      ["a11", 2, "#111111"],
      ["a2", 1, "#222222"],
      ["b", 0, null],
      ["g", 0, null],
    ]);
  });

  it("tags each option with its root-first ancestor names", () => {
    expect(categoryOptions(tree).map((c) => [c.id, c.parents])).toEqual([
      ["a", []],
      ["a1", ["a"]],
      ["a11", ["a", "a1"]],
      ["a2", ["a"]],
      ["b", []],
      ["g", []],
    ]);
  });
});

describe("categoryOptions flags", () => {
  it("names the nearest self-or-ancestor carrying each flag", () => {
    const flagged = [
      { ...node("s", {}, [{ ...node("s1", { parentId: "s" }), neutral: true }]), savings: true },
      { ...node("n", {}, [node("n1", { parentId: "n" })]), neutral: true },
    ];
    expect(categoryOptions(flagged).map((c) => [c.id, c.savingsFrom, c.neutralFrom])).toEqual([
      ["s", "s", null],
      ["s1", "s", "s1"],
      ["n", null, "n"],
      ["n1", null, "n"],
    ]);
  });
});

describe("pickableCategories", () => {
  const all = categoryOptions(tree);

  it("lists every depth of the same scope", () => {
    expect(pickableCategories(all, null).map((c) => c.id)).toEqual(["a", "a1", "a11", "a2", "b"]);
    expect(pickableCategories(all, "grp").map((c) => c.id)).toEqual(["g"]);
  });

  it("excludes the category and its descendants", () => {
    expect(pickableCategories(all, null, "a1").map((c) => c.id)).toEqual(["a", "a2", "b"]);
    expect(pickableCategories(all, null, "a").map((c) => c.id)).toEqual(["b"]);
  });
});

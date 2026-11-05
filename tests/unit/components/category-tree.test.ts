import { describe, it, expect } from "vitest";
import {
  categoryIndex,
  categoryPath,
  categoryPathLabel,
  flattenCategories,
} from "@/components/transactions/category-tree";

type Node = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  children: Node[];
};
const node = (id: string, children: Node[] = [], icon: string | null = null): Node => ({
  id,
  name: id.toUpperCase(),
  color: null,
  icon,
  children,
});

const flat = flattenCategories([
  node("a", [node("a1", [node("a11")], "🍎"), node("a2")], "🅰️"),
  node("b", [node("b1")]),
]);

describe("flattenCategories", () => {
  it("tags each category with its root-first ancestor names", () => {
    expect(flat.map((c) => [c.id, c.parents])).toEqual([
      ["a", []],
      ["a1", ["A"]],
      ["a11", ["A", "A1"]],
      ["a2", ["A"]],
      ["b", []],
      ["b1", ["B"]],
    ]);
  });

  it("inherits the nearest ancestor's emoji when a category has none", () => {
    expect(flat.map((c) => [c.id, c.icon])).toEqual([
      ["a", "🅰️"],
      ["a1", "🍎"],
      ["a11", "🍎"],
      ["a2", "🅰️"],
      ["b", null],
      ["b1", null],
    ]);
  });
});

describe("categoryPath", () => {
  it("joins the path root first and gives a root its own name", () => {
    const index = categoryIndex(flat);
    expect(categoryPath(index.a11)).toBe("A › A1 › A11");
    expect(categoryPath(index.a2)).toBe("A › A2");
    expect(categoryPath(index.b)).toBe("B");
    expect(categoryPath({ name: "Loose" })).toBe("Loose");
  });
});

describe("categoryPathLabel", () => {
  it("resolves an id to its path and null for an unknown id", () => {
    expect(categoryPathLabel(flat, "b1")).toBe("B › B1");
    expect(categoryPathLabel(flat, "missing")).toBeNull();
  });
});

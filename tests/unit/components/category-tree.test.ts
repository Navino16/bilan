import { describe, it, expect } from "vitest";
import { categoryPathLabel, flattenCategories } from "@/components/transactions/category-tree";

type Node = {
  id: string;
  name: string;
  color: null;
  icon: null;
  children: Node[];
};
const node = (id: string, children: Node[] = []): Node => ({
  id,
  name: id.toUpperCase(),
  color: null,
  icon: null,
  children,
});

describe("categoryPathLabel", () => {
  const flat = flattenCategories([
    node("a", [node("a1", [node("a11")]), node("a2")]),
    node("b", [node("b1")]),
  ]);

  it("joins the root-first path of a nested category", () => {
    expect(categoryPathLabel(flat, "a11")).toBe("A > A1 > A11");
    expect(categoryPathLabel(flat, "a2")).toBe("A > A2");
    expect(categoryPathLabel(flat, "b1")).toBe("B > B1");
  });

  it("gives a root's own name and null for an unknown id", () => {
    expect(categoryPathLabel(flat, "b")).toBe("B");
    expect(categoryPathLabel(flat, "missing")).toBeNull();
  });
});

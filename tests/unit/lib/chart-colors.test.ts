import { describe, it, expect } from "vitest";
import { categorySliceColors, shade, UNCATEGORIZED_COLOR } from "@/lib/chart-colors";

const cats = new Map([
  ["home", { color: "#2563eb", rootId: "home" }],
  ["rent", { color: "#2563eb", rootId: "home" }],
  ["power", { color: "#2563eb", rootId: "home" }],
  ["food", { color: "#f59e0b", rootId: "food" }],
  ["bare", { color: null, rootId: "bare" }],
]);

describe("shade", () => {
  it("lightens towards white and darkens towards black", () => {
    expect(shade("#000000", 0.5)).toBe("#808080");
    expect(shade("#ffffff", -0.5)).toBe("#808080");
    expect(shade("#2563eb", 0)).toBe("#2563eb");
  });

  it("leaves non-hex colors untouched", () => {
    expect(shade("var(--x)", 0.4)).toBe("var(--x)");
  });
});

describe("categorySliceColors", () => {
  it("gives siblings distinct shades of their root color, in slice order", () => {
    const colors = categorySliceColors(
      [{ categoryId: "rent" }, { categoryId: "food" }, { categoryId: "power" }],
      cats,
      "#fallback",
    );
    expect(colors[0]).toBe("#2563eb");
    expect(colors[1]).toBe("#f59e0b");
    expect(colors[2]).not.toBe("#2563eb");
    expect(colors[2]).toBe(shade("#2563eb", 0.4));
  });

  it("paints uncategorized spending neutral grey", () => {
    expect(categorySliceColors([{ categoryId: null }], cats, "#fallback")).toEqual([
      UNCATEGORIZED_COLOR,
    ]);
  });

  it("falls back for unknown or colorless categories", () => {
    expect(
      categorySliceColors([{ categoryId: "ghost" }, { categoryId: "bare" }], cats, "#fallback"),
    ).toEqual(["#fallback", "#fallback"]);
  });
});

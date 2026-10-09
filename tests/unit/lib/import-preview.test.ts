import { describe, it, expect } from "vitest";
import { previewCategoryId } from "@/lib/import-preview";

const row = { externalId: "x1", suggestedCategoryId: "rule-cat" };

describe("previewCategoryId (#225)", () => {
  it("shows the rule suggestion while auto-categorize is on", () => {
    expect(previewCategoryId(row, {}, true)).toBe("rule-cat");
  });

  it("drops the rule suggestion when auto-categorize is off", () => {
    expect(previewCategoryId(row, {}, false)).toBe("");
  });

  it("keeps a per-row pick either way, including an explicit Sans catégorie", () => {
    expect(previewCategoryId(row, { x1: "picked" }, false)).toBe("picked");
    expect(previewCategoryId(row, { x1: "" }, true)).toBe("");
  });

  it("falls back to Sans catégorie when no rule matched", () => {
    expect(previewCategoryId({ externalId: "x2", suggestedCategoryId: null }, {}, true)).toBe("");
  });
});

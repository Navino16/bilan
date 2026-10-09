import { describe, it, expect } from "vitest";
import categoriesFr from "../../../prisma/seed-data/categories-fr.json";
import categoriesEn from "../../../prisma/seed-data/categories-en.json";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";
import {
  CATEGORY_PALETTE,
  CATEGORY_SYMBOLS,
  DEFAULT_CATEGORY_COLOR,
  isCategoryColor,
  isHexColor,
  paletteColor,
  paletteKeyOf,
  singleGrapheme,
  symbolKeyOf,
} from "@/lib/category-appearance";

describe("category palette", () => {
  it("stores a palette pick as its theme variable and maps it back", () => {
    for (const key of CATEGORY_PALETTE) {
      expect(paletteColor(key)).toBe(`var(--cat-${key})`);
      expect(paletteKeyOf(paletteColor(key))).toBe(key);
    }
  });

  it("defaults new categories to the groceries colour", () => {
    expect(DEFAULT_CATEGORY_COLOR).toBe("var(--cat-groceries)");
  });

  it("treats hex and unknown variables as non-palette colours", () => {
    expect(paletteKeyOf("#2563eb")).toBeNull();
    expect(paletteKeyOf("var(--cat-uncategorized)")).toBeNull();
    expect(paletteKeyOf("var(--primary)")).toBeNull();
    expect(paletteKeyOf(null)).toBeNull();
  });

  it("accepts hex or palette variables only", () => {
    expect(isCategoryColor("#5e8c5a")).toBe(true);
    expect(isCategoryColor("var(--cat-bills)")).toBe(true);
    expect(isCategoryColor("var(--cat-bills); color: red")).toBe(false);
    expect(isCategoryColor("var(--primary)")).toBe(false);
    expect(isCategoryColor("red")).toBe(false);
    expect(isHexColor("#5E8C5A")).toBe(true);
    expect(isHexColor("var(--cat-bills)")).toBe(false);
  });

  it("puts every default category colour on the palette", () => {
    for (const c of [...categoriesFr, ...categoriesEn]) {
      if (c.color) expect(paletteKeyOf(c.color), c.name).not.toBeNull();
    }
  });
});

describe("category symbols", () => {
  it("offers every default category icon", () => {
    const glyphs = new Set(CATEGORY_SYMBOLS.map((s) => s.glyph as string));
    for (const c of [...categoriesFr, ...categoriesEn]) {
      if (c.icon) expect(glyphs.has(c.icon), c.icon).toBe(true);
    }
  });

  it("has unique glyphs and maps them back to their key", () => {
    expect(new Set(CATEGORY_SYMBOLS.map((s) => s.glyph)).size).toBe(CATEGORY_SYMBOLS.length);
    expect(symbolKeyOf("🚗")).toBe("car");
    expect(symbolKeyOf("🦄")).toBeNull();
    expect(symbolKeyOf(null)).toBeNull();
  });

  it("accepts exactly one grapheme as a free symbol", () => {
    expect(singleGrapheme(" 🦄 ")).toBe("🦄");
    expect(singleGrapheme("€")).toBe("€");
    expect(singleGrapheme("👨‍👩‍👧‍👦")).toBe("👨‍👩‍👧‍👦");
    expect(singleGrapheme("👍🏽")).toBe("👍🏽");
    expect(singleGrapheme("🇫🇷")).toBe("🇫🇷");
    expect(singleGrapheme("ab")).toBeNull();
    expect(singleGrapheme("🚗🚗")).toBeNull();
    expect(singleGrapheme("   ")).toBeNull();
  });

  it("has a localized accessible name for every colour and symbol", () => {
    for (const messages of [fr, en]) {
      const c = messages.categories as {
        colors: Record<string, string>;
        symbols: Record<string, string>;
      };
      for (const key of CATEGORY_PALETTE) expect(c.colors[key]).toBeTruthy();
      for (const s of CATEGORY_SYMBOLS) expect(c.symbols[s.key]).toBeTruthy();
    }
  });
});

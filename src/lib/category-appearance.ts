// Category colours and symbols offered by the category form (design: forms.jsx AddCategoryForm,
// plus `income` so the default « Revenus » category stays on the palette).

export const CATEGORY_PALETTE = [
  "groceries",
  "housing",
  "transport",
  "food",
  "leisure",
  "health",
  "savings",
  "shopping",
  "bills",
  "income",
  "other",
] as const;
export type CategoryPaletteKey = (typeof CATEGORY_PALETTE)[number];

// Palette picks are stored as the CSS variable itself so they follow the light/dark theme;
// legacy and seeded categories keep a plain `#rrggbb`.
export function paletteColor(key: CategoryPaletteKey): string {
  return `var(--cat-${key})`;
}

export const DEFAULT_CATEGORY_COLOR = paletteColor("groceries");

const PALETTE_VAR = /^var\(--cat-([a-z]+)\)$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

export function paletteKeyOf(color: string | null | undefined): CategoryPaletteKey | null {
  const key = color?.match(PALETTE_VAR)?.[1];
  return key && (CATEGORY_PALETTE as readonly string[]).includes(key)
    ? (key as CategoryPaletteKey)
    : null;
}

export function isCategoryColor(color: string): boolean {
  return isHexColor(color) || paletteKeyOf(color) !== null;
}

// Includes every icon of the default category sets (prisma/seed-data/categories-*.json).
export const CATEGORY_SYMBOLS = [
  { key: "money", glyph: "💰" },
  { key: "cart", glyph: "🛒" },
  { key: "home", glyph: "🏠" },
  { key: "car", glyph: "🚗" },
  { key: "party", glyph: "🎉" },
  { key: "health", glyph: "🩺" },
  { key: "shopping", glyph: "🛍️" },
  { key: "box", glyph: "📦" },
  { key: "restaurant", glyph: "🍽️" },
  { key: "coffee", glyph: "☕" },
  { key: "energy", glyph: "⚡" },
  { key: "phone", glyph: "📱" },
  { key: "transit", glyph: "🚆" },
  { key: "fuel", glyph: "⛽" },
  { key: "travel", glyph: "✈️" },
  { key: "movie", glyph: "🎬" },
  { key: "sport", glyph: "🏋️" },
  { key: "books", glyph: "📚" },
  { key: "pharmacy", glyph: "💊" },
  { key: "clothes", glyph: "👕" },
  { key: "gift", glyph: "🎁" },
  { key: "pets", glyph: "🐾" },
  { key: "kids", glyph: "🧸" },
  { key: "bank", glyph: "🏦" },
  { key: "work", glyph: "💼" },
  { key: "receipt", glyph: "🧾" },
  { key: "tools", glyph: "🔧" },
] as const;
export type CategorySymbolKey = (typeof CATEGORY_SYMBOLS)[number]["key"];

export function symbolKeyOf(icon: string | null | undefined): CategorySymbolKey | null {
  return CATEGORY_SYMBOLS.find((s) => s.glyph === icon)?.key ?? null;
}

export function isHexColor(color: string | null | undefined): color is string {
  return !!color && HEX.test(color);
}

// Tile background of a category badge; no category at all is the uncategorized tile (as in charts).
export function categoryTileColor(category: { color?: string | null } | null | undefined): string {
  if (!category) return "var(--cat-uncategorized)";
  return category.color ?? "var(--cat-other)";
}

// Dark-theme --paper (globals.css), used as the glyph on light custom colours.
const DARK_GLYPH = "#0f1114";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Glyph colour for a tile. Palette variables follow the theme, so they use the
 * `text-category-glyph` token (undefined here). A fixed hex gets white or the dark glyph,
 * whichever contrasts more, in both themes (DATA-08).
 */
export function categoryGlyphColor(background: string): string | undefined {
  if (!isHexColor(background)) return undefined;
  const bg = luminance(background);
  const onWhite = 1.05 / (bg + 0.05);
  const onDark = (bg + 0.05) / (luminance(DARK_GLYPH) + 0.05);
  return onWhite >= onDark ? "#ffffff" : DARK_GLYPH;
}

// The trimmed input if it is exactly one user-perceived character (an emoji with its
// modifiers/ZWJ sequence counts as one), else null.
export function singleGrapheme(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(value)].length === 1 ? value : null;
}

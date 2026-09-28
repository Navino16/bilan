export const UNCATEGORIZED_COLOR = "var(--ink-3)";

// 1st slice of a family keeps the root color, the next ones alternate lighter/darker.
const SHADES = [0, 0.4, -0.3, 0.65, -0.5];

// Mixes a #rrggbb color towards white (amount > 0) or black (amount < 0).
export function shade(color: string, amount: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color) || amount === 0) return color;
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return `#${channels
    .map((c) =>
      Math.round(c + (target - c) * a)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Chart slice colors (issue #112 §8): sub-categories share their root's hue, so siblings
// get distinct shades of it; uncategorized spending is neutral grey.
export function categorySliceColors(
  slices: { categoryId: string | null }[],
  categories: Map<string, { color: string | null; rootId: string }>,
  fallback: string,
): string[] {
  const seen = new Map<string, number>();
  return slices.map(({ categoryId }) => {
    if (!categoryId) return UNCATEGORIZED_COLOR;
    const cat = categories.get(categoryId);
    if (!cat?.color) return fallback;
    const n = seen.get(cat.rootId) ?? 0;
    seen.set(cat.rootId, n + 1);
    return shade(cat.color, SHADES[n % SHADES.length]);
  });
}

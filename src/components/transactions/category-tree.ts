// Server-safe category helpers (no "use client"): callable from the
// transactions Server Component as well as from client components.

export type FlatCategory = {
  id: string;
  name: string;
  depth: number;
  color: string | null;
  icon: string | null;
};

type CategoryNodeLike = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  children: CategoryNodeLike[];
};

// Flattens a category forest into a depth-tagged list for indented <option>s
// and chip/avatar rendering. Children inherit the parent's color/icon when their
// own is unset (the default seed only colors top-level categories), so every
// row gets a meaningful chip and avatar.
export function flattenCategories(tree: CategoryNodeLike[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (
    nodes: CategoryNodeLike[],
    depth: number,
    inherited: { color: string | null; icon: string | null },
  ) => {
    for (const n of nodes) {
      const color = n.color ?? inherited.color;
      const icon = n.icon ?? inherited.icon;
      out.push({ id: n.id, name: n.name, depth, color, icon });
      walk(n.children, depth + 1, { color, icon });
    }
  };
  walk(tree, 0, { color: null, icon: null });
  return out;
}

export type CategoryMeta = { name: string; color: string | null; icon: string | null };

// id → display metadata, for resolving a transaction's categoryId to a chip.
export function categoryIndex(flat: FlatCategory[]): Record<string, CategoryMeta> {
  const index: Record<string, CategoryMeta> = {};
  for (const c of flat) index[c.id] = { name: c.name, color: c.color, icon: c.icon };
  return index;
}

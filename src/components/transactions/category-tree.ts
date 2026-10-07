// Server-safe category helpers (no "use client"): callable from the
// transactions Server Component as well as from client components.

export type FlatCategory = {
  id: string;
  name: string;
  depth: number;
  color: string | null;
  icon: string | null;
  rootId: string;
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
    inherited: { color: string | null; icon: string | null; rootId: string | null },
  ) => {
    for (const n of nodes) {
      const color = n.color ?? inherited.color;
      const icon = n.icon ?? inherited.icon;
      const rootId = inherited.rootId ?? n.id;
      out.push({ id: n.id, name: n.name, depth, color, icon, rootId });
      walk(n.children, depth + 1, { color, icon, rootId });
    }
  };
  walk(tree, 0, { color: null, icon: null, rootId: null });
  return out;
}

export type CategoryMeta = { name: string; color: string | null; icon: string | null };

// id → display metadata, for resolving a transaction's categoryId to a chip.
export function categoryIndex(flat: FlatCategory[]): Record<string, CategoryMeta> {
  const index: Record<string, CategoryMeta> = {};
  for (const c of flat) index[c.id] = { name: c.name, color: c.color, icon: c.icon };
  return index;
}

// Indents a name for a native <option>, where leading spaces would be collapsed.
export function indentedName(name: string, depth: number): string {
  return `${"   ".repeat(depth)}${name}`;
}

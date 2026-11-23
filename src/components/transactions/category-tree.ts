// Server-safe category helpers (no "use client"): callable from the
// transactions Server Component as well as from client components.

export type FlatCategory = {
  id: string;
  name: string;
  depth: number;
  color: string | null;
  icon: string | null;
  rootId: string;
  // Ancestor names, root first.
  parents: string[];
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
    inherited: {
      color: string | null;
      icon: string | null;
      rootId: string | null;
      parents: string[];
    },
  ) => {
    for (const n of nodes) {
      const color = n.color ?? inherited.color;
      const icon = n.icon ?? inherited.icon;
      const rootId = inherited.rootId ?? n.id;
      const { parents } = inherited;
      out.push({ id: n.id, name: n.name, depth, color, icon, rootId, parents });
      walk(n.children, depth + 1, { color, icon, rootId, parents: [...parents, n.name] });
    }
  };
  walk(tree, 0, { color: null, icon: null, rootId: null, parents: [] });
  return out;
}

export type CategoryMeta = {
  name: string;
  color: string | null;
  icon: string | null;
  parents: string[];
};

// id → display metadata, for resolving a transaction's categoryId to a chip.
export function categoryIndex(flat: FlatCategory[]): Record<string, CategoryMeta> {
  const index: Record<string, CategoryMeta> = {};
  for (const { id, name, color, icon, parents } of flat) index[id] = { name, color, icon, parents };
  return index;
}

export const PATH_SEPARATOR = " › ";

// Root-first "Parent › Child", the plain-text form of a category's display name.
export function categoryPath(category: { name: string; parents?: readonly string[] }): string {
  return [...(category.parents ?? []), category.name].join(PATH_SEPARATOR);
}

export function categoryPathLabel(flat: FlatCategory[], id: string): string | null {
  const category = flat.find((c) => c.id === id);
  return category ? categoryPath(category) : null;
}

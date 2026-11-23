export type CategoryOption = {
  id: string;
  name: string;
  depth: number;
  color: string | null; // own colour, or the nearest ancestor's
  parents: string[]; // ancestor names, root first
  parentId: string | null;
  groupId: string | null;
  // Name of the nearest self-or-ancestor carrying the flag, which subcategories inherit.
  savingsFrom: string | null;
  neutralFrom: string | null;
};

type NodeLike = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  groupId: string | null;
  savings?: boolean;
  neutral?: boolean;
  children: NodeLike[];
};

type Inherited = Pick<CategoryOption, "color" | "parents" | "savingsFrom" | "neutralFrom">;

// Depth-first, so a node's subtree is the contiguous run of deeper rows after it.
export function categoryOptions(tree: NodeLike[]): CategoryOption[] {
  const out: CategoryOption[] = [];
  const walk = (nodes: NodeLike[], depth: number, up: Inherited) => {
    for (const n of nodes) {
      const { id, name, parentId, groupId } = n;
      const own: Inherited = {
        color: n.color ?? up.color,
        parents: up.parents,
        savingsFrom: n.savings ? name : up.savingsFrom,
        neutralFrom: n.neutral ? name : up.neutralFrom,
      };
      out.push({ id, name, depth, parentId, groupId, ...own });
      walk(n.children, depth + 1, { ...own, parents: [...up.parents, name] });
    }
  };
  walk(tree, 0, { color: null, parents: [], savingsFrom: null, neutralFrom: null });
  return out;
}

// Categories of the same owner scope, minus `excludeId` and its descendants.
export function pickableCategories(
  all: CategoryOption[],
  groupId: string | null,
  excludeId?: string,
): CategoryOption[] {
  const out: CategoryOption[] = [];
  let skipBelow: number | null = null;
  for (const c of all) {
    if (skipBelow !== null && c.depth > skipBelow) continue;
    skipBelow = null;
    if (c.id === excludeId) skipBelow = c.depth;
    else if (c.groupId === groupId) out.push(c);
  }
  return out;
}

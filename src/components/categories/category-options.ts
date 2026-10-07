export type CategoryOption = {
  id: string;
  name: string;
  depth: number;
  color: string | null; // own colour, or the nearest ancestor's
  parentId: string | null;
  groupId: string | null;
};

type NodeLike = {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  groupId: string | null;
  children: NodeLike[];
};

// Depth-first, so a node's subtree is the contiguous run of deeper rows after it.
export function categoryOptions(tree: NodeLike[]): CategoryOption[] {
  const out: CategoryOption[] = [];
  const walk = (nodes: NodeLike[], depth: number, inheritedColor: string | null) => {
    for (const n of nodes) {
      const color = n.color ?? inheritedColor;
      out.push({ id: n.id, name: n.name, depth, color, parentId: n.parentId, groupId: n.groupId });
      walk(n.children, depth + 1, color);
    }
  };
  walk(tree, 0, null);
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

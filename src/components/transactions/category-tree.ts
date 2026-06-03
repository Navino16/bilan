// Server-safe category helpers (no "use client"): callable from the
// transactions Server Component as well as from client components.

export type FlatCategory = { id: string; name: string; depth: number };

// Flattens a category forest into a depth-tagged list for indented <option>s.
export function flattenCategories(
  tree: {
    id: string;
    name: string;
    children: { id: string; name: string; children: unknown[] }[];
  }[],
): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (nodes: { id: string; name: string; children: unknown[] }[], depth: number) => {
    for (const n of nodes) {
      out.push({ id: n.id, name: n.name, depth });
      walk(n.children as typeof nodes, depth + 1);
    }
  };
  walk(tree as never, 0);
  return out;
}

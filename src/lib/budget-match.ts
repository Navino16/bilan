// Pure row → line matching of a budget attached to an account (design §C). No DB.

import type { BudgetLineKind, TransferDirection } from "@/lib/validation/budget";

export type MatchLine = {
  kind: BudgetLineKind;
  categoryId: string | null;
  categoryIds: ReadonlySet<string> | null; // category + descendants
  direction: TransferDirection | null;
  counterpartAccountId: string | null;
};

export type MatchRow = {
  amount: number;
  categoryId: string | null;
  partnerAccountIds: string[]; // accounts of the row's link partners, other than its own
  // Unlinked row only: accounts holding an opposite same-amount unlinked row within the
  // auto-link window, i.e. a transfer leg not linked yet.
  pendingAccountIds: string[];
};

export type RowBucket = number | "out" | "unplanned";

export function lineFlow(l: {
  kind: BudgetLineKind;
  direction: TransferDirection | null;
}): "in" | "out" {
  return l.kind === "INCOME" || (l.kind === "TRANSFER" && l.direction === "IN") ? "in" : "out";
}

// Most specific category lines among `matched` (#154), first one on a tie.
function mostSpecific(matched: number[], lines: MatchLine[]): number | undefined {
  return matched.find((i) => {
    const outer = lines[i];
    return !matched.some((j) => {
      const inner = lines[j].categoryId;
      return inner != null && inner !== outer.categoryId && !!outer.categoryIds?.has(inner);
    });
  });
}

// One bucket per row: transfer lines first, then category lines, then out of budget
// (outflows) or unplanned income (inflows). A transfer leg is never a refund.
export function bucketRow(row: MatchRow, lines: MatchLine[]): RowBucket {
  const flow = row.amount < 0 ? "out" : "in";
  const legAccounts =
    row.partnerAccountIds.length > 0 ? row.partnerAccountIds : row.pendingAccountIds;
  const transferIdx = lines.findIndex(
    (l) =>
      l.kind === "TRANSFER" &&
      lineFlow(l) === flow &&
      l.counterpartAccountId != null &&
      legAccounts.includes(l.counterpartAccountId),
  );
  if (transferIdx >= 0) return transferIdx;

  const inCategory = (kind: BudgetLineKind) =>
    lines.flatMap((l, i) =>
      l.kind === kind && row.categoryId != null && l.categoryIds?.has(row.categoryId) ? [i] : [],
    );
  const isLeg = row.partnerAccountIds.length > 0 || row.pendingAccountIds.length > 0;
  const candidates =
    flow === "out"
      ? [inCategory("EXPENSE")]
      : [inCategory("INCOME"), isLeg ? [] : inCategory("EXPENSE")];
  for (const matched of candidates) {
    const idx = mostSpecific(matched, lines);
    if (idx !== undefined) return idx;
  }
  return flow === "out" ? "out" : "unplanned";
}

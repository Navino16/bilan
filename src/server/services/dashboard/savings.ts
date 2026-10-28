import { db } from "@/server/db";
import { withDescendants } from "@/server/services/categories";
import { groupMemberships } from "@/server/services/groups/memberships";
import type { Period } from "@/lib/period";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Categories flagged "counts as savings" that may tag these accounts' rows, with their subtrees.
async function savingsCategoryIds(userId: string, ownerIds: string[]): Promise<string[]> {
  const groupIds = (await groupMemberships(userId)).map((m) => m.groupId);
  const flagged = await db.category.findMany({
    where: {
      savings: true,
      OR: [{ userId: { in: [userId, ...ownerIds] } }, { groupId: { in: groupIds } }],
    },
    select: { id: true },
  });
  if (flagged.length === 0) return [];
  const subtrees = await withDescendants(flagged.map((c) => c.id));
  return [...new Set([...subtrees.values()].flatMap((s) => [...s]))];
}

// Net savings over the period (spec A): transfers linked into savings accounts minus those
// out of them, plus unlinked spending in savings categories (money saved outside Bilan).
export async function netSavings(
  userId: string,
  accountIds: string[],
  period: Period,
): Promise<number> {
  if (accountIds.length === 0) return 0;
  const accounts = await db.bankAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, type: true, ownerId: true },
  });
  const savingsIds = accounts.filter((a) => a.type === "SAVINGS").map((a) => a.id);
  const otherIds = accounts.filter((a) => a.type !== "SAVINGS").map((a) => a.id);
  const periodDate = { gte: period.from, lte: period.to };

  let transferred = 0;
  if (savingsIds.length > 0) {
    const legs = await db.transactionLinkMember.findMany({
      where: { transaction: { accountId: { in: savingsIds }, periodDate } },
      select: { linkId: true, transaction: { select: { amount: true } } },
    });
    const crossing = new Set(
      (
        await db.transactionLinkMember.findMany({
          where: {
            linkId: { in: [...new Set(legs.map((l) => l.linkId))] },
            transaction: { account: { type: { not: "SAVINGS" } } },
          },
          select: { linkId: true },
        })
      ).map((m) => m.linkId),
    );
    for (const l of legs) if (crossing.has(l.linkId)) transferred += Number(l.transaction.amount);
  }

  let spent = 0;
  const categoryIds =
    otherIds.length > 0
      ? await savingsCategoryIds(userId, [...new Set(accounts.map((a) => a.ownerId))])
      : [];
  if (categoryIds.length > 0) {
    const { _sum } = await db.transaction.aggregate({
      where: {
        accountId: { in: otherIds },
        periodDate,
        categoryId: { in: categoryIds },
        linkMembership: { is: null },
      },
      _sum: { amount: true },
    });
    spent = -Number(_sum.amount ?? 0);
  }
  return round2(transferred + spent);
}

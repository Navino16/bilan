import type { Prisma } from "@prisma/client";

// A link needs 2+ members: once rows are deleted, links left with fewer go too.
// Kept out of `links/index.ts`, which imports the transactions service.
export async function dissolveUndersizedLinks(
  tx: Prisma.TransactionClient,
  linkIds: string[],
): Promise<number> {
  if (linkIds.length === 0) return 0;
  const remaining = await tx.transactionLinkMember.groupBy({
    by: ["linkId"],
    where: { linkId: { in: linkIds } },
    _count: { _all: true },
  });
  const kept = new Set(remaining.filter((r) => r._count._all >= 2).map((r) => r.linkId));
  const dissolved = linkIds.filter((id) => !kept.has(id));
  await tx.transactionLink.deleteMany({ where: { id: { in: dissolved } } });
  return dissolved.length;
}

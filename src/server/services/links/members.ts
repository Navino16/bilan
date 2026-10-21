import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";

// Link id of each linked transaction matching `where`. Read from the member table joined to its
// transaction: a `linkMembership` include sends every loaded row id back to the database (#299).
export async function linkIdsWhere(
  where: Prisma.TransactionWhereInput,
): Promise<Map<string, string>> {
  const members = await db.transactionLinkMember.findMany({
    where: { transaction: where },
    select: { transactionId: true, linkId: true },
  });
  return new Map(members.map((m) => [m.transactionId, m.linkId]));
}

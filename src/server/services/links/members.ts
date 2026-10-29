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

export type LinkPartner = { transactionId: string; accountId: string; accountType: string };

// Members of each link with their account and its type, in one query.
export async function linkPartners(linkIds: string[]): Promise<Map<string, LinkPartner[]>> {
  if (linkIds.length === 0) return new Map();
  const members = await db.transactionLinkMember.findMany({
    where: { linkId: { in: linkIds } },
    select: {
      linkId: true,
      transactionId: true,
      transaction: { select: { accountId: true, account: { select: { type: true } } } },
    },
  });
  const out = new Map<string, LinkPartner[]>();
  for (const m of members) {
    const partner = {
      transactionId: m.transactionId,
      accountId: m.transaction.accountId,
      accountType: m.transaction.account.type,
    };
    out.set(m.linkId, [...(out.get(m.linkId) ?? []), partner]);
  }
  return out;
}

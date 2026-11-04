import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { getEffectiveAccess } from "@/server/services/accounts/sharing";
import { logEvent } from "@/server/services/audit";
import { LinkAccessError } from "./index";
import { createLinkedTransferLeg } from "./leg";
import { alignNewLinkMonth } from "./month";

// The other leg of a transfer the bank doesn't show on `targetAccountId` (#404), linked to the
// source. The target must be one of the actor's own active accounts.
export async function createOppositeTransaction(input: {
  transactionId: string;
  targetAccountId: string;
  userId: string;
}): Promise<{ id: string; linkId: string }> {
  const source = await db.transaction.findUnique({
    where: { id: input.transactionId },
    select: {
      id: true,
      accountId: true,
      amount: true,
      date: true,
      type: true,
      periodDate: true,
      periodManual: true,
      account: { select: { name: true } },
      linkMembership: { select: { linkId: true } },
    },
  });
  const access = source && (await getEffectiveAccess(input.userId, source.accountId));
  if (!source || !access) throw new LinkAccessError("NOT_FOUND");
  if (access === "READ") throw new LinkAccessError("FORBIDDEN");
  if (input.targetAccountId === source.accountId) throw new LinkAccessError("SAME_ACCOUNT");
  const target = await db.bankAccount.findUnique({
    where: { id: input.targetAccountId },
    select: { ownerId: true, archived: true },
  });
  if (target?.ownerId !== input.userId) throw new LinkAccessError("TARGET_FORBIDDEN");
  if (target.archived) throw new LinkAccessError("TARGET_ARCHIVED");
  if (source.linkMembership) throw new LinkAccessError("ALREADY_LINKED");

  let leg: Awaited<ReturnType<typeof createLinkedTransferLeg>>;
  try {
    leg = await createLinkedTransferLeg({
      source: { ...source, amount: Number(source.amount) },
      accountId: input.targetAccountId,
      sourceName: source.account.name,
      actorId: input.userId,
      auto: false,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new LinkAccessError("ALREADY_LINKED");
    }
    throw e;
  }
  await alignNewLinkMonth([source, leg]);
  await logEvent({
    userId: input.userId,
    action: "link.oppositeCreated",
    entity: "Transaction",
    entityId: leg.id,
    metadata: { sourceId: source.id, linkId: leg.linkId },
  });
  return { id: leg.id, linkId: leg.linkId };
}

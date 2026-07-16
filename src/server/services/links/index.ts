import { db } from "@/server/db";
import { listVisibleForUser } from "@/server/services/accounts";
import { logEvent } from "@/server/services/audit";

export class LinkAccessError extends Error {}

// Account ids the user may see (owned + shared). Reused for every link op.
async function visibleAccountIds(userId: string): Promise<Set<string>> {
  return new Set((await listVisibleForUser(userId)).map((a) => a.id));
}

// Creates a link over 2+ transactions, all visible to the user and none already
// linked. Throws LinkAccessError otherwise.
export async function createLink(input: {
  transactionIds: string[];
  userId: string;
  name?: string | null;
}): Promise<{ id: string }> {
  const ids = [...new Set(input.transactionIds)];
  if (ids.length < 2) throw new LinkAccessError("TOO_FEW");

  const visible = await visibleAccountIds(input.userId);
  const rows = await db.transaction.findMany({
    where: { id: { in: ids } },
    select: { id: true, accountId: true, linkMembership: { select: { linkId: true } } },
  });
  if (rows.length !== ids.length) throw new LinkAccessError("NOT_FOUND");
  for (const r of rows) {
    if (!visible.has(r.accountId)) throw new LinkAccessError("FORBIDDEN");
    if (r.linkMembership) throw new LinkAccessError("ALREADY_LINKED");
  }

  const link = await db.transactionLink.create({
    data: {
      name: input.name ?? null,
      createdById: input.userId,
      members: { create: ids.map((transactionId) => ({ transactionId })) },
    },
  });
  await logEvent({
    userId: input.userId,
    action: "link.created",
    entity: "TransactionLink",
    entityId: link.id,
    metadata: { count: ids.length },
  });
  return { id: link.id };
}

// Deletes a link the user created (members are freed via cascade).
export async function deleteLink(linkId: string, userId: string): Promise<void> {
  const link = await db.transactionLink.findUnique({ where: { id: linkId } });
  if (!link) throw new LinkAccessError("NOT_FOUND");
  if (link.createdById !== userId) throw new LinkAccessError("FORBIDDEN");
  await db.transactionLink.delete({ where: { id: linkId } });
  await logEvent({ userId, action: "link.deleted", entity: "TransactionLink", entityId: linkId });
}

// Ids of the user's visible transactions that already belong to a link (for
// badging rows + excluding them from suggestions).
export async function listLinkedTxIds(userId: string): Promise<Set<string>> {
  const visible = await visibleAccountIds(userId);
  if (visible.size === 0) return new Set();
  const members = await db.transactionLinkMember.findMany({
    where: { transaction: { accountId: { in: [...visible] } } },
    select: { transactionId: true },
  });
  return new Set(members.map((m) => m.transactionId));
}

// The link id a transaction belongs to, or null. Used by the detail view + the
// link-mode "unlink" action.
export async function getLinkForTx(transactionId: string, userId: string): Promise<string | null> {
  const visible = await visibleAccountIds(userId);
  const member = await db.transactionLinkMember.findUnique({
    where: { transactionId },
    select: { linkId: true, transaction: { select: { accountId: true } } },
  });
  if (!member || !visible.has(member.transaction.accountId)) return null;
  return member.linkId;
}

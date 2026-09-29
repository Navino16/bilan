import { db } from "@/server/db";
import { listVisibleForUser } from "@/server/services/accounts";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { listTransactions } from "@/server/services/transactions";
import { logEvent } from "@/server/services/audit";
import { findSuggestedPairs, pairKeyOf, type SuggestedPair } from "@/lib/links";

export class LinkAccessError extends Error {}

// Account ids the user may see (owned + shared). Reused for read-only link ops.
async function visibleAccountIds(userId: string): Promise<Set<string>> {
  return new Set((await listVisibleForUser(userId)).map((a) => a.id));
}

// Throws unless the user has WRITE on every account in `accountIds`. Linking
// mutates the owner's aggregates (a balanced link drops from their totals), so
// it must be gated on write access — not mere read visibility.
async function assertCanWriteAll(userId: string, accountIds: Iterable<string>): Promise<void> {
  for (const accId of new Set(accountIds)) {
    if (!(await canWriteAccount(userId, accId))) throw new LinkAccessError("FORBIDDEN");
  }
}

// Creates a link over 2+ transactions, all WRITABLE by the user and none already
// linked. Throws LinkAccessError otherwise.
export async function createLink(input: {
  transactionIds: string[];
  userId: string;
  name?: string | null;
}): Promise<{ id: string }> {
  const ids = [...new Set(input.transactionIds)];
  if (ids.length < 2) throw new LinkAccessError("TOO_FEW");

  const rows = await db.transaction.findMany({
    where: { id: { in: ids } },
    select: { id: true, accountId: true, linkMembership: { select: { linkId: true } } },
  });
  if (rows.length !== ids.length) throw new LinkAccessError("NOT_FOUND");
  for (const r of rows) {
    if (r.linkMembership) throw new LinkAccessError("ALREADY_LINKED");
  }
  await assertCanWriteAll(
    input.userId,
    rows.map((r) => r.accountId),
  );

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

// Deletes a link (members are freed via cascade). Any user with WRITE on all of
// the link's transactions may unlink — including the account owner, not only the
// user who created the link.
export async function deleteLink(linkId: string, userId: string): Promise<void> {
  const link = await db.transactionLink.findUnique({
    where: { id: linkId },
    include: { members: { select: { transaction: { select: { accountId: true } } } } },
  });
  if (!link) throw new LinkAccessError("NOT_FOUND");
  await assertCanWriteAll(
    userId,
    link.members.map((m) => m.transaction.accountId),
  );
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

// The link id a transaction belongs to, or null when unlinked or not visible.
export async function getLinkForTx(transactionId: string, userId: string): Promise<string | null> {
  const visible = await visibleAccountIds(userId);
  const member = await db.transactionLinkMember.findUnique({
    where: { transactionId },
    select: { linkId: true, transaction: { select: { accountId: true } } },
  });
  if (!member || !visible.has(member.transaction.accountId)) return null;
  return member.linkId;
}

export type SuggestedPairView = SuggestedPair & {
  positiveLabel: string;
  negativeLabel: string;
  date: string; // ISO day of the negative (expense) leg
};

// Suggests +X/-X pairs over the user's visible, not-yet-linked transactions,
// within UserPreference.linkWindowDays / linkMinAmount, excluding ignored pairs.
export async function suggestPairs(userId: string): Promise<SuggestedPairView[]> {
  const pref = await db.userPreference.findUnique({ where: { userId } });
  const windowDays = pref?.linkWindowDays ?? 30;
  const minAmount = pref ? Number(pref.linkMinAmount) : 0;

  // Visible transactions (decrypted) minus those already in a link.
  const linked = await listLinkedTxIds(userId);
  const { items } = await listTransactions(userId, { take: 5000 });
  const candidates = items.filter((t) => !linked.has(t.id));

  const ignoredRows = await db.ignoredLinkSuggestion.findMany({
    where: { userId },
    select: { pairKey: true },
  });
  const ignored = new Set(ignoredRows.map((r) => r.pairKey));

  const rows = candidates.map((t) => ({ id: t.id, amount: t.amount, date: t.date }));
  const pairs = findSuggestedPairs(rows, { windowDays, minAmount, ignored });

  const byId = new Map(candidates.map((t) => [t.id, t]));
  return pairs.map((p) => ({
    ...p,
    positiveLabel: byId.get(p.positiveId)?.label ?? "",
    negativeLabel: byId.get(p.negativeId)?.label ?? "",
    date: (byId.get(p.negativeId)?.date ?? new Date()).toISOString().slice(0, 10),
  }));
}

// Records that the user dismissed a suggested pair so it stops resurfacing.
export async function ignoreSuggestion(userId: string, pairKey: string): Promise<void> {
  await db.ignoredLinkSuggestion.upsert({
    where: { userId_pairKey: { userId, pairKey } },
    update: {},
    create: { userId, pairKey },
  });
  await logEvent({
    userId,
    action: "link.suggestionIgnored",
    entity: "IgnoredLinkSuggestion",
    entityId: pairKey,
  });
}

export { pairKeyOf };

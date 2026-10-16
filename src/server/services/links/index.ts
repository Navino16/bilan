import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { toIsoDay } from "@/lib/period";
import { visibleAccountIds, visibleAccountRefs } from "@/server/services/accounts";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { logEvent } from "@/server/services/audit";
import { getLinkSuggestionSettings } from "@/server/services/users/preferences";
import { findSuggestedPairs, pairKeyOf, type SuggestedPair } from "@/lib/links";

export class LinkAccessError extends Error {}

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
  if (visible.length === 0) return new Set();
  const members = await db.transactionLinkMember.findMany({
    where: { transaction: { accountId: { in: visible } } },
    select: { transactionId: true },
  });
  return new Set(members.map((m) => m.transactionId));
}

// The link id a transaction belongs to, or null when unlinked or not visible.
export async function getLinkForTx(transactionId: string, userId: string): Promise<string | null> {
  const visible = new Set(await visibleAccountIds(userId));
  const member = await db.transactionLinkMember.findUnique({
    where: { transactionId },
    select: { linkId: true, transaction: { select: { accountId: true } } },
  });
  if (!member || !visible.has(member.transaction.accountId)) return null;
  return member.linkId;
}

export type PairLeg = { id: string; label: string; date: string; accountName: string };

export type SuggestedPairView = SuggestedPair & { positive: PairLeg; negative: PairLeg };

function legOf(t: { id: string; label: string; date: Date; accountName: string }): PairLeg {
  return { id: t.id, label: t.label, date: toIsoDay(t.date), accountName: t.accountName };
}

const SUGGESTION_SCAN_LIMIT = 5000;

// Suggests +X/-X pairs over the user's visible, not-yet-linked transactions (the
// most recent SUGGESTION_SCAN_LIMIT), within the user's link suggestion settings,
// excluding ignored pairs. Only the paired rows get their label decrypted.
export async function suggestPairs(userId: string): Promise<SuggestedPairView[]> {
  const [{ windowDays, minAmount }, visible, ignoredRows] = await Promise.all([
    getLinkSuggestionSettings(userId),
    visibleAccountRefs(userId),
    db.ignoredLinkSuggestion.findMany({ where: { userId }, select: { pairKey: true } }),
  ]);
  if (visible.length === 0) return [];
  const accountName = new Map(visible.map((a) => [a.id, a.name]));
  const ignored = new Set(ignoredRows.map((r) => r.pairKey));

  const candidates = await db.transaction.findMany({
    where: { accountId: { in: [...accountName.keys()] }, linkMembership: { is: null } },
    select: { id: true, accountId: true, amount: true, date: true, labelEnc: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: SUGGESTION_SCAN_LIMIT,
  });
  const rows = candidates.map((t) => ({ id: t.id, amount: Number(t.amount), date: t.date }));
  const pairs = findSuggestedPairs(rows, { windowDays, minAmount, ignored });

  const byId = new Map(candidates.map((t) => [t.id, t]));
  const leg = (id: string) => {
    const t = byId.get(id)!;
    return legOf({
      id,
      label: decrypt(t.labelEnc, dataKey),
      date: t.date,
      accountName: accountName.get(t.accountId) ?? "",
    });
  };
  return pairs.map((p) => ({ ...p, positive: leg(p.positiveId), negative: leg(p.negativeId) }));
}

export type IgnoredPairView = { key: string; amount: number; positive: PairLeg; negative: PairLeg };

// The user's dismissed pairs whose two legs still exist, are visible and unlinked
// (any other pair could never be suggested again), most recently ignored first.
export async function listIgnoredSuggestions(userId: string): Promise<IgnoredPairView[]> {
  const ignored = await db.ignoredLinkSuggestion.findMany({
    where: { userId },
    orderBy: { ignoredAt: "desc" },
    take: 200,
    select: { pairKey: true },
  });
  if (ignored.length === 0) return [];
  const visible = await visibleAccountRefs(userId);
  const accountName = new Map(visible.map((a) => [a.id, a.name]));
  const ids = [...new Set(ignored.flatMap((r) => r.pairKey.split("|")))];
  const rows = await db.transaction.findMany({
    where: { id: { in: ids }, accountId: { in: [...accountName.keys()] }, linkMembership: null },
    select: { id: true, accountId: true, date: true, amount: true, labelEnc: true },
  });
  const byId = new Map(
    rows.map((r) => [
      r.id,
      {
        amount: Number(r.amount),
        leg: legOf({
          id: r.id,
          label: decrypt(r.labelEnc, dataKey),
          date: r.date,
          accountName: accountName.get(r.accountId) ?? "",
        }),
      },
    ]),
  );

  const out: IgnoredPairView[] = [];
  for (const { pairKey } of ignored) {
    const [a, b] = pairKey.split("|").map((id) => byId.get(id));
    if (!a || !b) continue;
    const [pos, neg] = a.amount > 0 ? [a, b] : [b, a];
    out.push({ key: pairKey, amount: Math.abs(pos.amount), positive: pos.leg, negative: neg.leg });
  }
  return out;
}

export async function restoreSuggestion(userId: string, pairKey: string): Promise<void> {
  const { count } = await db.ignoredLinkSuggestion.deleteMany({ where: { userId, pairKey } });
  if (count === 0) throw new LinkAccessError("NOT_FOUND");
  await logEvent({
    userId,
    action: "link.suggestionRestored",
    entity: "IgnoredLinkSuggestion",
    entityId: pairKey,
  });
}

export type LinkSummary = {
  linkId: string;
  others: (PairLeg & { amount: number })[];
  hiddenCount: number; // members on accounts the viewer can't read
  canUnlink: boolean;
};

// What a visible transaction is linked to, from the viewer's standpoint; null
// when it isn't linked or isn't visible. Unlinking needs WRITE on every member.
export async function getLinkSummary(
  transactionId: string,
  userId: string,
): Promise<LinkSummary | null> {
  const member = await db.transactionLinkMember.findUnique({
    where: { transactionId },
    select: {
      linkId: true,
      link: {
        select: {
          members: {
            select: {
              transaction: {
                select: { id: true, accountId: true, date: true, amount: true, labelEnc: true },
              },
            },
          },
        },
      },
    },
  });
  if (!member) return null;
  const visible = await visibleAccountRefs(userId);
  const accountName = new Map(visible.map((a) => [a.id, a.name]));
  const txs = member.link.members.map((m) => m.transaction);
  const self = txs.find((t) => t.id === transactionId)!;
  if (!accountName.has(self.accountId)) return null;

  const others = txs
    .filter((t) => t.id !== transactionId && accountName.has(t.accountId))
    .sort((x, y) => x.date.getTime() - y.date.getTime())
    .map((t) => ({
      ...legOf({
        id: t.id,
        label: decrypt(t.labelEnc, dataKey),
        date: t.date,
        accountName: accountName.get(t.accountId)!,
      }),
      amount: Number(t.amount),
    }));
  let canUnlink = true;
  for (const accId of new Set(txs.map((t) => t.accountId))) {
    if (!(await canWriteAccount(userId, accId))) canUnlink = false;
  }
  return {
    linkId: member.linkId,
    others,
    hiddenCount: txs.length - 1 - others.length,
    canUnlink,
  };
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

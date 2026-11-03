import { db } from "@/server/db";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { dissolveUndersizedLinks } from "@/server/services/links/dissolve";
import { TransactionAccessError } from "./index";

export const MAX_DELETE_IDS = 500;

export type DeleteImpact = {
  transactions: number;
  dissolvedLinks: number;
  leavingLink: number; // rows leaving a link that keeps 2+ members
  budgeted: number;
};

type Deletable = {
  id: string;
  accountId: string;
  externalId: string | null;
  importBatch: { source: string } | null;
};

async function loadDeletable(actorId: string, rawIds: string[]): Promise<Deletable[]> {
  const ids = [...new Set(rawIds)];
  if (ids.length === 0 || ids.length > MAX_DELETE_IDS) throw new TransactionAccessError("INVALID");
  const rows = await db.transaction.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      accountId: true,
      externalId: true,
      importBatch: { select: { source: true } },
    },
  });
  if (rows.length !== ids.length) throw new TransactionAccessError("NOT_FOUND");
  for (const accountId of new Set(rows.map((r) => r.accountId))) {
    if (!(await canWriteAccount(actorId, accountId))) throw new TransactionAccessError("FORBIDDEN");
  }
  return rows;
}

export async function getDeleteImpact(actorId: string, rawIds: string[]): Promise<DeleteImpact> {
  const ids = (await loadDeletable(actorId, rawIds)).map((r) => r.id);
  const [memberships, budgeted] = await Promise.all([
    db.transactionLinkMember.findMany({
      where: { transactionId: { in: ids } },
      select: { linkId: true },
    }),
    db.transaction.count({ where: { id: { in: ids }, budgetAssignments: { some: {} } } }),
  ]);
  const deletedPerLink = new Map<string, number>();
  for (const m of memberships)
    deletedPerLink.set(m.linkId, (deletedPerLink.get(m.linkId) ?? 0) + 1);
  const sizes = await db.transactionLinkMember.groupBy({
    by: ["linkId"],
    where: { linkId: { in: [...deletedPerLink.keys()] } },
    _count: { _all: true },
  });
  let dissolvedLinks = 0;
  let leavingLink = 0;
  for (const s of sizes) {
    const deleted = deletedPerLink.get(s.linkId) ?? 0;
    if (s._count._all - deleted < 2) dissolvedLinks++;
    else leavingLink += deleted;
  }
  return { transactions: ids.length, dissolvedLinks, leavingLink, budgeted };
}

export async function deleteTransactions(
  actorId: string,
  rawIds: string[],
): Promise<{ deleted: number; linksDissolved: number }> {
  const rows = await loadDeletable(actorId, rawIds);
  const ids = rows.map((r) => r.id);
  return db.$transaction(async (tx) => {
    const memberships = await tx.transactionLinkMember.findMany({
      where: { transactionId: { in: ids } },
      select: { linkId: true },
    });
    const { count: deleted } = await tx.transaction.deleteMany({ where: { id: { in: ids } } });
    // A concurrent deletion took some rows between the guard and here: roll back.
    if (deleted !== ids.length) throw new TransactionAccessError("NOT_FOUND");
    const linkIds = [...new Set(memberships.map((m) => m.linkId))];
    const linksDissolved = await dissolveUndersizedLinks(tx, linkIds);
    // Later syncs never re-insert a synced row the user deleted (design §Deleting synced rows).
    const tombstones = rows.flatMap((r) =>
      r.importBatch?.source === "SYNC" && r.externalId
        ? [{ accountId: r.accountId, externalId: r.externalId }]
        : [],
    );
    if (tombstones.length) {
      await tx.syncTombstone.createMany({ data: tombstones, skipDuplicates: true });
    }
    await tx.auditLog.createMany({
      data: rows.map((r) => ({
        userId: actorId,
        action: "transaction.deleted",
        entity: "Transaction",
        entityId: r.id,
        metadata: { accountId: r.accountId },
      })),
    });
    return { deleted, linksDissolved };
  });
}

import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { loadAliases } from "@/server/services/merchants";

export type UserDataExport = {
  exportedAt: string;
  user: { id: string; email: string; name: string | null; createdAt: Date };
  preference: unknown;
  accounts: {
    id: string;
    name: string;
    type: string;
    initialBalance: number;
    iban: string | null;
    bankName: string | null;
    color: string | null;
    icon: string | null;
    archived: boolean;
    createdAt: Date;
  }[];
  transactions: {
    id: string;
    date: Date;
    amount: number;
    type: string;
    label: string;
    rawLabel: string;
    note: string | null;
    categoryId: string | null;
    manuallyCategorized: boolean;
    accountId: string;
    importBatchId: string | null;
    linkId: string | null;
    externalId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  categories: unknown[];
  rules: unknown[];
  merchantAliases: { merchant: string; name: string }[];
  budgets: unknown[];
  groups: unknown[];
  invitationsSent: unknown[];
  links: { id: string; name: string | null; createdAt: Date; transactionIds: string[] }[];
  ignoredLinkSuggestions: { transactionIds: string[]; ignoredAt: Date }[];
  imports: {
    id: string;
    source: string;
    filename: string | null;
    status: string;
    accountIds: string[];
    totalRows: number;
    importedRows: number;
    skippedRows: number;
    errorMessage: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }[];
  auditLog: unknown[];
};

// Gathers the full data graph a user is entitled to under RGPD (owned accounts
// only), decrypting the IBANs and transaction labels/notes. Read-only.
export async function exportUserData(userId: string): Promise<UserDataExport> {
  const [
    user,
    preference,
    accountRows,
    categories,
    rules,
    aliases,
    budgets,
    memberships,
    invitationsSent,
    ignoredRows,
    auditLog,
  ] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    db.userPreference.findUnique({ where: { userId } }),
    db.bankAccount.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "asc" } }),
    db.category.findMany({ where: { userId } }),
    db.categorizationRule.findMany({ where: { userId } }),
    loadAliases(userId),
    db.budget.findMany({ where: { userId }, include: { lines: true, assignments: true } }),
    db.groupMember.findMany({ where: { userId }, include: { group: true } }),
    db.groupInvitation.findMany({
      where: { invitedById: userId },
      omit: { token: true, code: true },
    }),
    db.ignoredLinkSuggestion.findMany({
      where: { userId },
      select: { pairKey: true, ignoredAt: true },
    }),
    db.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);

  const accounts = accountRows.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    initialBalance: Number(a.initialBalance),
    iban: a.ibanEnc ? decrypt(a.ibanEnc, dataKey) : null,
    bankName: a.bankName,
    color: a.color,
    icon: a.icon,
    archived: a.archived,
    createdAt: a.createdAt,
  }));

  const accountIds = accounts.map((a) => a.id);
  const [txRows, linkRows, batchRows] = await Promise.all([
    accountIds.length
      ? db.transaction.findMany({
          where: { accountId: { in: accountIds } },
          orderBy: { date: "desc" },
          include: { linkMembership: { select: { linkId: true } } },
        })
      : [],
    db.transactionLink.findMany({
      where: { members: { some: { transaction: { accountId: { in: accountIds } } } } },
      include: {
        members: {
          where: { transaction: { accountId: { in: accountIds } } },
          select: { transactionId: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.importBatch.findMany({
      where: {
        OR: [
          { accountId: { in: accountIds } },
          { createdById: userId },
          { transactions: { some: { accountId: { in: accountIds } } } },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const transactions = txRows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    type: r.type,
    label: decrypt(r.labelEnc, dataKey),
    rawLabel: decrypt(r.rawLabelEnc, dataKey),
    note: r.noteEnc ? decrypt(r.noteEnc, dataKey) : null,
    categoryId: r.categoryId,
    manuallyCategorized: r.manuallyCategorized,
    accountId: r.accountId,
    importBatchId: r.importBatchId,
    linkId: r.linkMembership?.linkId ?? null,
    externalId: r.externalId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  // Links, ignored suggestions and imports can span other users' shared accounts:
  // only ids belonging to the exported (owned) accounts are kept (#171).
  const links = linkRows.map((l) => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt,
    transactionIds: l.members.map((m) => m.transactionId),
  }));

  const txIds = new Set(transactions.map((t) => t.id));
  const ignoredLinkSuggestions = ignoredRows.flatMap(({ pairKey, ignoredAt }) => {
    const transactionIds = pairKey.split("|").filter((id) => txIds.has(id));
    return transactionIds.length ? [{ transactionIds, ignoredAt }] : [];
  });

  const owned = new Set(accountIds);
  // `metadata` is left out: it holds the raw uploaded file while a batch is under review.
  const imports = batchRows.map((b) => ({
    id: b.id,
    source: b.source,
    filename: b.filename,
    status: b.status,
    accountIds: (
      (b.metadata as { accountIds?: string[] } | null)?.accountIds ?? [b.accountId]
    ).filter((id) => owned.has(id)),
    totalRows: b.totalRows,
    importedRows: b.importedRows,
    skippedRows: b.skippedRows,
    errorMessage: b.errorMessage,
    createdAt: b.createdAt,
    completedAt: b.completedAt,
  }));

  return {
    exportedAt: new Date().toISOString(),
    user,
    preference,
    accounts,
    transactions,
    categories,
    rules,
    merchantAliases: [...aliases].map(([merchant, name]) => ({ merchant, name })),
    budgets,
    groups: memberships,
    invitationsSent,
    links,
    ignoredLinkSuggestions,
    imports,
    auditLog,
  };
}

// Self-service deletion. The caller must be the user themselves (enforced in the
// action). Cascade FKs remove the owned graph; three FK-less columns are cleaned
// explicitly, and the audit trail is anonymised (retained, userId nulled).
export async function deleteUser(userId: string): Promise<void> {
  // FK-less columns that Prisma cascade does not reach — clean explicitly first.
  await db.transactionLink.deleteMany({ where: { createdById: userId } });
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId } });
  // Anonymise the user's audit trail rather than delete it (retention).
  await db.auditLog.updateMany({ where: { userId }, data: { userId: null } });

  // Groups the user OWNs: `Group.createdById` is FK-less and cascade only removes
  // the user's own GroupMember row, so without this a solely-owned group would be
  // left ownerless (unmanageable). Hand each group off or delete it.
  const ownedGroups = await db.groupMember.findMany({
    where: { userId, role: "OWNER" },
    select: { groupId: true },
  });
  for (const { groupId } of ownedGroups) {
    const successor = await db.groupMember.findFirst({
      where: { groupId, userId: { not: userId } },
      orderBy: { joinedAt: "asc" },
      select: { id: true, userId: true },
    });
    if (successor) {
      // Promote the earliest other member to OWNER and reassign createdById.
      await db.groupMember.update({ where: { id: successor.id }, data: { role: "OWNER" } });
      await db.group.update({ where: { id: groupId }, data: { createdById: successor.userId } });
    } else {
      // Sole member → remove the group and its cascaded categories/budgets/shares.
      await db.group.delete({ where: { id: groupId } });
    }
  }

  // Cascade: User → accounts → transactions/links/tokens/importbatches/budgetlines,
  // categories, budgets, rules, merchant aliases, memberships, sessions, authAccounts, twoFactors,
  // passkeys, preference (all onDelete: Cascade on userId/ownerId).
  await db.user.delete({ where: { id: userId } });

  // Keep a single anonymous "user.deleted" marker (userId null).
  await logEvent({
    userId: null,
    action: "user.deleted",
    entity: "User",
    entityId: userId,
    metadata: { self: true },
  });
}

import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { loadAliases } from "@/server/services/merchants";

export type UserDataExport = {
  exportedAt: string;
  user: { id: string; email: string; name: string | null; createdAt: Date };
  preference: unknown;
  accounts: unknown[];
  transactions: {
    id: string;
    date: Date;
    amount: number;
    type: string;
    label: string;
    note: string | null;
    categoryId: string | null;
    accountId: string;
  }[];
  categories: unknown[];
  rules: unknown[];
  merchantAliases: { merchant: string; name: string }[];
  budgets: unknown[];
  groups: unknown[];
  invitationsSent: unknown[];
  auditLog: unknown[];
};

// Gathers the full data graph a user is entitled to under RGPD, decrypting the
// transaction labels/notes. Read-only. Callers stream the result as JSON.
export async function exportUserData(userId: string): Promise<UserDataExport> {
  const [
    user,
    preference,
    accounts,
    categories,
    rules,
    aliases,
    budgets,
    memberships,
    invitationsSent,
    auditLog,
  ] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    db.userPreference.findUnique({ where: { userId } }),
    db.bankAccount.findMany({ where: { ownerId: userId } }),
    db.category.findMany({ where: { userId } }),
    db.categorizationRule.findMany({ where: { userId } }),
    loadAliases(userId),
    db.budget.findMany({ where: { userId }, include: { lines: true, assignments: true } }),
    db.groupMember.findMany({ where: { userId }, include: { group: true } }),
    db.groupInvitation.findMany({ where: { invitedById: userId } }),
    db.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);

  const accountIds = accounts.map((a) => a.id);
  const txRows = accountIds.length
    ? await db.transaction.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { date: "desc" },
      })
    : [];
  const transactions = txRows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    type: r.type,
    label: decrypt(r.labelEnc, dataKey),
    note: r.noteEnc ? decrypt(r.noteEnc, dataKey) : null,
    categoryId: r.categoryId,
    accountId: r.accountId,
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
    auditLog,
  };
}

// Self-service deletion. The caller must be the user themselves (enforced in the
// action). Cascade FKs remove the owned graph; three FK-less columns are cleaned
// explicitly, and the audit trail is anonymised (retained, userId nulled).
export async function deleteUser(userId: string, _actor: { id: string }): Promise<void> {
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

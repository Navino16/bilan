import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { resetPeriodDatesOfOwner } from "@/server/services/transactions/period-date";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { loadAliases } from "@/server/services/merchants";
import { pageRows, type ListQuery, type ListRow } from "@/server/services/transactions/list-query";
import {
  stepUpMethod,
  stepUpVia,
  type AuditOrigin,
  type StepUpMethod,
  type StepUpSession,
} from "@/server/services/users/step-up";

type ExportedTransaction = {
  id: string;
  date: Date;
  periodDate: Date;
  periodManual: boolean;
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
};

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
  transactions: ExportedTransaction[];
  categories: unknown[];
  rules: unknown[];
  merchantAliases: { merchant: string; name: string }[];
  budgets: unknown[];
  groups: unknown[];
  invitationsSent: unknown[];
  links: { id: string; name: string | null; createdAt: Date; transactionIds: string[] }[];
  ignoredLinkSuggestions: {
    transactionIds: string[];
    ignoredAt: Date;
    restoredAt: Date | null;
  }[];
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

// The export carries clear IBANs, so it takes the same step-up as revealing one (#257).
export async function exportOwnData(
  session: StepUpSession,
  origin: AuditOrigin,
): Promise<{ ok: true; json: AsyncGenerator<string> } | { ok: false; method: StepUpMethod }> {
  const via = await stepUpVia(session);
  if (!via) return { ok: false, method: await stepUpMethod(session.userId) };
  const parts = await exportParts(session.userId);
  await logEvent({
    userId: session.userId,
    action: "user.data.exported",
    entity: "User",
    entityId: session.userId,
    ...origin,
    metadata: { via },
  });
  return { ok: true, json: userDataJson(parts) };
}

// Gathers the full data graph a user is entitled to under RGPD (owned accounts
// only), decrypting the IBANs and transaction labels/notes. Read-only.
export async function exportParts(userId: string): Promise<{
  head: Omit<UserDataExport, "transactions">;
  transactionPages: () => AsyncGenerator<ExportedTransaction[]>;
}> {
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
      omit: { tokenEnc: true, tokenHash: true, codeEnc: true, codeHash: true },
    }),
    db.ignoredLinkSuggestion.findMany({
      where: { userId },
      select: { pairKey: true, ignoredAt: true, restoredAt: true },
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
  const pairIds = [...new Set(ignoredRows.flatMap((r) => r.pairKey.split("|")))];
  const [linkRows, batchRows, ownedPairRows] = await Promise.all([
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
    pairIds.length && accountIds.length
      ? db.transaction.findMany({
          where: { id: { in: pairIds }, accountId: { in: accountIds } },
          select: { id: true },
        })
      : [],
  ]);

  // Links, ignored suggestions and imports can span other users' shared accounts:
  // only ids belonging to the exported (owned) accounts are kept (#171).
  const links = linkRows.map((l) => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt,
    transactionIds: l.members.map((m) => m.transactionId),
  }));
  const linkOf = new Map(links.flatMap((l) => l.transactionIds.map((t) => [t, l.id] as const)));
  const txIds = new Set(ownedPairRows.map((t) => t.id));
  const ignoredLinkSuggestions = ignoredRows.flatMap(({ pairKey, ignoredAt, restoredAt }) => {
    const transactionIds = pairKey.split("|").filter((id) => txIds.has(id));
    return transactionIds.length ? [{ transactionIds, ignoredAt, restoredAt }] : [];
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
    head: {
      exportedAt: new Date().toISOString(),
      user,
      preference,
      accounts,
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
    },
    transactionPages: () => ownedTransactionPages(accountIds, linkOf),
  };
}

// Newest first, keyset-paginated so the export never holds the whole history (#301).
async function* ownedTransactionPages(
  accountIds: string[],
  linkOf: Map<string, string>,
): AsyncGenerator<ExportedTransaction[]> {
  if (accountIds.length === 0) return;
  const query: ListQuery = { accountIds, tokenHashes: [], sort: "date-desc", take: 2000, skip: 0 };
  let after: ListRow | undefined;
  for (;;) {
    const rows = await pageRows({ ...query, after });
    if (rows.length > 0) {
      yield rows.map((r) => ({
        id: r.id,
        date: r.date,
        periodDate: r.periodDate,
        periodManual: Boolean(r.periodManual),
        amount: Number(r.amount),
        type: r.type,
        label: decrypt(r.labelEnc, dataKey),
        rawLabel: decrypt(r.rawLabelEnc, dataKey),
        note: r.noteEnc ? decrypt(r.noteEnc, dataKey) : null,
        categoryId: r.categoryId,
        manuallyCategorized: Boolean(r.manuallyCategorized),
        accountId: r.accountId,
        importBatchId: r.importBatchId,
        linkId: linkOf.get(r.id) ?? null,
        externalId: r.externalId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }
    if (rows.length < query.take) return;
    after = rows[rows.length - 1];
  }
}

export async function exportUserData(userId: string): Promise<UserDataExport> {
  return collectUserData(await exportParts(userId));
}

async function collectUserData({ head, transactionPages }: ExportParts): Promise<UserDataExport> {
  const transactions: ExportedTransaction[] = [];
  for await (const page of transactionPages()) transactions.push(...page);
  const { exportedAt, user, preference, accounts, ...rest } = head;
  return { exportedAt, user, preference, accounts, transactions, ...rest };
}

type ExportParts = Awaited<ReturnType<typeof exportParts>>;

// The same document as JSON.stringify(exportUserData(userId)), produced page by page.
export async function* userDataJson({
  head,
  transactionPages,
}: ExportParts): AsyncGenerator<string> {
  const { exportedAt, user, preference, accounts, ...rest } = head;
  yield JSON.stringify({ exportedAt, user, preference, accounts }).slice(0, -1) +
    ',"transactions":[';
  let first = true;
  for await (const page of transactionPages()) {
    yield (first ? "" : ",") + page.map((t) => JSON.stringify(t)).join(",");
    first = false;
  }
  yield "]," + JSON.stringify(rest).slice(1);
}

type Client = Prisma.TransactionClient | PrismaClient;

export type GroupSuccession = {
  groupId: string;
  groupName: string;
  // null → the user is the only member and the group is deleted with them.
  successor: { userId: string; name: string | null; email: string } | null;
  successorIsOwner: boolean;
};

// What happens to each group the user owns when they are deleted: another owner keeps
// it, else the earliest other member is promoted, else the group goes.
export async function groupSuccessions(client: Client, userId: string): Promise<GroupSuccession[]> {
  const owned = await client.groupMember.findMany({
    where: { userId, role: "OWNER" },
    select: {
      group: {
        select: {
          id: true,
          name: true,
          members: {
            where: { userId: { not: userId } },
            orderBy: { joinedAt: "asc" },
            select: { userId: true, role: true, user: { select: { name: true, email: true } } },
          },
        },
      },
    },
  });
  return owned.map(({ group }) => {
    const next = group.members.find((m) => m.role === "OWNER") ?? group.members[0] ?? null;
    return {
      groupId: group.id,
      groupName: group.name,
      successor: next
        ? { userId: next.userId, name: next.user.name, email: next.user.email }
        : null,
      successorIsOwner: next?.role === "OWNER",
    };
  });
}

// Removes the user's whole data graph. Cascade FKs remove the owned graph; FK-less
// columns are cleaned explicitly, and the audit trail is anonymised (retained, userId nulled).
export async function eraseUser(client: Client, userId: string): Promise<void> {
  await client.transactionLink.deleteMany({ where: { createdById: userId } });
  await client.ignoredLinkSuggestion.deleteMany({ where: { userId } });
  await client.auditLog.updateMany({ where: { userId }, data: { userId: null } });

  // `Group.createdById` is FK-less and cascade only removes the user's own membership,
  // so a solely-owned group would be left ownerless without this.
  for (const s of await groupSuccessions(client, userId)) {
    if (!s.successor) {
      await resetPeriodDatesOfOwner({ groupId: s.groupId }, client);
      await client.group.delete({ where: { id: s.groupId } });
      continue;
    }
    if (!s.successorIsOwner) {
      await client.groupMember.update({
        where: { groupId_userId: { groupId: s.groupId, userId: s.successor.userId } },
        data: { role: "OWNER" },
      });
    }
    await client.group.updateMany({
      where: { id: s.groupId, createdById: userId },
      data: { createdById: s.successor.userId },
    });
  }

  await resetPeriodDatesOfOwner({ userId }, client);
  // Cascade: User → accounts → transactions/links/tokens/importbatches/budgetlines,
  // categories, budgets, rules, merchant aliases, memberships, sessions, authAccounts, twoFactors,
  // passkeys, preference (all onDelete: Cascade on userId/ownerId).
  await client.user.delete({ where: { id: userId } });
}

// A self-deletion leaves an anonymous marker; an admin deletion names the admin.
export async function logUserDeleted(userId: string, actor: { id: string }): Promise<void> {
  const self = actor.id === userId;
  await logEvent({
    userId: self ? null : actor.id,
    action: "user.deleted",
    entity: "User",
    entityId: userId,
    metadata: { self },
  });
}

// Unguarded deletion; callers go through users/lifecycle.ts for the super-admin checks.
export async function deleteUser(
  userId: string,
  actor: { id: string } = { id: userId },
): Promise<void> {
  await db.$transaction((tx) => eraseUser(tx, userId), LONG_TX_TIMEOUT);
  await logUserDeleted(userId, actor);
}

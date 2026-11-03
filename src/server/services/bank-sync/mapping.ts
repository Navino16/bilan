import { dayStart, toIsoDay } from "@/lib/period";
import type { MappingChoice } from "@/lib/schemas/bank-sync";
import { db } from "@/server/db";
import { createAccount } from "@/server/services/accounts";
import { logEvent } from "@/server/services/audit";
import type { EnableBankingClient, Psu } from "@/server/services/bank-sync/client";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import { syncConnection, type AccountSyncResult } from "@/server/services/bank-sync/sync";

export type MappingView = {
  connectionId: string;
  aspspName: string;
  accounts: {
    id: string;
    name: string;
    currency: string;
    accountId: string | null;
    syncedElsewhere: boolean;
    defaultSyncFrom: string | null;
  }[];
  // Owned, not archived; `syncedElsewhere` = mapped by another active connection.
  targets: {
    id: string;
    name: string;
    type: string;
    defaultSyncFrom: string | null;
    syncedElsewhere: boolean;
  }[];
};

export type { MappingChoice };

const SYNCED_CURRENCY = "EUR";

async function ownConnection(userId: string, connectionId: string) {
  const connection = await db.bankConnection.findFirst({
    where: { id: connectionId, userId },
    include: { accounts: { orderBy: { id: "asc" } } },
  });
  if (!connection) throw new BankSyncError("NOT_FOUND");
  return connection;
}

// Bilan accounts and IBANs already synced by another active connection (design §Ownership).
async function syncedElsewhere(userId: string, connectionId: string) {
  const links = await db.bankConnectionAccount.findMany({
    where: {
      connectionId: { not: connectionId },
      accountId: { not: null },
      connection: { status: "ACTIVE" },
      OR: [{ connection: { userId } }, { account: { ownerId: userId } }],
    },
    select: { accountId: true, ibanHash: true, connection: { select: { userId: true } } },
  });
  return {
    accountIds: new Set(links.map((l) => l.accountId!)),
    ibanHashes: new Set(
      links.flatMap((l) => (l.ibanHash && l.connection.userId === userId ? [l.ibanHash] : [])),
    ),
  };
}

async function lastTransactionDays(accountIds: string[]): Promise<Map<string, string>> {
  const rows = await db.transaction.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accountIds } },
    _max: { date: true },
  });
  return new Map(rows.flatMap((r) => (r._max.date ? [[r.accountId, toIsoDay(r._max.date)]] : [])));
}

export async function getMappingView(userId: string, connectionId: string): Promise<MappingView> {
  const connection = await ownConnection(userId, connectionId);
  const [owned, elsewhere] = await Promise.all([
    db.bankAccount.findMany({
      where: { ownerId: userId, archived: false },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
    syncedElsewhere(userId, connectionId),
  ]);
  const lastDays = await lastTransactionDays(owned.map((a) => a.id));
  return {
    connectionId: connection.id,
    aspspName: connection.aspspName,
    accounts: connection.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      accountId: a.accountId,
      syncedElsewhere: a.ibanHash !== null && elsewhere.ibanHashes.has(a.ibanHash),
      defaultSyncFrom: (a.accountId && lastDays.get(a.accountId)) || null,
    })),
    targets: owned.map((t) => ({
      ...t,
      defaultSyncFrom: lastDays.get(t.id) ?? null,
      syncedElsewhere: elsewhere.accountIds.has(t.id),
    })),
  };
}

type Planned = {
  linkId: string;
  accountId: string | null;
  create: { name: string } | null;
  syncFrom: Date | null;
  remapped: boolean;
};

// Every choice is checked before anything is written or fetched.
async function plan(
  userId: string,
  connection: Awaited<ReturnType<typeof ownConnection>>,
  choices: MappingChoice[],
): Promise<Planned[]> {
  const links = new Map(connection.accounts.map((a) => [a.id, a]));
  const mapIds = choices.flatMap((c) => (c.action === "MAP" ? [c.accountId] : []));
  const [writable, elsewhere, lastDays] = await Promise.all([
    db.bankAccount.findMany({
      where: { id: { in: mapIds }, ownerId: userId, archived: false },
      select: { id: true },
    }),
    syncedElsewhere(userId, connection.id),
    lastTransactionDays(mapIds),
  ]);
  const owned = new Set(writable.map((a) => a.id));
  const seen = new Set<string>();
  const seenLinks = new Set<string>();
  return choices.map((c) => {
    const link = links.get(c.connectionAccountId);
    if (!link || seenLinks.has(link.id)) throw new BankSyncError("NOT_FOUND");
    seenLinks.add(link.id);
    if (c.action === "IGNORE") {
      return { linkId: link.id, accountId: null, create: null, syncFrom: null, remapped: true };
    }
    if (link.currency !== SYNCED_CURRENCY) throw new BankSyncError("UNSUPPORTED_CURRENCY");
    if (link.ibanHash && elsewhere.ibanHashes.has(link.ibanHash)) {
      throw new BankSyncError("ALREADY_SYNCED");
    }
    if (c.action === "CREATE") {
      return {
        linkId: link.id,
        accountId: null,
        create: { name: c.name },
        syncFrom: c.syncFrom ? dayStart(c.syncFrom) : null,
        remapped: true,
      };
    }
    if (!owned.has(c.accountId)) throw new BankSyncError("FORBIDDEN");
    if (elsewhere.accountIds.has(c.accountId) || seen.has(c.accountId)) {
      throw new BankSyncError("ALREADY_SYNCED");
    }
    seen.add(c.accountId);
    const day = c.syncFrom ?? lastDays.get(c.accountId);
    return {
      linkId: link.id,
      accountId: c.accountId,
      create: null,
      syncFrom: day ? dayStart(day) : null,
      remapped: link.accountId !== c.accountId,
    };
  });
}

// Writes the mapping, then runs the user-present initial fetch (design §Connect flow 4-6).
export async function saveBankMapping(
  userId: string,
  connectionId: string,
  choices: MappingChoice[],
  opts: { psu: Psu; now?: Date; client?: EnableBankingClient },
): Promise<{ accounts: (AccountSyncResult & { name: string })[] }> {
  const connection = await ownConnection(userId, connectionId);
  const planned = await plan(userId, connection, choices);

  const openingBalanceFor: string[] = [];
  for (const p of planned) {
    if (p.create) {
      p.accountId = (
        await createAccount(
          { name: p.create.name, type: "CHECKING", bankName: connection.aspspName },
          userId,
        )
      ).id;
      openingBalanceFor.push(p.accountId);
    } else if (p.accountId) {
      const earlier = await db.transaction.count({
        where: { accountId: p.accountId, ...(p.syncFrom && { date: { lt: p.syncFrom } }) },
      });
      if (earlier === 0) openingBalanceFor.push(p.accountId);
    }
  }
  await db.$transaction(
    planned.map((p) =>
      db.bankConnectionAccount.update({
        where: { id: p.linkId },
        data: {
          accountId: p.accountId,
          syncFrom: p.syncFrom,
          ...(p.remapped && { lastSyncedDate: null }),
        },
      }),
    ),
  );
  const mapped = planned.flatMap((p) => (p.accountId ? [p.accountId] : []));
  await logEvent({
    userId,
    action: "bank_sync.mapping.saved",
    entity: "BankConnection",
    entityId: connectionId,
    metadata: { mapped: mapped.length, ignored: planned.length - mapped.length },
  });
  if (mapped.length === 0) return { accounts: [] };

  const result = await syncConnection(connectionId, {
    psu: opts.psu,
    now: opts.now,
    client: opts.client,
    accountIds: mapped,
    openingBalanceFor,
  });
  if (result.status === "BUSY") throw new BankSyncError("BUSY");
  if (result.status === "FAILED") throw new BankSyncError(result.code);
  const names = new Map(
    (
      await db.bankAccount.findMany({
        where: { id: { in: mapped } },
        select: { id: true, name: true },
      })
    ).map((a) => [a.id, a.name]),
  );
  return { accounts: result.accounts.map((r) => ({ ...r, name: names.get(r.accountId) ?? "" })) };
}

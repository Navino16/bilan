import type { BankConnectionAccount } from "@prisma/client";
import { round2 } from "@/lib/budgets";
import type { BalanceAdjustment } from "@/lib/import-status";
import { dayStart, isValidIsoDay, toIsoDay } from "@/lib/period";
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import {
  EnableBankingError,
  type BankSyncErrorCode,
  type EnableBankingClient,
  type Psu,
} from "@/server/services/bank-sync/client";
import { bankSyncClient } from "@/server/services/bank-sync/config";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import { pickBalances, syncWindowStart, toSyncRows } from "@/server/services/bank-sync/rows";
import type { EbTransaction } from "@/server/services/bank-sync/types";
import { finalizeBatch, insertRows } from "@/server/services/imports/commit";
import { computeExternalIds } from "@/server/services/transactions/secure-fields";

export const SYNC_CLAIM_STALE_MS = 30 * 60_000;

export type AccountSyncResult = { accountId: string; imported: number; skipped: number };
export type ConnectionSyncResult =
  | { status: "OK"; accounts: AccountSyncResult[] }
  | { status: "BUSY" }
  | { status: "FAILED"; code: BankSyncErrorCode };

type SyncLink = BankConnectionAccount & { connection: { userId: string } };

const MAX_FETCH_ROUNDS = 4;

const dayOf = (t: EbTransaction): string | null => {
  const day = t.booking_date ?? t.value_date;
  return isValidIsoDay(day) ? day : null;
};

function dayRange(txs: EbTransaction[]): { first: string; last: string } | null {
  const days = txs.flatMap((t) => dayOf(t) ?? []);
  return days.length ? { first: days[0], last: days[days.length - 1] } : null;
}

// Banks page oldest first: a fetch cut at MAX_TRANSACTION_PAGES resumes from its last day,
// whose rows may be partial, so they are fetched again whole. Newest first can't resume.
async function fetchTransactions(
  client: EnableBankingClient,
  uid: string,
  from: string,
  psu: Psu | undefined,
): Promise<{ transactions: EbTransaction[]; truncated: boolean; resumeDay: string | null }> {
  const kept: EbTransaction[] = [];
  let start = from;
  for (let round = 1; ; round++) {
    const page = await client.listTransactions(uid, start, psu);
    const range = dayRange(page.transactions);
    if (!page.truncated) {
      return { transactions: [...kept, ...page.transactions], truncated: false, resumeDay: null };
    }
    const ascending = range !== null && range.first <= range.last;
    if (!ascending || range.last <= start || round === MAX_FETCH_ROUNDS) {
      console.warn("[bilan] bank history truncated");
      return {
        transactions: [...kept, ...page.transactions],
        truncated: true,
        resumeDay: ascending ? range.last : null,
      };
    }
    const resume = range.last;
    kept.push(...page.transactions.filter((t) => (dayOf(t) ?? "") < resume));
    start = resume;
  }
}

// Opening balance of an account that starts with the sync (design §Connect flow 6).
async function openingAdjustment(
  accountId: string,
  booked: { amount: number; date: Date },
): Promise<BalanceAdjustment | null> {
  const [account, sum] = await Promise.all([
    db.bankAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { initialBalance: true },
    }),
    db.transaction.aggregate({
      where: { accountId, date: { lte: booked.date } },
      _sum: { amount: true },
    }),
  ]);
  const previous = Number(account.initialBalance);
  const set = round2(booked.amount - Number(sum._sum.amount ?? 0));
  return set === previous ? null : { accountId, previous, set };
}

async function writeOpeningBalance(userId: string, a: BalanceAdjustment): Promise<void> {
  await db.bankAccount.update({ where: { id: a.accountId }, data: { initialBalance: a.set } });
  await logEvent({
    userId,
    action: "account.initial_balance_adjusted",
    entity: "BankAccount",
    entityId: a.accountId,
    metadata: { previous: a.previous, set: a.set },
  });
}

async function discardUncommitted(batchId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (batch?.status !== "COMMITTING") return;
    await tx.transaction.deleteMany({ where: { importBatchId: batchId } });
    await tx.importBatch.delete({ where: { id: batchId } });
  }, LONG_TX_TIMEOUT);
}

export async function syncAccount(
  client: EnableBankingClient,
  link: SyncLink,
  opts: { psu?: Psu; now?: Date; openingBalance?: boolean },
): Promise<AccountSyncResult> {
  const accountId = link.accountId;
  if (!accountId) throw new BankSyncError("NOT_FOUND");
  const now = opts.now ?? new Date();
  const userId = link.connection.userId;
  const uid = decrypt(link.uidEnc, dataKey);

  const balances = pickBalances(await client.balances(uid, opts.psu), now);
  const fetched = await fetchTransactions(client, uid, syncWindowStart(link, now), opts.psu);
  const { rows, pendingCount, pendingTotal } = toSyncRows(fetched.transactions);

  let imported = 0;
  let skipped = 0;
  const actor = { id: userId };
  const withOpening = opts.openingBalance && balances.booked && !fetched.truncated;
  if (rows.length > 0) {
    const tombstones = await db.syncTombstone.findMany({
      where: { accountId, externalId: { in: computeExternalIds(rows) } },
      select: { externalId: true },
    });
    const batch = await db.importBatch.create({
      data: { accountId, source: "SYNC", status: "COMMITTING", createdById: userId },
    });
    try {
      const totals = await insertRows({ batchId: batch.id, accountId }, rows, actor, {
        excludedIds: tombstones.map((t) => t.externalId),
      });
      ({ imported, skipped } = totals);
      if (imported === 0) {
        await db.importBatch.delete({ where: { id: batch.id } });
      } else {
        const opening = withOpening ? await openingAdjustment(accountId, balances.booked!) : null;
        await finalizeBatch(batch.id, totals, actor, [accountId], {
          balanceAdjustments: opening ? [opening] : [],
        });
      }
    } catch (e) {
      // purge-imports drops a batch left COMMITTING if this cleanup fails too.
      await discardUncommitted(batch.id).catch(() => {});
      throw e;
    }
  }
  if (withOpening && imported === 0) {
    const opening = await openingAdjustment(accountId, balances.booked!);
    if (opening) await writeOpeningBalance(userId, opening);
  }

  const today = dayStart(toIsoDay(now));
  let lastSyncedDate = fetched.truncated
    ? fetched.resumeDay
      ? dayStart(fetched.resumeDay)
      : link.lastSyncedDate
    : today;
  if (lastSyncedDate && lastSyncedDate > today) lastSyncedDate = today;
  // A link remapped meanwhile starts over on its new account.
  await db.bankConnectionAccount.updateMany({
    where: { id: link.id, accountId },
    data: {
      ...(balances.booked && {
        bookedBalance: balances.booked.amount,
        bookedBalanceDate: balances.booked.date,
      }),
      ...(balances.expected && {
        expectedBalance: balances.expected.amount,
        expectedBalanceDate: balances.expected.date,
      }),
      pendingCount,
      pendingTotal,
      lastSyncedDate,
    },
  });
  return { accountId, imported, skipped };
}

// One sync per connection at a time: the claim is a timestamp, taken over once stale (design §Sync engine).
export async function syncConnection(
  connectionId: string,
  opts: {
    psu?: Psu;
    now?: Date;
    client?: EnableBankingClient;
    accountIds?: string[];
    openingBalanceFor?: string[];
  } = {},
): Promise<ConnectionSyncResult> {
  const now = opts.now ?? new Date();
  const client = opts.client ?? (await bankSyncClient());
  if (!client) throw new BankSyncError("UNAVAILABLE");
  const claim = await db.bankConnection.updateMany({
    where: {
      id: connectionId,
      OR: [
        { syncStartedAt: null },
        { syncStartedAt: { lt: new Date(now.getTime() - SYNC_CLAIM_STALE_MS) } },
      ],
    },
    data: { syncStartedAt: now },
  });
  if (claim.count === 0) {
    const exists = await db.bankConnection.count({ where: { id: connectionId } });
    if (exists === 0) throw new BankSyncError("NOT_FOUND");
    return { status: "BUSY" };
  }

  try {
    const links = await db.bankConnectionAccount.findMany({
      where: {
        connectionId,
        accountId: opts.accountIds ? { in: opts.accountIds } : { not: null },
      },
      include: { connection: { select: { userId: true } } },
      orderBy: { id: "asc" },
    });
    const accounts: AccountSyncResult[] = [];
    for (const link of links) {
      accounts.push(
        await syncAccount(client, link, {
          psu: opts.psu,
          now,
          openingBalance: opts.openingBalanceFor?.includes(link.accountId!) ?? false,
        }),
      );
    }
    await db.bankConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: now, lastError: null },
    });
    return { status: "OK", accounts };
  } catch (e) {
    if (!(e instanceof EnableBankingError)) throw e;
    await db.bankConnection.update({ where: { id: connectionId }, data: { lastError: e.code } });
    return { status: "FAILED", code: e.code };
  } finally {
    await db.bankConnection.updateMany({
      where: { id: connectionId, syncStartedAt: now },
      data: { syncStartedAt: null },
    });
  }
}

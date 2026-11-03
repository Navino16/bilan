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
import {
  BANK_SYNC_SINGLETON_ID,
  bankSyncClient,
  getBankSyncConfig,
} from "@/server/services/bank-sync/config";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import { pickBalances, syncWindowStart, toSyncRows } from "@/server/services/bank-sync/rows";
import type { EbTransaction } from "@/server/services/bank-sync/types";
import { finalizeBatch, insertRows } from "@/server/services/imports/commit";
import { computeExternalIds } from "@/server/services/transactions/secure-fields";

export const SYNC_CLAIM_STALE_MS = 30 * 60_000;
export const RATE_LIMIT_BACKOFF_MS = 6 * 3600_000;
export const ERROR_THRESHOLD = 3;
export const FAILURE_BACKOFF_MS = 3 * 3600_000;
export const SYNC_ACCOUNT_CONCURRENCY = 2;
// The cron fires at a fixed minute: a sync stamped a few seconds into it is due again N hours later.
const DUE_SLACK_MS = 5 * 60_000;

// `truncated`: the bank still had pages when the fetch stopped (design §Sync engine).
export type AccountSyncResult = {
  accountId: string;
  imported: number;
  skipped: number;
  truncated: boolean;
};
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
  return { accountId, imported, skipped, truncated: fetched.truncated };
}

// Codes that end the whole connection's run: other accounts would get the same answer.
const STOPS_CONNECTION: BankSyncErrorCode[] = ["RATE_LIMITED", "EXPIRED_SESSION"];
const stopsConnection = (e: unknown) =>
  e instanceof EnableBankingError && STOPS_CONNECTION.includes(e.code);

// Starts nothing new after a stopping error; any other error lets the remaining items run first.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  let failure = null as { error: unknown } | null;
  async function worker(): Promise<void> {
    while (!(failure && stopsConnection(failure.error)) && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]);
      } catch (error) {
        if (!failure || (stopsConnection(error) && !stopsConnection(failure.error))) {
          failure = { error };
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw failure.error;
  return results;
}

type ConnectionState = { userId: string; validUntil: Date; failureCount: number };

async function markExpired(connectionId: string, conn: ConnectionState, live: string[]) {
  const { count } = await db.bankConnection.updateMany({
    where: { id: connectionId, status: { in: live } },
    data: { status: "EXPIRED", lastError: "EXPIRED_SESSION" },
  });
  if (count === 0) return;
  await logEvent({
    userId: conn.userId,
    action: "bank_sync.connection.expired",
    entity: "BankConnection",
    entityId: connectionId,
  });
}

// Instance-wide: the admin's configuration or Enable Banking itself, not this connection.
const INSTANCE_ERRORS: BankSyncErrorCode[] = ["APP_INACTIVE", "UNAUTHORIZED", "NETWORK"];

// Lifecycle of a failed sync (design §Sync engine): a rate limit backs off, an expired consent
// stops the connection, a connection error backs off longer each time and counts towards ERROR.
async function recordFailure(
  connectionId: string,
  conn: ConnectionState,
  live: string[],
  code: BankSyncErrorCode,
  now: Date,
): Promise<void> {
  if (code === "EXPIRED_SESSION") return markExpired(connectionId, conn, live);
  if (code === "RATE_LIMITED") {
    await db.bankConnection.updateMany({
      where: { id: connectionId, status: { in: live } },
      data: { lastError: code, retryAfter: new Date(now.getTime() + RATE_LIMIT_BACKOFF_MS) },
    });
    await db.bankSyncConfig.updateMany({
      where: { id: BANK_SYNC_SINGLETON_ID },
      data: { lastRateLimitedAt: now },
    });
    return;
  }
  if (INSTANCE_ERRORS.includes(code)) {
    await db.bankConnection.updateMany({
      where: { id: connectionId, status: { in: live } },
      data: { lastError: code },
    });
    return;
  }
  const failureCount = conn.failureCount + 1;
  await db.bankConnection.updateMany({
    where: { id: connectionId, status: { in: live } },
    data: {
      lastError: code,
      failureCount,
      retryAfter: new Date(now.getTime() + failureCount * FAILURE_BACKOFF_MS),
      ...(failureCount >= ERROR_THRESHOLD && { status: "ERROR" }),
    },
  });
}

// One sync per connection at a time: the claim is a timestamp, taken over once stale (design §Sync engine).
// An ERROR connection is only retried when `allowError` (Sync now).
export async function syncConnection(
  connectionId: string,
  opts: {
    psu?: Psu;
    now?: Date;
    client?: EnableBankingClient;
    accountIds?: string[];
    openingBalanceFor?: string[];
    allowError?: boolean;
  } = {},
): Promise<ConnectionSyncResult> {
  const now = opts.now ?? new Date();
  const client = opts.client ?? (await bankSyncClient());
  if (!client) throw new BankSyncError("UNAVAILABLE");
  const live = opts.allowError ? ["ACTIVE", "ERROR"] : ["ACTIVE"];
  const claim = await db.bankConnection.updateMany({
    where: {
      id: connectionId,
      status: { in: live },
      OR: [
        { syncStartedAt: null },
        { syncStartedAt: { lt: new Date(now.getTime() - SYNC_CLAIM_STALE_MS) } },
      ],
    },
    data: { syncStartedAt: now },
  });
  if (claim.count === 0) {
    const current = await db.bankConnection.findUnique({
      where: { id: connectionId },
      select: { status: true },
    });
    if (current?.status === "EXPIRED") throw new BankSyncError("EXPIRED_SESSION");
    if (!current || !live.includes(current.status)) throw new BankSyncError("NOT_FOUND");
    return { status: "BUSY" };
  }

  const conn = await db.bankConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { userId: true, validUntil: true, failureCount: true },
  });
  try {
    if (conn.validUntil <= now) {
      await markExpired(connectionId, conn, live);
      return { status: "FAILED", code: "EXPIRED_SESSION" };
    }
    const links = await db.bankConnectionAccount.findMany({
      where: {
        connectionId,
        accountId: opts.accountIds ? { in: opts.accountIds } : { not: null },
      },
      include: { connection: { select: { userId: true } } },
      orderBy: { id: "asc" },
    });
    const accounts = await mapLimit(links, SYNC_ACCOUNT_CONCURRENCY, (link) =>
      syncAccount(client, link, {
        psu: opts.psu,
        now,
        openingBalance: opts.openingBalanceFor?.includes(link.accountId!) ?? false,
      }),
    );
    await db.bankConnection.updateMany({
      where: { id: connectionId, status: { in: live } },
      data: {
        status: "ACTIVE",
        lastSyncAt: now,
        lastError: null,
        failureCount: 0,
        retryAfter: null,
      },
    });
    return { status: "OK", accounts };
  } catch (e) {
    if (!(e instanceof EnableBankingError)) throw e;
    await recordFailure(connectionId, conn, live, e.code, now);
    return { status: "FAILED", code: e.code };
  } finally {
    await db.bankConnection.updateMany({
      where: { id: connectionId, syncStartedAt: now },
      data: { syncStartedAt: null },
    });
  }
}

export type DueSyncSummary = {
  due: number;
  synced: number;
  busy: number;
  rateLimited: number;
  expired: number;
  failed: number;
  imported: number;
  truncated: number;
};

// The cron's run: background syncs, one connection after the other (design §Sync engine).
export async function syncDueConnections(
  now: Date,
  opts: { client?: EnableBankingClient } = {},
): Promise<DueSyncSummary> {
  const summary: DueSyncSummary = {
    due: 0,
    synced: 0,
    busy: 0,
    rateLimited: 0,
    expired: 0,
    failed: 0,
    imported: 0,
    truncated: 0,
  };
  const cfg = await getBankSyncConfig();
  if (!cfg?.enabled) return summary;
  const syncedBefore = new Date(now.getTime() - cfg.syncIntervalHours * 3600_000 + DUE_SLACK_MS);
  const due = await db.bankConnection.findMany({
    where: {
      status: "ACTIVE",
      accounts: { some: { accountId: { not: null } } },
      AND: [
        { OR: [{ retryAfter: null }, { retryAfter: { lte: now } }] },
        {
          OR: [
            { lastSyncAt: null },
            { lastSyncAt: { lte: syncedBefore } },
            { validUntil: { lte: now } },
          ],
        },
      ],
    },
    select: { id: true },
    orderBy: [{ lastSyncAt: "asc" }, { id: "asc" }],
  });
  summary.due = due.length;
  if (due.length === 0) return summary;
  const client = opts.client ?? (await bankSyncClient());
  if (!client) return summary;

  for (const { id } of due) {
    try {
      const result = await syncConnection(id, { now, client });
      if (result.status === "OK") {
        summary.synced++;
        for (const a of result.accounts) {
          summary.imported += a.imported;
          if (a.truncated) summary.truncated++;
        }
      } else if (result.status === "BUSY") summary.busy++;
      else if (result.code === "RATE_LIMITED") summary.rateLimited++;
      else if (result.code === "EXPIRED_SESSION") summary.expired++;
      else summary.failed++;
    } catch (e) {
      summary.failed++;
      console.error(
        "[bilan] bank sync failed",
        e instanceof BankSyncError ? e.code : e instanceof Error ? e.name : typeof e,
      );
    }
  }
  return summary;
}

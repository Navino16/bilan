import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const failFinalize = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/services/imports/commit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/services/imports/commit")>();
  return {
    ...real,
    finalizeBatch: (...args: Parameters<typeof real.finalizeBatch>) =>
      failFinalize.on ? Promise.reject(new Error("boom")) : real.finalizeBatch(...args),
  };
});
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { createEnableBankingClient } from "@/server/services/bank-sync/client";
import { SYNC_CLAIM_STALE_MS, syncAccount, syncConnection } from "@/server/services/bank-sync/sync";
import { createRule } from "@/server/services/categorization";
import { insertRows, finalizeBatch } from "@/server/services/imports/commit";
import {
  recategorizeTransaction,
  setTransactionMonth,
  updateTransaction,
} from "@/server/services/transactions";
import { deleteTransactions } from "@/server/services/transactions/delete";
import {
  clearBankSyncConfig,
  fakeEnableBanking,
  fakeTx,
  seedBankSyncConfig,
  testKeyPair,
  type FakeBank,
} from "../fixtures/enable-banking";
import type { EbBalance, EbTransaction } from "@/server/services/bank-sync/types";

const owner = "bss_owner";
const now = new Date("2026-11-03T10:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let courant: string;
let cafe: string;
let other: string;
let ruleId: string;
let connectionId: string;
let linkId: string;
let fake: FakeBank;
let client: ReturnType<typeof createEnableBankingClient>;

function bankReturns(txs: EbTransaction[], balances: EbBalance[] = []) {
  fake.on("GET", /\/transactions$/, { body: { transactions: txs } });
  fake.on("GET", /\/balances$/, { body: { balances } });
}

const sync = (o: Parameters<typeof syncConnection>[1] = {}) =>
  syncConnection(connectionId, { client, now, ...o });

const rowsOf = () =>
  db.transaction.findMany({ where: { accountId: courant }, orderBy: [{ date: "asc" }] });

const txCalls = () => fake.calls.filter((c) => c.path.endsWith("/transactions"));

beforeAll(async () => {
  await db.user.create({ data: { id: owner, email: "bss-owner@bilan.local" } });
  courant = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  cafe = (await db.category.create({ data: { name: "Cafe", userId: owner } })).id;
  other = (await db.category.create({ data: { name: "Other", userId: owner } })).id;
  ruleId = (
    await createRule(
      { pattern: "CAFE", matchType: "CONTAINS", priority: 100, categoryId: cafe },
      { id: owner },
    )
  ).id;
  const conn = await db.bankConnection.create({
    data: {
      userId: owner,
      aspspName: "Banque Fictive",
      aspspCountry: "FR",
      sessionIdEnc: encrypt("sess-fake-1", dataKey),
      validUntil: day("2027-05-02"),
      accounts: {
        create: {
          uidEnc: encrypt("uid-fake-a", dataKey),
          name: "Compte Courant Test",
          currency: "EUR",
          accountId: courant,
          syncFrom: day("2026-10-01"),
        },
      },
    },
    include: { accounts: true },
  });
  connectionId = conn.id;
  linkId = conn.accounts[0].id;
  await seedBankSyncConfig();
});

beforeEach(async () => {
  fake = fakeEnableBanking();
  client = createEnableBankingClient({
    applicationId: "app-test-id",
    privateKeyPem: testKeyPair().privateKeyPem,
    fetch: fake.fetch,
  });
  await db.transaction.deleteMany({ where: { accountId: courant } });
  await db.importBatch.deleteMany({ where: { accountId: courant } });
  await db.syncTombstone.deleteMany({ where: { accountId: courant } });
  await db.bankAccount.update({ where: { id: courant }, data: { initialBalance: 0 } });
  await db.bankConnection.update({
    where: { id: connectionId },
    data: {
      status: "ACTIVE",
      syncStartedAt: null,
      lastSyncAt: null,
      lastError: null,
      failureCount: 0,
      retryAfter: null,
    },
  });
  await db.bankConnectionAccount.update({
    where: { id: linkId },
    data: {
      syncFrom: day("2026-10-01"),
      lastSyncedDate: null,
      bookedBalance: null,
      bookedBalanceDate: null,
      expectedBalance: null,
      expectedBalanceDate: null,
      pendingCount: 0,
      pendingTotal: 0,
    },
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await clearBankSyncConfig();
  await db.$disconnect();
});

describe("syncConnection", () => {
  it("imports booked rows through a SYNC batch like an import", async () => {
    bankReturns(
      [
        fakeTx({ date: "2026-10-05", amount: -12.5, label: "CB CAFE TEST" }),
        fakeTx({ date: "2026-10-06", amount: 1500, label: "VIR SALAIRE TEST" }),
        fakeTx({ date: "2026-11-02", amount: -35.4, label: "CB ATTENTE TEST", status: "PDNG" }),
      ],
      [
        {
          balance_type: "CLBD",
          balance_amount: { amount: "1234.56", currency: "EUR" },
          reference_date: "2026-10-31",
        },
        { balance_type: "XPCD", balance_amount: { amount: "1200.00", currency: "EUR" } },
      ],
    );
    const res = await sync();
    expect(res).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 2, skipped: 0, truncated: false }],
    });

    const batches = await db.importBatch.findMany({ where: { accountId: courant } });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ source: "SYNC", status: "COMPLETED", importedRows: 2 });
    expect((batches[0].metadata as { ruleHits?: object }).ruleHits).toEqual({ [ruleId]: 1 });

    const [coffee, salary] = await rowsOf();
    expect(coffee).toMatchObject({ categoryId: cafe, type: "CARD", importBatchId: batches[0].id });
    expect(Number(coffee.amount)).toBe(-12.5);
    expect(Number(salary.amount)).toBe(1500);
    expect(
      await db.transactionSearchToken.count({ where: { transactionId: coffee.id } }),
    ).toBeGreaterThan(0);

    const link = await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: linkId } });
    expect(Number(link.bookedBalance)).toBe(1234.56);
    expect(link.bookedBalanceDate).toEqual(day("2026-10-31"));
    expect(Number(link.expectedBalance)).toBe(1200);
    expect(link.expectedBalanceDate).toEqual(day("2026-11-03"));
    expect(link.pendingCount).toBe(1);
    expect(Number(link.pendingTotal)).toBe(-35.4);
    expect(link.lastSyncedDate).toEqual(day("2026-11-03"));
    const conn = await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(conn.lastSyncAt).toEqual(now);
    expect(conn.syncStartedAt).toBeNull();
    expect(txCalls()[0].query.get("date_from")).toBe("2026-10-01");

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "import.committed", entityId: batches[0].id },
    });
    expect(audit.metadata).toEqual({ imported: 2, skipped: 0, total: 2 });
  });

  it("a sync with nothing new leaves no batch", async () => {
    bankReturns([fakeTx({ date: "2026-10-05", amount: -12.5, label: "CB CAFE TEST" })]);
    await sync();
    const res = await sync();
    expect(res).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 0, skipped: 1, truncated: false }],
    });
    expect(await db.importBatch.count({ where: { accountId: courant } })).toBe(1);

    bankReturns([]);
    expect(await sync()).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 0, skipped: 0, truncated: false }],
    });
    expect(await db.importBatch.count({ where: { accountId: courant } })).toBe(1);
  });

  it("keeps same-day twins once each across overlapping syncs", async () => {
    const twin = fakeTx({ date: "2026-10-20", amount: -2.5, label: "CB CAFE TEST" });
    bankReturns([twin, twin]);
    await sync({ now: new Date("2026-10-22T10:00:00.000Z") });
    expect(await rowsOf()).toHaveLength(2);

    bankReturns([
      twin,
      twin,
      fakeTx({ date: "2026-10-21", amount: -8, label: "CB BOULANGERIE TEST" }),
    ]);
    fake.calls.length = 0;
    await sync();
    expect(txCalls()[0].query.get("date_from")).toBe("2026-10-15");
    const rows = await rowsOf();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => Number(r.amount)).sort()).toEqual([-2.5, -2.5, -8].sort());
  });

  it("skips a booked row already imported from a file under another label", async () => {
    const batch = await db.importBatch.create({
      data: { accountId: courant, source: "CSV", status: "COMMITTING", createdById: owner },
    });
    const csv = [{ date: day("2026-10-15"), amount: -42, rawLabel: "PRLV TEST ENERGIE" }];
    const totals = await insertRows({ batchId: batch.id, accountId: courant }, csv, { id: owner });
    await finalizeBatch(batch.id, totals, { id: owner }, [courant]);

    bankReturns([
      fakeTx({ date: "2026-10-15", amount: -42, label: "PRELEVEMENT TEST ENERGIE REF 99" }),
    ]);
    expect(await sync()).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 0, skipped: 1, truncated: false }],
    });
    expect(await rowsOf()).toHaveLength(1);

    bankReturns([
      fakeTx({ date: "2026-10-15", amount: -42, label: "PRELEVEMENT TEST ENERGIE REF 99" }),
      fakeTx({ date: "2026-10-15", amount: -42, label: "PRLV AUTRE TEST" }),
    ]);
    expect(await sync()).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 1, skipped: 1, truncated: false }],
    });
    expect(await rowsOf()).toHaveLength(2);
  });

  it("never re-inserts a deleted synced row", async () => {
    const row = fakeTx({ date: "2026-10-05", amount: -12.5, label: "CB CAFE TEST" });
    bankReturns([row]);
    await sync();
    const [synced] = await rowsOf();
    await deleteTransactions(owner, [synced.id]);
    expect(
      await db.syncTombstone.findUnique({
        where: { accountId_externalId: { accountId: courant, externalId: synced.externalId! } },
      }),
    ).not.toBeNull();

    expect(await sync()).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 0, skipped: 0, truncated: false }],
    });
    expect(await rowsOf()).toHaveLength(0);
  });

  it("never re-inserts the second of two same-day twins once deleted", async () => {
    const twin = fakeTx({ date: "2026-10-20", amount: -2.5, label: "CB CAFE TEST" });
    bankReturns([twin, twin]);
    await sync();
    const [, second] = await db.transaction.findMany({
      where: { accountId: courant },
      orderBy: { createdAt: "asc" },
    });
    await deleteTransactions(owner, [second.id]);
    await sync();
    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(second.id);
  });

  it("leaves no batch nor row behind when an import step fails", async () => {
    bankReturns([fakeTx({ date: "2026-10-05", amount: -12.5, label: "CB CAFE TEST" })]);
    failFinalize.on = true;
    try {
      await expect(sync()).rejects.toThrow("boom");
    } finally {
      failFinalize.on = false;
    }
    expect(await rowsOf()).toHaveLength(0);
    expect(await db.importBatch.count({ where: { accountId: courant } })).toBe(0);
    const conn = await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(conn.syncStartedAt).toBeNull();
  });

  it("does not stamp a link remapped while its sync ran", async () => {
    const stale = await db.bankConnectionAccount.findUniqueOrThrow({
      where: { id: linkId },
      include: { connection: { select: { userId: true, aspspName: true } } },
    });
    const elsewhere = await db.bankAccount.create({
      data: { ownerId: owner, name: "Elsewhere", type: "CHECKING" },
    });
    await db.bankConnectionAccount.update({
      where: { id: linkId },
      data: { accountId: elsewhere.id },
    });
    try {
      await syncAccount(client, stale, { now });
      const link = await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: linkId } });
      expect(link.lastSyncedDate).toBeNull();
    } finally {
      await db.bankConnectionAccount.update({
        where: { id: linkId },
        data: { accountId: courant },
      });
      await db.bankAccount.delete({ where: { id: elsewhere.id } });
    }
  });

  it("leaves rows the user edited untouched", async () => {
    const row = fakeTx({ date: "2026-10-05", amount: -12.5, label: "CB CAFE TEST" });
    bankReturns([row]);
    await sync();
    const [synced] = await rowsOf();
    await recategorizeTransaction(synced.id, other, { id: owner });
    await updateTransaction(
      synced.id,
      { label: "Cafe du coin", note: "with a friend" },
      { id: owner },
    );
    await setTransactionMonth(synced.id, { year: 2026, month: 9 }, { id: owner });
    const [edited] = await rowsOf();

    await sync();
    const after = await rowsOf();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      categoryId: other,
      noteEnc: edited.noteEnc,
      labelEnc: edited.labelEnc,
      periodDate: edited.periodDate,
      updatedAt: edited.updatedAt,
    });
  });

  it("a second sync of one connection while one runs is BUSY", async () => {
    await db.bankConnection.update({ where: { id: connectionId }, data: { syncStartedAt: now } });
    expect(await sync()).toEqual({ status: "BUSY" });
    expect(fake.calls).toHaveLength(0);

    await db.bankConnection.update({
      where: { id: connectionId },
      data: { syncStartedAt: new Date(now.getTime() - SYNC_CLAIM_STALE_MS - 60_000) },
    });
    expect((await sync()).status).toBe("OK");
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(
      (await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).syncStartedAt,
    ).toBeNull();

    const both = await Promise.all([sync(), sync()]);
    expect(both.map((r) => r.status).sort()).toEqual(["BUSY", "OK"]);
  });

  it("refuses a connection that is not active, without any bank call", async () => {
    const refusals = [
      ["REVOKED", "NOT_FOUND"],
      ["EXPIRED", "EXPIRED_SESSION"],
      ["ERROR", "NOT_FOUND"],
    ] as const;
    for (const [status, code] of refusals) {
      await db.bankConnection.update({ where: { id: connectionId }, data: { status } });
      await expect(sync()).rejects.toMatchObject({ code });
    }
    expect(fake.calls).toHaveLength(0);
    await expect(syncConnection("missing", { client, now })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    bankReturns([]);
    expect((await sync({ allowError: true })).status).toBe("OK");
    expect(
      await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } }),
    ).toMatchObject({ status: "ACTIVE", failureCount: 0, syncStartedAt: null });
  });

  it("sends the PSU headers only for a user-present sync", async () => {
    await sync();
    for (const c of fake.calls) expect(c.headers.get("psu-ip-address")).toBeNull();
    fake.calls.length = 0;
    await sync({ psu: { ip: "203.0.113.7", userAgent: "Test UA" } });
    expect(fake.calls.length).toBe(2);
    for (const c of fake.calls) {
      expect(c.headers.get("psu-ip-address")).toBe("203.0.113.7");
      expect(c.headers.get("psu-user-agent")).toBe("Test UA");
    }
  });

  it("a bank error is recorded as a code", async () => {
    fake.on("GET", /\/transactions$/, { status: 500, body: { message: "uid-fake-a broke" } });
    expect(await sync()).toEqual({ status: "FAILED", code: "HTTP" });
    const conn = await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(conn.lastError).toBe("HTTP");
    expect(conn.lastSyncAt).toBeNull();
    expect(conn.syncStartedAt).toBeNull();
    expect(await db.importBatch.count({ where: { accountId: courant } })).toBe(0);

    bankReturns([]);
    await sync();
    expect(
      (await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } })).lastError,
    ).toBeNull();
  });

  const clbd100 = () =>
    fake.on("GET", /\/balances$/, {
      body: {
        balances: [
          {
            balance_type: "CLBD",
            balance_amount: { amount: "100.00", currency: "EUR" },
            reference_date: "2026-11-02",
          },
        ],
      },
    });

  it("resumes a truncated fetch from its last day until the history is complete", async () => {
    fake.on("GET", /\/transactions$/, (call) => {
      if (call.query.get("date_from") === "2026-10-17") {
        return {
          body: {
            transactions: [
              fakeTx({ date: "2026-10-17", amount: -49, label: "CB PAGE TEST 48" }),
              fakeTx({ date: "2026-10-17", amount: -50, label: "CB PAGE TEST 49" }),
              fakeTx({ date: "2026-10-17", amount: -7, label: "CB PAGE TEST LATE" }),
              fakeTx({ date: "2026-10-18", amount: -8, label: "CB PAGE TEST NEXT" }),
            ],
          },
        };
      }
      const n = Number(call.query.get("continuation_key") ?? "0");
      const date = `2026-10-${String(1 + Math.floor(n / 3)).padStart(2, "0")}`;
      return {
        body: {
          transactions: [fakeTx({ date, amount: -1 - n, label: `CB PAGE TEST ${n}` })],
          continuation_key: String(n + 1),
        },
      };
    });
    clbd100();
    const res = await sync({ openingBalanceFor: [courant] });
    // Pages 0-47 cover Oct 1-16; the second round brings Oct 17 whole and Oct 18.
    expect(res).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 52, skipped: 0, truncated: false }],
    });
    expect(txCalls()).toHaveLength(51);
    const link = await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.lastSyncedDate).toEqual(day("2026-11-03"));
    const sum = (await rowsOf()).reduce((t, r) => t + Number(r.amount), 0);
    const account = await db.bankAccount.findUniqueOrThrow({ where: { id: courant } });
    expect(Number(account.initialBalance)).toBe(Math.round((100 - sum) * 100) / 100);
  });

  it("does not move lastSyncedDate past the last day of a fetch left truncated", async () => {
    let page = 0;
    fake.on("GET", /\/transactions$/, () => {
      const n = page++;
      return {
        body: {
          transactions: [
            fakeTx({ date: "2026-10-05", amount: -1 - n, label: `CB PAGE TEST ${n}` }),
          ],
          continuation_key: `k${n + 1}`,
        },
      };
    });
    clbd100();
    const res = await sync({ openingBalanceFor: [courant] });
    expect(res).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 50, skipped: 0, truncated: true }],
    });
    expect(txCalls()).toHaveLength(100);
    const link = await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.lastSyncedDate).toEqual(day("2026-10-05"));
    // An incomplete history gives no reliable opening balance.
    const account = await db.bankAccount.findUniqueOrThrow({ where: { id: courant } });
    expect(Number(account.initialBalance)).toBe(0);
  });

  it("keeps lastSyncedDate when a truncated fetch comes newest first", async () => {
    let page = 0;
    fake.on("GET", /\/transactions$/, () => {
      const n = page++;
      const date = `2026-10-${String(30 - Math.floor(n / 3)).padStart(2, "0")}`;
      return {
        body: {
          transactions: [fakeTx({ date, amount: -1 - n, label: `CB PAGE TEST ${n}` })],
          continuation_key: `k${n + 1}`,
        },
      };
    });
    await sync();
    expect(txCalls()).toHaveLength(50);
    const link = await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.lastSyncedDate).toBeNull();
  });

  it("only syncs mapped accounts, optionally filtered", async () => {
    const ignored = await db.bankConnectionAccount.create({
      data: {
        connectionId,
        uidEnc: encrypt("uid-fake-b", dataKey),
        name: "Compte Joint Test",
        currency: "EUR",
      },
    });
    await sync();
    expect(txCalls().map((c) => c.path)).toEqual(["/accounts/uid-fake-a/transactions"]);
    fake.calls.length = 0;
    expect(await sync({ accountIds: ["not-this-one"] })).toEqual({ status: "OK", accounts: [] });
    expect(fake.calls).toHaveLength(0);
    await db.bankConnectionAccount.delete({ where: { id: ignored.id } });
  });
});

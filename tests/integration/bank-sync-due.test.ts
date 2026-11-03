import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { createEnableBankingClient } from "@/server/services/bank-sync/client";
import { BANK_SYNC_SINGLETON_ID } from "@/server/services/bank-sync/config";
import {
  ERROR_THRESHOLD,
  RATE_LIMIT_BACKOFF_MS,
  syncConnection,
  syncDueConnections,
} from "@/server/services/bank-sync/sync";
import {
  clearBankSyncConfig,
  fakeEnableBanking,
  fakeTx,
  seedBankSyncConfig,
  testKeyPair,
  type FakeBank,
} from "../fixtures/enable-banking";

const owner = "bsd_owner";
const now = new Date("2026-11-03T10:20:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

let fake: FakeBank;
let client: ReturnType<typeof createEnableBankingClient>;
let n = 0;

async function connection(
  uids: string[],
  data: {
    status?: string;
    lastSyncAt?: Date | null;
    retryAfter?: Date | null;
    validUntil?: Date;
  } = {},
): Promise<{ id: string; accountIds: string[] }> {
  const accountIds: string[] = [];
  for (const uid of uids) {
    accountIds.push(
      (
        await db.bankAccount.create({
          data: { ownerId: owner, name: `Compte ${uid}`, type: "CHECKING" },
        })
      ).id,
    );
  }
  const conn = await db.bankConnection.create({
    data: {
      userId: owner,
      aspspName: "Banque Fictive",
      aspspCountry: "FR",
      sessionIdEnc: encrypt(`sess-fake-${++n}`, dataKey),
      validUntil: data.validUntil ?? new Date("2027-05-02T09:00:00.000Z"),
      status: data.status ?? "ACTIVE",
      lastSyncAt: data.lastSyncAt ?? null,
      retryAfter: data.retryAfter ?? null,
      accounts: {
        create: uids.map((uid, i) => ({
          uidEnc: encrypt(uid, dataKey),
          name: `Compte ${uid}`,
          currency: "EUR",
          accountId: accountIds[i],
          syncFrom: new Date("2026-10-01T00:00:00.000Z"),
        })),
      },
    },
  });
  return { id: conn.id, accountIds };
}

const fetchedUids = () =>
  [
    ...new Set(
      fake.calls.flatMap((c) => {
        const m = /^\/accounts\/([^/]+)\/transactions$/.exec(c.path);
        return m ? [m[1]] : [];
      }),
    ),
  ].sort();

const connOf = (id: string) => db.bankConnection.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await db.user.create({ data: { id: owner, email: "bsd-owner@bilan.local" } });
  await seedBankSyncConfig();
});

beforeEach(async () => {
  await db.bankConnection.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.auditLog.deleteMany({ where: { userId: owner } });
  await db.bankSyncConfig.update({
    where: { id: BANK_SYNC_SINGLETON_ID },
    data: { enabled: true, syncIntervalHours: 6, lastRateLimitedAt: null },
  });
  fake = fakeEnableBanking();
  client = createEnableBankingClient({
    applicationId: "app-test-id",
    privateKeyPem: testKeyPair().privateKeyPem,
    fetch: fake.fetch,
  });
});

afterAll(async () => {
  await db.bankConnection.deleteMany({ where: { userId: owner } });
  await db.auditLog.deleteMany({ where: { userId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await clearBankSyncConfig();
  await db.$disconnect();
});

describe("syncDueConnections", () => {
  it("syncs only connections whose interval has elapsed", async () => {
    await connection(["uid-recent"], { lastSyncAt: hoursAgo(5) });
    const elapsed = await connection(["uid-elapsed"], { lastSyncAt: hoursAgo(6) });
    await connection(["uid-never"]);
    await connection(["uid-revoked"], { status: "REVOKED" });
    await connection(["uid-expired"], { status: "EXPIRED" });
    await connection(["uid-error"], { status: "ERROR" });
    await connection(["uid-backoff"], { retryAfter: new Date(now.getTime() + 3600_000) });
    fake.on("GET", /\/transactions$/, {
      body: { transactions: [fakeTx({ date: "2026-11-02", amount: -3, label: "CB CAFE TEST" })] },
    });

    expect(await syncDueConnections(now, { client })).toEqual({
      due: 2,
      synced: 2,
      busy: 0,
      rateLimited: 0,
      expired: 0,
      failed: 0,
      imported: 2,
      truncated: 0,
    });
    expect(fetchedUids()).toEqual(["uid-elapsed", "uid-never"]);
    expect((await connOf(elapsed.id)).lastSyncAt).toEqual(now);
    for (const c of fake.calls) {
      expect(c.headers.get("psu-ip-address")).toBeNull();
      expect(c.headers.get("psu-user-agent")).toBeNull();
    }

    fake.calls.length = 0;
    await db.bankSyncConfig.update({
      where: { id: BANK_SYNC_SINGLETON_ID },
      data: { syncIntervalHours: 12 },
    });
    expect((await syncDueConnections(new Date(now.getTime() + 7 * 3600_000), { client })).due).toBe(
      2,
    );
    expect(fetchedUids()).toEqual(["uid-backoff", "uid-recent"]);
  });

  it("does nothing while the feature is unavailable", async () => {
    await connection(["uid-never"]);
    await db.bankSyncConfig.update({
      where: { id: BANK_SYNC_SINGLETON_ID },
      data: { enabled: false },
    });
    expect(await syncDueConnections(now, { client })).toMatchObject({ due: 0, synced: 0 });
    expect(fake.calls).toHaveLength(0);
  });

  it("a rate limit stops that connection and backs off six hours", async () => {
    const limited = await connection(["uid-a1", "uid-a2", "uid-a3"]);
    const other = await connection(["uid-b1"]);
    fake.on("GET", "/accounts/uid-a1/transactions", {
      status: 429,
      body: { error: "ASPSP_RATE_LIMIT_EXCEEDED" },
    });

    const res = await syncDueConnections(now, { client });
    expect(res).toMatchObject({ due: 2, synced: 1, rateLimited: 1, failed: 0 });
    expect(fake.calls.some((c) => c.path.includes("uid-a3"))).toBe(false);
    expect(fetchedUids()).toContain("uid-b1");
    const conn = await connOf(limited.id);
    expect(conn).toMatchObject({
      status: "ACTIVE",
      lastError: "RATE_LIMITED",
      failureCount: 0,
      lastSyncAt: null,
      retryAfter: new Date(now.getTime() + RATE_LIMIT_BACKOFF_MS),
    });
    expect((await connOf(other.id)).lastSyncAt).toEqual(now);
    const cfg = await db.bankSyncConfig.findUniqueOrThrow({
      where: { id: BANK_SYNC_SINGLETON_ID },
    });
    expect(cfg.lastRateLimitedAt).toEqual(now);

    fake.calls.length = 0;
    expect((await syncDueConnections(new Date(now.getTime() + 3600_000), { client })).due).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  it("an expired session marks the connection EXPIRED and keeps its mapping", async () => {
    const lapsed = await connection(["uid-lapsed"], { validUntil: hoursAgo(1) });
    const refused = await connection(["uid-refused"]);
    fake.on("GET", "/accounts/uid-refused/balances", {
      status: 401,
      body: { error: "EXPIRED_SESSION" },
    });

    expect(await syncDueConnections(now, { client })).toMatchObject({ due: 2, expired: 2 });
    expect(fake.calls.some((c) => c.path.includes("uid-lapsed"))).toBe(false);
    for (const c of [lapsed, refused]) {
      expect(await connOf(c.id)).toMatchObject({ status: "EXPIRED", lastError: "EXPIRED_SESSION" });
      const link = await db.bankConnectionAccount.findFirstOrThrow({
        where: { connectionId: c.id },
      });
      expect(link.accountId).toBe(c.accountIds[0]);
    }
    const audits = await db.auditLog.findMany({
      where: { userId: owner, action: "bank_sync.connection.expired" },
    });
    expect(audits.map((a) => a.entityId).sort()).toEqual([lapsed.id, refused.id].sort());

    await expect(syncConnection(lapsed.id, { client, now })).rejects.toMatchObject({
      code: "EXPIRED_SESSION",
    });
  });

  it("three failures in a row mark the connection ERROR, a success resets them", async () => {
    const c = await connection(["uid-flaky"]);
    let broken = true;
    fake.on("GET", /\/transactions$/, () =>
      broken ? { status: 500, body: {} } : { body: { transactions: [] } },
    );

    for (let i = 1; i < ERROR_THRESHOLD; i++) {
      expect(await syncDueConnections(now, { client })).toMatchObject({ failed: 1 });
      expect(await connOf(c.id)).toMatchObject({ status: "ACTIVE", failureCount: i });
    }
    broken = false;
    expect(await syncDueConnections(now, { client })).toMatchObject({ synced: 1 });
    expect(await connOf(c.id)).toMatchObject({
      status: "ACTIVE",
      failureCount: 0,
      lastError: null,
    });

    broken = true;
    for (let i = 0; i < ERROR_THRESHOLD; i++) {
      await syncConnection(c.id, { client, now: new Date(now.getTime() + (i + 1) * 60_000) });
    }
    expect(await connOf(c.id)).toMatchObject({
      status: "ERROR",
      failureCount: ERROR_THRESHOLD,
      lastError: "HTTP",
    });
    fake.calls.length = 0;
    expect(
      (await syncDueConnections(new Date(now.getTime() + 24 * 3600_000), { client })).due,
    ).toBe(0);
    await expect(syncConnection(c.id, { client, now })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("fetches at most two accounts of a connection at once", async () => {
    const c = await connection(["uid-p1", "uid-p2", "uid-p3", "uid-p4"]);
    let running = 0;
    let peak = 0;
    fake.on("GET", /\/transactions$/, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
      return { body: { transactions: [] } };
    });

    const res = await syncConnection(c.id, { client, now });
    expect(res.status).toBe("OK");
    expect(fetchedUids()).toEqual(["uid-p1", "uid-p2", "uid-p3", "uid-p4"]);
    expect(peak).toBe(2);
  });
});

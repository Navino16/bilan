import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { hmacExact } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { createEnableBankingClient } from "@/server/services/bank-sync/client";
import { bankSyncRedirectUrl } from "@/server/services/bank-sync/config";
import {
  AUTH_REQUEST_TTL_MS,
  clearBankListCache,
  completeBankAuth,
  listBanks,
  purgeExpiredAuthRequests,
  startBankAuth,
} from "@/server/services/bank-sync/connect";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import {
  clearBankSyncConfig,
  FAKE_IBAN,
  fakeEnableBanking,
  seedBankSyncConfig,
  testKeyPair,
  type FakeBank,
} from "../fixtures/enable-banking";

const owner = "bsx_owner";
const other = "bsx_other";
const now = new Date("2026-11-03T10:00:00.000Z");

let fake: FakeBank;
let client: ReturnType<typeof createEnableBankingClient>;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(BankSyncError);
    return (e as BankSyncError).code;
  }
  throw new Error("expected a rejection");
}

async function start(userId = owner): Promise<string> {
  await startBankAuth(userId, { aspspName: "Banque Fictive", country: "FR" }, { client, now });
  const auth = fake.calls.filter((c) => c.path === "/auth").at(-1)!;
  return (auth.body as { state: string }).state;
}

const sessionCalls = () => fake.calls.filter((c) => c.path === "/sessions");

beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: owner, email: "bsx-owner@bilan.local" },
      { id: other, email: "bsx-other@bilan.local" },
    ],
  });
  await seedBankSyncConfig();
});

beforeEach(async () => {
  fake = fakeEnableBanking();
  client = createEnableBankingClient({
    applicationId: "app-test-id",
    privateKeyPem: testKeyPair().privateKeyPem,
    fetch: fake.fetch,
  });
  clearBankListCache();
  await seedBankSyncConfig();
  await db.bankAuthRequest.deleteMany({ where: { userId: { in: [owner, other] } } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await clearBankSyncConfig();
  await db.$disconnect();
});

describe("startBankAuth", () => {
  it("starts an authorization valid for the bank's maximum minus one hour", async () => {
    const res = await startBankAuth(
      owner,
      { aspspName: "Banque Fictive", country: "FR" },
      { client, now },
    );
    expect(res).toEqual({ url: "https://tilisy.example.test/auth?x=1" });
    const body = fake.calls.find((c) => c.path === "/auth")!.body as {
      access: { valid_until: string };
      psu_type: string;
      redirect_url: string;
      state: string;
    };
    expect(body.access.valid_until).toBe("2027-05-02T09:00:00.000Z");
    expect(body.psu_type).toBe("personal");
    expect(body.redirect_url).toBe(bankSyncRedirectUrl());

    const requests = await db.bankAuthRequest.findMany({ where: { userId: owner } });
    expect(requests).toHaveLength(1);
    expect(requests[0].stateHash).toBe(hmacExact(body.state, searchKey));
    expect(Object.values(requests[0])).not.toContain(body.state);
    expect(requests[0]).toMatchObject({ aspspName: "Banque Fictive", aspspCountry: "FR" });
  });

  it("refuses an unknown bank or a disabled feature", async () => {
    expect(
      await codeOf(
        startBankAuth(owner, { aspspName: "Banque Inconnue", country: "FR" }, { client, now }),
      ),
    ).toBe("UNKNOWN_BANK");
    await seedBankSyncConfig({ enabled: false });
    expect(
      await codeOf(
        startBankAuth(owner, { aspspName: "Banque Fictive", country: "FR" }, { client, now }),
      ),
    ).toBe("UNAVAILABLE");
    expect(fake.calls.filter((c) => c.path === "/auth")).toHaveLength(0);
    expect(await db.bankAuthRequest.count({ where: { userId: owner } })).toBe(0);
  });

  it("drops the request when the bank refuses the authorization", async () => {
    fake.on("POST", "/auth", { status: 500, body: {} });
    expect(
      await codeOf(
        startBankAuth(owner, { aspspName: "Banque Fictive", country: "FR" }, { client, now }),
      ),
    ).toBe("HTTP");
    expect(await db.bankAuthRequest.count({ where: { userId: owner } })).toBe(0);
  });

  it("refuses to reconnect a connection of another user", async () => {
    const theirs = await db.bankConnection.create({
      data: {
        userId: other,
        aspspName: "Banque Fictive",
        aspspCountry: "FR",
        sessionIdEnc: "x",
        validUntil: now,
      },
    });
    expect(
      await codeOf(
        startBankAuth(
          owner,
          { aspspName: "Banque Fictive", country: "FR", reconnectOf: theirs.id },
          { client, now },
        ),
      ),
    ).toBe("NOT_FOUND");
    await db.bankConnection.delete({ where: { id: theirs.id } });
  });
});

describe("completeBankAuth", () => {
  it("completes the authorization into a connection", async () => {
    const state = await start();
    const res = await completeBankAuth(owner, { state, code: "code-1" }, { client, now });
    expect(res.needsMapping).toBe(true);
    expect((sessionCalls()[0].body as { code: string }).code).toBe("code-1");

    const conn = await db.bankConnection.findUniqueOrThrow({
      where: { id: res.connectionId },
      include: { accounts: { orderBy: { name: "asc" } } },
    });
    expect(conn).toMatchObject({
      userId: owner,
      status: "ACTIVE",
      aspspName: "Banque Fictive",
      aspspCountry: "FR",
    });
    expect(conn.validUntil.toISOString()).toBe("2027-05-02T09:00:00.000Z");
    expect(decrypt(conn.sessionIdEnc, dataKey)).toBe("sess-fake-1");
    expect(conn.accounts).toHaveLength(2);
    const [a, b] = conn.accounts;
    expect(a).toMatchObject({ name: "Compte Courant Test", currency: "EUR", accountId: null });
    expect(decrypt(a.uidEnc, dataKey)).toBe("uid-fake-a");
    expect(a.ibanHash).toBe(hmacExact(FAKE_IBAN, searchKey));
    expect(decrypt(b.uidEnc, dataKey)).toBe("uid-fake-b");
    expect(b.ibanHash).toBeNull();
    expect(JSON.stringify(conn)).not.toContain("FR76");
    expect(JSON.stringify(conn)).not.toContain("uid-fake");

    expect(await db.bankAuthRequest.count({ where: { userId: owner } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { userId: owner, action: "bankSync.connection.created" },
    });
    expect(audit.entityId).toBe(conn.id);
    expect(audit.metadata).toEqual({ aspspName: "Banque Fictive", accounts: 2 });
    await db.bankConnection.delete({ where: { id: conn.id } });
  });

  it("names unnamed accounts after the bank and skips accounts without uid", async () => {
    fake.on("POST", "/sessions", {
      body: {
        session_id: "sess-fake-2",
        access: { valid_until: "2027-05-02T09:00:00.000Z" },
        accounts: [{ uid: "uid-fake-c", name: "  " }, { name: "Sans uid" }],
      },
    });
    const state = await start();
    const { connectionId } = await completeBankAuth(owner, { state, code: "c" }, { client, now });
    const accounts = await db.bankConnectionAccount.findMany({ where: { connectionId } });
    expect(accounts.map((x) => [x.name, x.currency])).toEqual([["Banque Fictive 1", "EUR"]]);
    await db.bankConnection.delete({ where: { id: connectionId } });
  });

  it("refuses a replayed, expired, foreign or denied callback", async () => {
    // Replayed
    const used = await start();
    const { connectionId } = await completeBankAuth(
      owner,
      { state: used, code: "c" },
      { client, now },
    );
    await db.bankConnection.delete({ where: { id: connectionId } });
    fake.calls.length = 0;
    expect(await codeOf(completeBankAuth(owner, { state: used, code: "c" }, { client, now }))).toBe(
      "UNKNOWN_STATE",
    );

    // Expired
    const old = await start();
    await db.bankAuthRequest.updateMany({
      where: { stateHash: hmacExact(old, searchKey) },
      data: { createdAt: new Date(now.getTime() - 16 * 60_000) },
    });
    expect(await codeOf(completeBankAuth(owner, { state: old, code: "c" }, { client, now }))).toBe(
      "EXPIRED_STATE",
    );
    expect(
      await db.bankAuthRequest.count({ where: { stateHash: hmacExact(old, searchKey) } }),
    ).toBe(0);

    // Another signed-in user: the request stays for its owner
    const foreign = await start();
    expect(
      await codeOf(completeBankAuth(other, { state: foreign, code: "c" }, { client, now })),
    ).toBe("WRONG_USER");
    expect(
      await db.bankAuthRequest.count({ where: { stateHash: hmacExact(foreign, searchKey) } }),
    ).toBe(1);

    // Denied at the bank
    const denied = await start();
    expect(
      await codeOf(
        completeBankAuth(owner, { state: denied, error: "access_denied" }, { client, now }),
      ),
    ).toBe("DENIED");
    expect(
      await db.bankAuthRequest.count({ where: { stateHash: hmacExact(denied, searchKey) } }),
    ).toBe(0);

    expect(sessionCalls()).toHaveLength(0);

    const done = await completeBankAuth(owner, { state: foreign, code: "c" }, { client, now });
    expect(sessionCalls()).toHaveLength(1);
    await db.bankConnection.delete({ where: { id: done.connectionId } });
  });

  it("consumes a state once under concurrent callbacks", async () => {
    const state = await start();
    const results = await Promise.allSettled([
      completeBankAuth(owner, { state, code: "c" }, { client, now }),
      completeBankAuth(owner, { state, code: "c" }, { client, now }),
    ]);
    const done = results.filter((r) => r.status === "fulfilled");
    expect(done).toHaveLength(1);
    expect(sessionCalls()).toHaveLength(1);
    await db.bankConnection.deleteMany({ where: { userId: owner } });
  });
});

describe("listBanks", () => {
  it("caches the bank list per country", async () => {
    const first = await listBanks("FR", { client });
    await listBanks("FR", { client });
    expect(fake.calls.filter((c) => c.path === "/aspsps")).toHaveLength(1);
    expect(first).toContainEqual({ name: "Banque Fictive", country: "FR", maxConsentDays: 180 });
    expect(first).toContainEqual({ name: "Autre Banque", country: "FR", maxConsentDays: 90 });
  });
});

describe("purgeExpiredAuthRequests", () => {
  it("purges authorization requests older than 15 minutes", async () => {
    const stale = await start();
    const fresh = await start();
    await db.bankAuthRequest.updateMany({
      where: { stateHash: hmacExact(stale, searchKey) },
      data: { createdAt: new Date(now.getTime() - AUTH_REQUEST_TTL_MS - 1000) },
    });
    await db.bankAuthRequest.updateMany({
      where: { stateHash: hmacExact(fresh, searchKey) },
      data: { createdAt: now },
    });
    expect(await purgeExpiredAuthRequests(now)).toBeGreaterThanOrEqual(1);
    const left = await db.bankAuthRequest.findMany({ where: { userId: owner } });
    expect(left.map((r) => r.stateHash)).toEqual([hmacExact(fresh, searchKey)]);
  });
});

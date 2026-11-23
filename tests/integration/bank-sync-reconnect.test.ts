import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { hmacExact } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { createEnableBankingClient } from "@/server/services/bank-sync/client";
import {
  clearBankListCache,
  completeBankAuth,
  disconnectBank,
  startBankAuth,
} from "@/server/services/bank-sync/connect";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import { getMappingView } from "@/server/services/bank-sync/mapping";
import { syncConnection } from "@/server/services/bank-sync/sync";
import {
  clearBankSyncConfig,
  FAKE_IBAN,
  fakeEnableBanking,
  fakeTx,
  seedBankSyncConfig,
  testKeyPair,
  type FakeBank,
} from "../fixtures/enable-banking";

const owner = "bsr_owner";
const other = "bsr_other";
const now = new Date("2026-11-03T10:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ibanHash = hmacExact(FAKE_IBAN, searchKey);
const OTHER_IBAN = "FR1420041010050500013M02606";

let courant: string;
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

// Old consent: the IBAN account mapped to courant, the joint account (no IBAN) ignored.
async function oldConnection(status = "ACTIVE", userId = owner) {
  return db.bankConnection.create({
    data: {
      userId,
      aspspName: "Banque Fictive",
      aspspCountry: "FR",
      sessionIdEnc: encrypt("sess-old", dataKey),
      validUntil: day("2026-11-10"),
      status,
      accounts: {
        create: [
          {
            uidEnc: encrypt("uid-fake-a", dataKey),
            ibanHash,
            name: "Compte Courant Test",
            currency: "EUR",
            accountId: userId === owner ? courant : null,
            syncFrom: day("2026-10-01"),
            lastSyncedDate: day("2026-10-20"),
          },
          {
            uidEnc: encrypt("uid-fake-b", dataKey),
            name: "Compte Joint Test",
            currency: "EUR",
          },
        ],
      },
    },
  });
}

function newSession(accounts: object[]) {
  fake.on("POST", "/sessions", {
    body: {
      session_id: "sess-new",
      access: { valid_until: "2027-05-02T09:00:00.000Z" },
      accounts,
    },
  });
}

const sameAccounts = [
  {
    uid: "uid-fake-z",
    name: "Compte Courant Test",
    currency: "EUR",
    account_id: { iban: FAKE_IBAN },
  },
  { uid: "uid-fake-y", name: "Compte Joint Test", currency: "EUR" },
];

async function reconnect(reconnectOf: string) {
  await startBankAuth(
    owner,
    { aspspName: "Banque Fictive", country: "FR", reconnectOf },
    { client, now },
  );
  const state = (fake.calls.filter((c) => c.path === "/auth").at(-1)!.body as { state: string })
    .state;
  return completeBankAuth(owner, { state, code: "code-r" }, { client, now });
}

const deletes = (session: string) =>
  fake.calls.filter((c) => c.method === "DELETE" && c.path === `/sessions/${session}`);

beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: owner, email: "bsr-owner@bilan.local" },
      { id: other, email: "bsr-other@bilan.local" },
    ],
  });
  courant = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
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
  await db.bankConnection.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.transaction.deleteMany({ where: { accountId: courant } });
  await db.importBatch.deleteMany({ where: { accountId: courant } });
  await db.bankAccount.update({ where: { id: courant }, data: { archived: false } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await clearBankSyncConfig();
  await db.$disconnect();
});

describe("reconnect", () => {
  it("reconnecting carries mappings by IBAN and imports no duplicate", async () => {
    const old = await oldConnection();
    const synced = [
      fakeTx({ date: "2026-10-15", amount: -12.5, label: "CB CAFE TEST" }),
      fakeTx({ date: "2026-10-20", amount: -30, label: "CB EPICERIE TEST" }),
    ];
    fake.on("GET", /\/transactions$/, { body: { transactions: synced } });
    await syncConnection(old.id, { client, now: new Date("2026-10-20T18:00:00.000Z") });
    await db.bankConnection.update({ where: { id: old.id }, data: { status: "EXPIRED" } });
    expect(await db.transaction.count({ where: { accountId: courant } })).toBe(2);

    newSession(sameAccounts);
    const res = await reconnect(old.id);
    expect(res.needsMapping).toBe(false);

    const links = await db.bankConnectionAccount.findMany({
      where: { connectionId: res.connectionId },
      orderBy: { name: "asc" },
    });
    expect(links.map((l) => [l.name, l.accountId])).toEqual([
      ["Compte Courant Test", courant],
      ["Compte Joint Test", null],
    ]);
    expect(links[0].syncFrom).toEqual(day("2026-10-01"));
    expect(links[0].lastSyncedDate).toEqual(day("2026-10-20"));
    expect((await db.bankConnection.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "REVOKED",
    );
    expect(deletes("sess-old")).toHaveLength(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { userId: owner, action: "bank_sync.connection.reconnected" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.entityId).toBe(res.connectionId);
    expect(audit.metadata).toEqual({
      aspspName: "Banque Fictive",
      accounts: 2,
      previousId: old.id,
      carried: 1,
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/sess-|uid-|FR76/);

    fake.calls.length = 0;
    fake.on("GET", /\/transactions$/, {
      body: {
        transactions: [
          ...synced,
          fakeTx({ date: "2026-10-25", amount: -8, label: "CB BOULANGERIE TEST" }),
        ],
      },
    });
    const sync = await syncConnection(res.connectionId, { client, now });
    expect(sync).toMatchObject({ status: "OK" });
    const tx = fake.calls.find((c) => c.path === "/accounts/uid-fake-z/transactions")!;
    expect(tx.query.get("date_from")).toBe("2026-10-13");
    expect(fake.calls.some((c) => c.path.includes("uid-fake-y"))).toBe(false);
    expect(await db.transaction.count({ where: { accountId: courant } })).toBe(3);
  });

  it.each(["ACTIVE", "ERROR"])("reconnects a connection in %s", async (status) => {
    const old = await oldConnection(status);
    newSession(sameAccounts);
    const res = await reconnect(old.id);
    expect(res.needsMapping).toBe(false);
    expect((await db.bankConnection.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      "REVOKED",
    );
    const fresh = await db.bankConnection.findUniqueOrThrow({ where: { id: res.connectionId } });
    expect(fresh).toMatchObject({ status: "ACTIVE", reminderSentDays: null });
  });

  it("a reconnect with a new bank account goes through the mapping page", async () => {
    const old = await oldConnection("EXPIRED");
    newSession([
      ...sameAccounts,
      { uid: "uid-fake-n", name: "Livret Test", currency: "EUR", account_id: { iban: OTHER_IBAN } },
    ]);
    const res = await reconnect(old.id);
    expect(res.needsMapping).toBe(true);
    const view = await getMappingView(owner, res.connectionId);
    expect(view.accounts.map((a) => [a.name, a.accountId])).toEqual(
      expect.arrayContaining([
        ["Compte Courant Test", courant],
        ["Compte Joint Test", null],
        ["Livret Test", null],
      ]),
    );
    expect(view.targets.find((t) => t.id === courant)?.syncedElsewhere).toBe(false);
  });

  it("asks for the mapping again when a mapped account did not come back or is archived", async () => {
    const gone = await oldConnection("EXPIRED");
    newSession([sameAccounts[1]]);
    expect((await reconnect(gone.id)).needsMapping).toBe(true);

    const archived = await oldConnection("EXPIRED");
    await db.bankAccount.update({ where: { id: courant }, data: { archived: true } });
    newSession(sameAccounts);
    const res = await reconnect(archived.id);
    expect(res.needsMapping).toBe(true);
    const link = await db.bankConnectionAccount.findFirstOrThrow({
      where: { connectionId: res.connectionId, ibanHash },
    });
    expect(link.accountId).toBeNull();
  });

  it("does not carry an account another active connection syncs meanwhile", async () => {
    const old = await oldConnection("EXPIRED");
    const meanwhile = await db.bankConnection.create({
      data: {
        userId: owner,
        aspspName: "Autre Banque",
        aspspCountry: "FR",
        sessionIdEnc: encrypt("sess-other", dataKey),
        validUntil: day("2027-01-01"),
        accounts: {
          create: {
            uidEnc: encrypt("uid-other", dataKey),
            name: "Autre",
            currency: "EUR",
            accountId: courant,
          },
        },
      },
    });
    newSession(sameAccounts);
    const res = await reconnect(old.id);
    expect(res.needsMapping).toBe(true);
    const link = await db.bankConnectionAccount.findFirstOrThrow({
      where: { connectionId: res.connectionId, ibanHash },
    });
    expect(link.accountId).toBeNull();
    expect(
      (await db.bankConnection.findUniqueOrThrow({ where: { id: meanwhile.id } })).status,
    ).toBe("ACTIVE");
  });

  it("reconnectOf must be the user's own, unrevoked connection of the same bank", async () => {
    const theirs = await oldConnection("ACTIVE", other);
    const revoked = await oldConnection("REVOKED");
    const mine = await oldConnection("EXPIRED");
    const start = (reconnectOf: string, aspspName = "Banque Fictive") =>
      startBankAuth(owner, { aspspName, country: "FR", reconnectOf }, { client, now });
    expect(await codeOf(start(theirs.id))).toBe("NOT_FOUND");
    expect(await codeOf(start(revoked.id))).toBe("NOT_FOUND");
    expect(await codeOf(start(mine.id, "Autre Banque"))).toBe("NOT_FOUND");
    expect(fake.calls.filter((c) => c.path === "/auth")).toHaveLength(0);
    await expect(start(mine.id)).resolves.toMatchObject({ url: expect.any(String) });
  });

  it("a connection revoked during the authorization is not replaced", async () => {
    const old = await oldConnection("EXPIRED");
    await startBankAuth(
      owner,
      { aspspName: "Banque Fictive", country: "FR", reconnectOf: old.id },
      { client, now },
    );
    const state = (fake.calls.find((c) => c.path === "/auth")!.body as { state: string }).state;
    await disconnectBank(owner, old.id, { client });
    newSession(sameAccounts);
    const res = await completeBankAuth(owner, { state, code: "c" }, { client, now });
    expect(res.needsMapping).toBe(true);
    const links = await db.bankConnectionAccount.findMany({
      where: { connectionId: res.connectionId },
    });
    expect(links.every((l) => l.accountId === null)).toBe(true);
  });
});

describe("disconnectBank", () => {
  it("disconnect deletes the session and keeps synced rows", async () => {
    const conn = await oldConnection();
    fake.on("GET", /\/transactions$/, {
      body: { transactions: [fakeTx({ date: "2026-10-28", amount: -4, label: "CB CAFE TEST" })] },
    });
    await syncConnection(conn.id, { client, now });
    expect(await db.transaction.count({ where: { accountId: courant } })).toBe(1);

    await disconnectBank(owner, conn.id, { client });
    expect((await db.bankConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe(
      "REVOKED",
    );
    expect(await db.transaction.count({ where: { accountId: courant } })).toBe(1);
    expect(deletes("sess-old")).toHaveLength(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { userId: owner, action: "bank_sync.connection.revoked", entityId: conn.id },
    });
    expect(audit.metadata).toEqual({ aspspName: "Banque Fictive" });
    expect(await codeOf(disconnectBank(owner, conn.id, { client }))).toBe("NOT_FOUND");
  });

  it.each([
    [404, { error: "NOT_FOUND" }],
    [401, { error: "EXPIRED_SESSION" }],
  ])("still revokes when the bank answers %s on delete", async (status, body) => {
    const conn = await oldConnection("EXPIRED");
    fake.on("DELETE", /^\/sessions\//, { status, body });
    await disconnectBank(owner, conn.id, { client });
    expect((await db.bankConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe(
      "REVOKED",
    );
  });

  it("refuses another user's connection", async () => {
    const theirs = await oldConnection("ACTIVE", other);
    expect(await codeOf(disconnectBank(owner, theirs.id, { client }))).toBe("NOT_FOUND");
    expect((await db.bankConnection.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe(
      "ACTIVE",
    );
    expect(fake.calls).toHaveLength(0);
  });
});

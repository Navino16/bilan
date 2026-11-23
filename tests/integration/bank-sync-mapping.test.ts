import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { hmacExact } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { createEnableBankingClient, type Psu } from "@/server/services/bank-sync/client";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import {
  getMappingView,
  saveBankMapping,
  type MappingChoice,
} from "@/server/services/bank-sync/mapping";
import { createTransaction } from "@/server/services/transactions";
import {
  clearBankSyncConfig,
  FAKE_IBAN,
  fakeEnableBanking,
  fakeTx,
  seedBankSyncConfig,
  testKeyPair,
  type FakeBank,
} from "../fixtures/enable-banking";
import type { EbTransaction } from "@/server/services/bank-sync/types";

const owner = "bsm_owner";
const sharer = "bsm_sharer";
const now = new Date("2026-11-03T10:00:00.000Z");
const psu: Psu = { ip: "203.0.113.7", userAgent: "Test UA" };
const ibanHash = hmacExact(FAKE_IBAN, searchKey);

let own: string; // rows on 2026-10-01 and 2026-10-28
let empty: string;
let archived: string;
let shared: string; // owned by sharer, shared WRITE with owner
let synced: string; // mapped by another ACTIVE connection of owner
let revokedTarget: string; // mapped by a REVOKED connection
let groupId: string;
let fake: FakeBank;
let client: ReturnType<typeof createEnableBankingClient>;
const temp: string[] = [];

type LinkSeed = { uid: string; currency?: string; ibanHash?: string; accountId?: string };

async function connection(
  links: LinkSeed[],
  o: { userId?: string; status?: string; keep?: boolean } = {},
): Promise<{ id: string; links: string[] }> {
  const conn = await db.bankConnection.create({
    data: {
      userId: o.userId ?? owner,
      aspspName: "Banque Fictive",
      aspspCountry: "FR",
      sessionIdEnc: encrypt("sess-fake-1", dataKey),
      validUntil: new Date("2027-05-02T09:00:00.000Z"),
      status: o.status ?? "ACTIVE",
    },
  });
  if (!o.keep) temp.push(conn.id);
  const ids: string[] = [];
  for (const l of links) {
    const link = await db.bankConnectionAccount.create({
      data: {
        connectionId: conn.id,
        uidEnc: encrypt(l.uid, dataKey),
        name: `Compte test ${ids.length + 1}`,
        currency: l.currency ?? "EUR",
        ibanHash: l.ibanHash ?? null,
        accountId: l.accountId ?? null,
      },
    });
    ids.push(link.id);
  }
  return { id: conn.id, links: ids };
}

function bankReturns(uid: string, txs: EbTransaction[], clbd?: { amount: string; date: string }) {
  fake.on("GET", `/accounts/${uid}/transactions`, { body: { transactions: txs } });
  fake.on("GET", `/accounts/${uid}/balances`, {
    body: {
      balances: clbd
        ? [
            {
              balance_type: "CLBD",
              balance_amount: { amount: clbd.amount, currency: "EUR" },
              reference_date: clbd.date,
            },
          ]
        : [],
    },
  });
}

const save = (connectionId: string, choices: MappingChoice[]) =>
  saveBankMapping(owner, connectionId, choices, { psu, now, client });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(BankSyncError);
    return (e as BankSyncError).code;
  }
  throw new Error("expected a rejection");
}

const account = (name: string, ownerId = owner, archivedFlag = false) =>
  db.bankAccount
    .create({
      data: { ownerId, name, type: "CHECKING", archived: archivedFlag, initialBalance: 10 },
    })
    .then((a) => a.id);

const manual = (accountId: string, date: string) =>
  createTransaction(
    { accountId, date, amount: -5, type: "CARD", label: "Manual test" },
    { id: owner },
  );

beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: owner, email: "bsm-owner@bilan.local" },
      { id: sharer, email: "bsm-sharer@bilan.local" },
    ],
  });
  own = await account("Own");
  empty = await account("Empty");
  archived = await account("Archived", owner, true);
  synced = await account("Synced");
  revokedTarget = await account("Revoked target");
  shared = await account("Shared", sharer);
  groupId = (await db.group.create({ data: { name: "Bsm", createdById: sharer } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: sharer, role: "OWNER" },
      { groupId, userId: owner, role: "MEMBER" },
    ],
  });
  await db.accountShare.create({
    data: { accountId: shared, groupId, permission: "WRITE", createdById: sharer },
  });
  await manual(own, "2026-10-01");
  await manual(own, "2026-10-28");
  await connection([{ uid: "uid-other-a", ibanHash, accountId: synced }], { keep: true });
  await connection([{ uid: "uid-old-a", accountId: revokedTarget }], {
    status: "REVOKED",
    keep: true,
  });
  await seedBankSyncConfig();
});

beforeEach(() => {
  fake = fakeEnableBanking();
  client = createEnableBankingClient({
    applicationId: "app-test-id",
    privateKeyPem: testKeyPair().privateKeyPem,
    fetch: fake.fetch,
  });
});

afterEach(async () => {
  await db.bankConnection.deleteMany({ where: { id: { in: temp.splice(0) } } });
});

afterAll(async () => {
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, sharer] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, sharer] } } });
  await clearBankSyncConfig();
  await db.$disconnect();
});

describe("getMappingView", () => {
  it("offers only the user's own active accounts", async () => {
    const conn = await connection([{ uid: "uid-fake-a" }]);
    const view = await getMappingView(owner, conn.id);
    const ids = view.targets.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([own, empty, synced, revokedTarget]));
    expect(ids).not.toContain(shared);
    expect(ids).not.toContain(archived);
    expect(view).toMatchObject({ connectionId: conn.id, aspspName: "Banque Fictive" });
    expect(view.accounts).toEqual([
      {
        id: conn.links[0],
        name: "Compte test 1",
        currency: "EUR",
        accountId: null,
        syncedElsewhere: false,
        defaultSyncFrom: null,
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("uid-fake");
    expect(JSON.stringify(view)).not.toContain(ibanHash);

    const theirs = await connection([{ uid: "uid-fake-s" }], { userId: sharer });
    expect(await codeOf(getMappingView(owner, theirs.id))).toBe("NOT_FOUND");
    expect(await codeOf(save(theirs.id, []))).toBe("NOT_FOUND");
  });

  it("defaults sync-from to the day of the account's last transaction", async () => {
    const conn = await connection([{ uid: "uid-fake-a", accountId: own }]);
    const view = await getMappingView(owner, conn.id);
    expect(view.targets.find((t) => t.id === own)?.defaultSyncFrom).toBe("2026-10-28");
    expect(view.targets.find((t) => t.id === empty)?.defaultSyncFrom).toBeNull();
    expect(view.accounts[0].defaultSyncFrom).toBe("2026-10-28");
  });
});

describe("saveBankMapping", () => {
  it("refuses foreign, already synced or non-euro mappings", async () => {
    const conn = await connection([
      { uid: "uid-fake-a", ibanHash },
      { uid: "uid-fake-b" },
      { uid: "uid-fake-usd", currency: "USD" },
    ]);
    const [a, b, usd] = conn.links;
    const view = await getMappingView(owner, conn.id);
    expect(view.accounts.find((x) => x.id === a)?.syncedElsewhere).toBe(true);
    expect(view.targets.find((t) => t.id === synced)?.syncedElsewhere).toBe(true);
    expect(view.targets.find((t) => t.id === revokedTarget)?.syncedElsewhere).toBe(false);

    const map = (connectionAccountId: string, accountId: string): MappingChoice => ({
      connectionAccountId,
      action: "MAP",
      accountId,
    });
    expect(await codeOf(save(conn.id, [map(b, shared)]))).toBe("FORBIDDEN");
    expect(await codeOf(save(conn.id, [map(b, archived)]))).toBe("FORBIDDEN");
    expect(await codeOf(save(conn.id, [map(b, synced)]))).toBe("ALREADY_SYNCED");
    expect(await codeOf(save(conn.id, [map(a, empty)]))).toBe("ALREADY_SYNCED");
    expect(await codeOf(save(conn.id, [map(usd, own)]))).toBe("UNSUPPORTED_CURRENCY");
    expect(
      await codeOf(
        save(conn.id, [{ connectionAccountId: usd, action: "CREATE", name: "Dollars" }]),
      ),
    ).toBe("UNSUPPORTED_CURRENCY");
    expect(await codeOf(save(conn.id, [{ connectionAccountId: "nope", action: "IGNORE" }]))).toBe(
      "NOT_FOUND",
    );
    expect(fake.calls).toHaveLength(0);
    expect(
      await db.bankConnectionAccount.count({
        where: { connectionId: conn.id, accountId: { not: null } },
      }),
    ).toBe(0);

    const res = await save(conn.id, [map(b, revokedTarget)]);
    expect(res.accounts).toEqual([
      {
        accountId: revokedTarget,
        name: "Revoked target",
        imported: 0,
        skipped: 0,
        truncated: false,
      },
    ]);
  });

  it("refuses one account mapped twice", async () => {
    const conn = await connection([{ uid: "uid-fake-a" }, { uid: "uid-fake-b" }]);
    const [a, b] = conn.links;
    expect(
      await codeOf(
        save(conn.id, [
          { connectionAccountId: a, action: "MAP", accountId: empty },
          { connectionAccountId: b, action: "MAP", accountId: empty },
        ]),
      ),
    ).toBe("ALREADY_SYNCED");
  });

  it("creates a checking account and fetches its history user-present", async () => {
    const conn = await connection([{ uid: "uid-fake-a" }]);
    bankReturns("uid-fake-a", [
      fakeTx({ date: "2026-10-05", amount: -12.5, label: "CB CAFE TEST" }),
      fakeTx({ date: "2026-10-06", amount: 1500, label: "VIR SALAIRE TEST" }),
    ]);
    const res = await save(conn.id, [
      { connectionAccountId: conn.links[0], action: "CREATE", name: "Courant Test" },
    ]);
    expect(res.accounts).toEqual([
      {
        accountId: expect.any(String),
        name: "Courant Test",
        imported: 2,
        skipped: 0,
        truncated: false,
      },
    ]);
    const created = await db.bankAccount.findUniqueOrThrow({
      where: { id: res.accounts[0].accountId },
    });
    expect(created).toMatchObject({
      ownerId: owner,
      name: "Courant Test",
      type: "CHECKING",
      bankName: "Banque Fictive",
    });
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const c of fake.calls) expect(c.headers.get("psu-ip-address")).toBe("203.0.113.7");
    const link = await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: conn.links[0] } });
    expect(link).toMatchObject({ accountId: created.id, syncFrom: null });
  });

  it("sets the opening balance when the account starts with the sync", async () => {
    const conn = await connection([
      { uid: "uid-fake-a" },
      { uid: "uid-fake-b" },
      { uid: "uid-fake-c" },
    ]);
    const [a, b, c] = conn.links;
    bankReturns(
      "uid-fake-a",
      [
        fakeTx({ date: "2026-10-30", amount: -20, label: "CB OUVERTURE TEST" }),
        fakeTx({ date: "2026-11-02", amount: 100, label: "VIR OUVERTURE TEST" }),
      ],
      { amount: "500.00", date: "2026-10-31" },
    );
    bankReturns(
      "uid-fake-b",
      [fakeTx({ date: "2026-10-29", amount: -3, label: "CB SUITE TEST" })],
      {
        amount: "999.00",
        date: "2026-10-31",
      },
    );
    bankReturns("uid-fake-c", [], { amount: "80.00", date: "2026-10-31" });

    const res = await save(conn.id, [
      { connectionAccountId: a, action: "CREATE", name: "Ouverture Test" },
      { connectionAccountId: b, action: "MAP", accountId: own },
      { connectionAccountId: c, action: "MAP", accountId: empty },
    ]);
    const createdId = res.accounts.find((r) => r.name === "Ouverture Test")!.accountId;
    const balance = async (id: string) =>
      Number((await db.bankAccount.findUniqueOrThrow({ where: { id } })).initialBalance);
    expect(await balance(createdId)).toBe(520);
    expect(await balance(own)).toBe(10);
    expect(await balance(empty)).toBe(80);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "account.initial_balance_adjusted", entityId: createdId },
    });
    expect(audit.metadata).toMatchObject({ previous: 0, set: 520 });
    const emptyAudit = await db.auditLog.findFirstOrThrow({
      where: { action: "account.initial_balance_adjusted", entityId: empty },
    });
    expect(emptyAudit.metadata).toEqual({ previous: 10, set: 80 });

    const ownLink = await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: b } });
    expect(ownLink.syncFrom).toEqual(new Date("2026-10-28T00:00:00.000Z"));
  });

  it("keeps a created account mapped when the initial fetch fails, so a retry reuses it", async () => {
    const conn = await connection([{ uid: "uid-fake-a" }]);
    const before = await db.bankAccount.count({ where: { ownerId: owner } });
    fake.on("GET", "/accounts/uid-fake-a/transactions", { status: 500, body: {} });
    expect(
      await codeOf(
        save(conn.id, [
          { connectionAccountId: conn.links[0], action: "CREATE", name: "Retry Test" },
        ]),
      ),
    ).toBe("HTTP");
    const view = await getMappingView(owner, conn.id);
    const created = view.accounts[0].accountId!;
    expect(view.targets.find((t) => t.id === created)?.name).toBe("Retry Test");

    bankReturns(
      "uid-fake-a",
      [fakeTx({ date: "2026-10-05", amount: -4, label: "CB RETRY TEST" })],
      {
        amount: "96.00",
        date: "2026-10-31",
      },
    );
    const res = await save(conn.id, [
      { connectionAccountId: conn.links[0], action: "MAP", accountId: created },
    ]);
    expect(res.accounts).toEqual([
      { accountId: created, name: "Retry Test", imported: 1, skipped: 0, truncated: false },
    ]);
    expect(await db.bankAccount.count({ where: { ownerId: owner } })).toBe(before + 1);
    const account = await db.bankAccount.findUniqueOrThrow({ where: { id: created } });
    expect(Number(account.initialBalance)).toBe(100);
  });

  it("writes nothing while bank sync is unavailable", async () => {
    const conn = await connection([{ uid: "uid-fake-a" }]);
    const before = await db.bankAccount.count({ where: { ownerId: owner } });
    await seedBankSyncConfig({ enabled: false });
    try {
      expect(
        await codeOf(
          save(conn.id, [
            { connectionAccountId: conn.links[0], action: "CREATE", name: "Off Test" },
          ]),
        ),
      ).toBe("UNAVAILABLE");
    } finally {
      await seedBankSyncConfig();
    }
    expect(await db.bankAccount.count({ where: { ownerId: owner } })).toBe(before);
    expect(
      (await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: conn.links[0] } }))
        .accountId,
    ).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("keeps a hand-edited opening balance when the mapping is saved again", async () => {
    const conn = await connection([{ uid: "uid-fake-a" }]);
    bankReturns("uid-fake-a", [], { amount: "80.00", date: "2026-10-31" });
    const first = await save(conn.id, [
      { connectionAccountId: conn.links[0], action: "CREATE", name: "Edited Test" },
    ]);
    const id = first.accounts[0].accountId;
    expect(Number((await db.bankAccount.findUniqueOrThrow({ where: { id } })).initialBalance)).toBe(
      80,
    );
    await db.bankAccount.update({ where: { id }, data: { initialBalance: 55 } });
    await save(conn.id, [{ connectionAccountId: conn.links[0], action: "MAP", accountId: id }]);
    expect(Number((await db.bankAccount.findUniqueOrThrow({ where: { id } })).initialBalance)).toBe(
      55,
    );
  });

  it("refuses a connection that is no longer active", async () => {
    const conn = await connection([{ uid: "uid-fake-a" }], { status: "REVOKED" });
    expect(await codeOf(getMappingView(owner, conn.id))).toBe("NOT_FOUND");
    expect(
      await codeOf(save(conn.id, [{ connectionAccountId: conn.links[0], action: "IGNORE" }])),
    ).toBe("NOT_FOUND");
  });

  it("ignored accounts are never fetched", async () => {
    const conn = await connection([{ uid: "uid-fake-a", accountId: own }, { uid: "uid-fake-b" }]);
    const [a, b] = conn.links;
    const res = await save(conn.id, [
      { connectionAccountId: a, action: "IGNORE" },
      { connectionAccountId: b, action: "IGNORE" },
    ]);
    expect(res.accounts).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    expect(
      (await db.bankConnectionAccount.findUniqueOrThrow({ where: { id: a } })).accountId,
    ).toBeNull();
  });
});

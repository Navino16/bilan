import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { createEnableBankingClient } from "@/server/services/bank-sync/client";
import { listSyncedAccounts, syncNow } from "@/server/services/bank-sync/status";
import {
  clearBankSyncConfig,
  FAKE_IBAN,
  fakeEnableBanking,
  fakeTx,
  seedBankSyncConfig,
  testKeyPair,
  type FakeBank,
} from "../fixtures/enable-banking";

const owner = "bsst_owner";
const member = "bsst_member";
const psu = { ip: "203.0.113.7", userAgent: "Test UA" };

let courant: string;
let joint: string;
let connectionId: string;
let revokedId: string;
let fake: FakeBank;
let client: ReturnType<typeof createEnableBankingClient>;

beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: owner, email: "bsst-owner@bilan.local" },
      { id: member, email: "bsst-member@bilan.local" },
    ],
  });
  courant = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  joint = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Joint", type: "CHECKING" } })
  ).id;
  const group = await db.group.create({
    data: {
      name: "Foyer test",
      createdById: owner,
      members: {
        create: [
          { userId: owner, role: "OWNER" },
          { userId: member, role: "MEMBER" },
        ],
      },
    },
  });
  await db.accountShare.create({
    data: { accountId: courant, groupId: group.id, permission: "WRITE", createdById: owner },
  });
  connectionId = (
    await db.bankConnection.create({
      data: {
        userId: owner,
        aspspName: "Banque Fictive",
        aspspCountry: "FR",
        sessionIdEnc: encrypt("sess-fake-1", dataKey),
        validUntil: new Date("2027-05-02T09:00:00.000Z"),
        lastSyncAt: new Date("2026-11-03T04:20:00.000Z"),
        accounts: {
          create: [
            {
              uidEnc: encrypt("uid-fake-a", dataKey),
              ibanHash: "hash-of-the-fake-iban",
              name: "Compte Courant Test",
              currency: "EUR",
              accountId: courant,
              syncFrom: new Date("2026-10-01T00:00:00.000Z"),
              pendingCount: 2,
              pendingTotal: -35.4,
            },
            {
              uidEnc: encrypt("uid-fake-b", dataKey),
              name: "Compte Ignore Test",
              currency: "EUR",
            },
          ],
        },
      },
    })
  ).id;
  revokedId = (
    await db.bankConnection.create({
      data: {
        userId: owner,
        aspspName: "Autre Banque",
        aspspCountry: "FR",
        sessionIdEnc: encrypt("sess-fake-2", dataKey),
        validUntil: new Date("2027-05-02T09:00:00.000Z"),
        status: "REVOKED",
        accounts: {
          create: {
            uidEnc: encrypt("uid-fake-c", dataKey),
            name: "Compte Joint Test",
            currency: "EUR",
            accountId: joint,
          },
        },
      },
    })
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
});

afterAll(async () => {
  await db.group.deleteMany({ where: { createdById: owner } });
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, member] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  await clearBankSyncConfig();
  await db.$disconnect();
});

describe("listSyncedAccounts", () => {
  it("summarises the owner's synced accounts, without any bank identifier", async () => {
    const synced = await listSyncedAccounts(owner);
    expect(synced).toEqual({
      [courant]: {
        connectionId,
        aspspName: "Banque Fictive",
        status: "ACTIVE",
        lastSyncAt: new Date("2026-11-03T04:20:00.000Z"),
        lastError: null,
        pendingCount: 2,
        pendingTotal: -35.4,
      },
    });
    const dumped = JSON.stringify(synced);
    for (const secret of ["uid", "iban", "session", "hash-of-the-fake-iban", FAKE_IBAN]) {
      expect(dumped.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("shows nothing to a member who sees the account through a share", async () => {
    expect(await listSyncedAccounts(member)).toEqual({});
  });
});

describe("syncNow", () => {
  it("syncs the user's own connection with the PSU headers", async () => {
    fake.on("GET", /\/transactions$/, {
      body: { transactions: [fakeTx({ date: "2026-11-02", amount: -3, label: "CB CAFE TEST" })] },
    });
    const res = await syncNow(owner, connectionId, psu, { client });
    expect(res).toEqual({
      status: "OK",
      accounts: [{ accountId: courant, imported: 1, skipped: 0, truncated: false }],
    });
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const c of fake.calls) expect(c.headers.get("psu-ip-address")).toBe(psu.ip);
  });

  it("refuses another user's connection and a revoked one", async () => {
    for (const [user, id] of [
      [member, connectionId],
      [owner, revokedId],
      [owner, "missing"],
    ]) {
      await expect(syncNow(user, id, psu, { client })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("brings a connection in ERROR back to ACTIVE", async () => {
    await db.bankConnection.update({
      where: { id: connectionId },
      data: { status: "ERROR", failureCount: 3, lastError: "HTTP" },
    });
    expect((await syncNow(owner, connectionId, psu, { client })).status).toBe("OK");
    expect(
      await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } }),
    ).toMatchObject({ status: "ACTIVE", failureCount: 0, lastError: null });
  });

  it("is unavailable while the feature is off", async () => {
    await seedBankSyncConfig({ enabled: false });
    await expect(syncNow(owner, connectionId, psu, { client })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await seedBankSyncConfig();
    expect(fake.calls).toHaveLength(0);
  });
});

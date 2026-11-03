import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { exportParts, exportUserData, deleteUser, userDataJson } from "@/server/services/rgpd";
import { renameMerchant } from "@/server/services/merchants";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { hmacExact } from "@/server/crypto/hmac";
import {
  clearBankSyncConfig,
  FAKE_IBAN,
  fakeEnableBanking,
  seedBankSyncConfig,
  type FakeBank,
} from "../fixtures/enable-banking";

const userId = "rgpd_owner";
const ownerB = "rgpd_ownerB";
const succ = "rgpd_succ";
const IBAN = "FR7630006000011234567890189";
let accountId: string;
let groupId: string;
let txId: string;
let batchId: string;
let linkId: string;
let fake: FakeBank;

const bankConnection = (owner: string, accountId: string | null = null) =>
  db.bankConnection.create({
    data: {
      userId: owner,
      aspspName: "Banque Fictive",
      aspspCountry: "FR",
      sessionIdEnc: encrypt("sess-fake-1", dataKey),
      validUntil: new Date("2027-05-02T09:00:00.000Z"),
      accounts: {
        create: {
          uidEnc: encrypt("uid-fake-a", dataKey),
          ibanHash: hmacExact(FAKE_IBAN, searchKey),
          name: "Compte Courant Test",
          currency: "EUR",
          accountId,
        },
      },
    },
  });
const sessionDeletes = () =>
  fake.calls.filter((c) => c.method === "DELETE" && c.path === "/sessions/sess-fake-1");

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.group.deleteMany({ where: { createdById: userId } });
  await db.transactionLink.deleteMany({ where: { createdById: userId } });
  await db.user.create({
    data: { id: userId, email: "rgpd-owner@bilan.local", name: "RGPD Owner" },
  });

  accountId = (
    await db.bankAccount.create({
      data: {
        ownerId: userId,
        name: "Courant",
        type: "CHECKING",
        ibanEnc: encrypt(IBAN, dataKey),
        ibanHash: "rgpd-iban-hash",
      },
    })
  ).id;
  batchId = (
    await db.importBatch.create({
      data: {
        accountId,
        source: "CSV",
        filename: "releve-mars.csv",
        status: "REVIEW",
        totalRows: 1,
        createdById: userId,
        metadata: { text: "date;libelle;montant\n05/03/2026;VIR LOYER;-700" },
      },
    })
  ).id;
  await db.category.create({ data: { userId, name: "Logement", color: "#aa1111" } });

  const secure = buildSecureFields({ label: "Loyer", rawLabel: "VIR LOYER" });
  txId = (
    await db.transaction.create({
      data: {
        accountId,
        importBatchId: batchId,
        date: new Date("2026-03-05T00:00:00.000Z"),
        amount: -700,
        type: "TRANSFER",
        labelEnc: secure.labelEnc,
        labelHash: secure.labelHash,
        rawLabelEnc: secure.rawLabelEnc,
        rawLabelHash: secure.rawLabelHash,
        createdById: userId,
      },
    })
  ).id;
  linkId = (
    await db.transactionLink.create({
      data: {
        name: "Loyer + remboursement",
        createdById: userId,
        members: { create: { transactionId: txId } },
      },
    })
  ).id;

  await db.budget.create({
    data: {
      name: "Mars 2026",
      userId,
      createdById: userId,
      periodType: "MONTH",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-03-31T00:00:00.000Z"),
    },
  });

  await renameMerchant(userId, "FONCIA LOYER", "Loyer");

  await bankConnection(userId, accountId);
  await db.bankAuthRequest.create({
    data: { stateHash: "rgpd-state-hash", userId, aspspName: "Banque Fictive", aspspCountry: "FR" },
  });
  await seedBankSyncConfig();
  fake = fakeEnableBanking();
  vi.stubGlobal("fetch", fake.fetch);

  groupId = (await db.group.create({ data: { name: "Foyer", createdById: userId } })).id;
  await db.groupMember.create({ data: { groupId, userId, role: "OWNER" } });
  await db.groupInvitation.create({
    data: {
      groupId,
      email: "invitee@bilan.local",
      invitedById: userId,
      tokenEnc: "rgpd-secret-token",
      tokenHash: "rgpd-token-hash",
      codeEnc: "RGPD-CODE",
      codeHash: "rgpd-code-hash",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await clearBankSyncConfig();
  await db.transactionLink.deleteMany({ where: { createdById: userId } });
  await db.transaction.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: userId } });
  await db.group.deleteMany({ where: { createdById: { in: [userId, ownerB, succ] } } });
  await db.auditLog.deleteMany({ where: { entityId: userId, action: "user.deleted" } });
  await db.user.deleteMany({ where: { id: { in: [userId, ownerB, succ] } } });
  await db.$disconnect();
});

const muA = "rgpd_mu_a";
const muB = "rgpd_mu_b";

async function createTx(accountId: string, createdById: string, importBatchId?: string) {
  const secure = buildSecureFields({ label: "Courses", rawLabel: "CB COURSES" });
  const tx = await db.transaction.create({
    data: {
      accountId,
      importBatchId,
      date: new Date("2026-04-02T00:00:00.000Z"),
      amount: -42,
      type: "CARD",
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      createdById,
    },
  });
  return tx.id;
}

async function cleanupMultiUser() {
  await db.transactionLink.deleteMany({ where: { createdById: { in: [muA, muB] } } });
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId: muA } });
  await db.group.deleteMany({ where: { createdById: { in: [muA, muB] } } });
  await db.user.deleteMany({ where: { id: { in: [muA, muB] } } });
}

describe("rgpd export with another user's shared account", () => {
  let accA: string;
  let accB: string;
  let txA: string;
  let txA2: string;
  let txB: string;
  let txB2: string;
  let mixedLink: string;
  let batchOnB: string;
  let multiBatch: string;

  beforeAll(async () => {
    await cleanupMultiUser();
    await db.user.createMany({
      data: [
        { id: muA, email: "rgpd-mu-a@bilan.local" },
        { id: muB, email: "rgpd-mu-b@bilan.local" },
      ],
    });
    accA = (await db.bankAccount.create({ data: { ownerId: muA, name: "A", type: "CHECKING" } }))
      .id;
    accB = (await db.bankAccount.create({ data: { ownerId: muB, name: "B", type: "CHECKING" } }))
      .id;
    const group = await db.group.create({ data: { name: "Foyer AB", createdById: muB } });
    await db.groupMember.createMany({
      data: [
        { groupId: group.id, userId: muB, role: "OWNER" },
        { groupId: group.id, userId: muA, role: "MEMBER" },
      ],
    });
    await db.accountShare.create({
      data: { accountId: accB, groupId: group.id, permission: "WRITE", createdById: muB },
    });

    batchOnB = (
      await db.importBatch.create({
        data: {
          accountId: accB,
          source: "CSV",
          filename: "a-on-b.csv",
          status: "COMPLETED",
          createdById: muA,
          metadata: { accountIds: [accB] },
        },
      })
    ).id;
    multiBatch = (
      await db.importBatch.create({
        data: {
          accountId: accB,
          source: "PDF",
          filename: "b-multi.pdf",
          status: "COMPLETED",
          createdById: muB,
          metadata: { accountIds: [accB, accA] },
        },
      })
    ).id;
    await db.importBatch.create({
      data: {
        accountId: accB,
        source: "CSV",
        filename: "b-only.csv",
        status: "COMPLETED",
        createdById: muB,
      },
    });

    txA = await createTx(accA, muA);
    txA2 = await createTx(accA, muB, multiBatch);
    txB = await createTx(accB, muA, batchOnB);
    txB2 = await createTx(accB, muB);

    mixedLink = (
      await db.transactionLink.create({
        data: {
          createdById: muB,
          members: { create: [{ transactionId: txA }, { transactionId: txB }] },
        },
      })
    ).id;
    await db.transactionLink.create({
      data: {
        createdById: muA,
        members: { create: [{ transactionId: txB2 }] },
      },
    });

    await db.ignoredLinkSuggestion.createMany({
      data: [
        { userId: muA, pairKey: [txA, txB].sort().join("|") },
        { userId: muA, pairKey: [txB, txB2].sort().join("|") },
      ],
    });
  });

  afterAll(cleanupMultiUser);

  it("keeps only the exporting user's transaction and account ids", async () => {
    const data = await exportUserData(muA);

    expect(data.transactions.map((t) => t.id).sort()).toEqual([txA, txA2].sort());
    expect(data.links).toEqual([expect.objectContaining({ id: mixedLink, transactionIds: [txA] })]);
    expect(data.ignoredLinkSuggestions).toEqual([
      expect.objectContaining({ transactionIds: [txA] }),
    ]);

    const imports = new Map(data.imports.map((i) => [i.id, i.accountIds]));
    expect(imports).toEqual(
      new Map([
        [batchOnB, []],
        [multiBatch, [accA]],
      ]),
    );

    const json = JSON.stringify(data);
    for (const foreignId of [accB, txB, txB2]) expect(json).not.toContain(foreignId);
  });
});

describe("rgpd", () => {
  it("streams the same JSON document as the whole export (#301)", async () => {
    let streamed = "";
    for await (const chunk of userDataJson(await exportParts(userId))) streamed += chunk;
    const whole = JSON.parse(JSON.stringify(await exportUserData(userId)));
    const parsed = JSON.parse(streamed);
    expect(Object.keys(parsed)).toEqual(Object.keys(whole));
    expect({ ...parsed, exportedAt: null }).toEqual({ ...whole, exportedAt: null });
    expect(parsed.transactions.length).toBeGreaterThan(0);
  });

  it("exportUserData returns the user's accounts, decrypted transactions, categories, budgets", async () => {
    const data = await exportUserData(userId);
    expect(data.user.id).toBe(userId);
    expect(data.accounts).toHaveLength(1);
    expect(data.transactions[0].label).toBe("Loyer"); // decrypted
    expect(data.transactions[0]).toMatchObject({
      periodDate: data.transactions[0].date,
      periodManual: false,
    });
    expect(data.budgets.length).toBeGreaterThanOrEqual(1);
    expect(data.merchantAliases).toEqual([{ merchant: "FONCIA LOYER", name: "Loyer" }]);
  });

  it("exportUserData decrypts the IBAN and the raw label instead of leaking ciphertext", async () => {
    const data = await exportUserData(userId);
    expect(data.accounts[0]).toMatchObject({ iban: IBAN, initialBalance: 0 });
    expect(data.accounts[0]).not.toHaveProperty("ibanEnc");
    expect(data.accounts[0]).not.toHaveProperty("ibanHash");
    expect(data.transactions[0]).toMatchObject({ rawLabel: "VIR LOYER", importBatchId: batchId });
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/"\w*(Enc|Hash)"/);
  });

  it("exportUserData includes links and import history, not raw files or invitation secrets", async () => {
    const data = await exportUserData(userId);
    expect(data.transactions[0].linkId).toBe(linkId);
    expect(data.links).toEqual([
      expect.objectContaining({
        id: linkId,
        name: "Loyer + remboursement",
        transactionIds: [txId],
      }),
    ]);
    expect(data.imports).toEqual([
      expect.objectContaining({
        id: batchId,
        filename: "releve-mars.csv",
        status: "REVIEW",
        accountIds: [accountId],
      }),
    ]);
    expect(data.imports[0]).not.toHaveProperty("metadata");
    expect(data.invitationsSent).toHaveLength(1);
    for (const secret of ["tokenEnc", "tokenHash", "codeEnc", "codeHash"]) {
      expect(data.invitationsSent[0]).not.toHaveProperty(secret);
    }
  });

  it("exportUserData lists the bank connections without their secrets", async () => {
    const data = await exportUserData(userId);
    expect(data.bankConnections).toEqual([
      {
        aspspName: "Banque Fictive",
        aspspCountry: "FR",
        status: "ACTIVE",
        validUntil: new Date("2027-05-02T09:00:00.000Z"),
        createdAt: expect.any(Date),
        lastSyncAt: null,
        accounts: [
          {
            name: "Compte Courant Test",
            currency: "EUR",
            accountId,
            syncFrom: null,
            lastSyncedDate: null,
          },
        ],
      },
    ]);
    const json = JSON.stringify(data);
    for (const secret of ["uidEnc", "sessionIdEnc", "ibanHash", "sess-fake-1", "uid-fake-a"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("deleteUser cascades owned data, clears FK-less rows, revokes sessions, keeps an anonymous audit entry", async () => {
    await db.session.create({
      data: { id: "s1", userId, token: "t1", expiresAt: new Date(Date.now() + 1e6) },
    });
    fake.calls.length = 0;
    await deleteUser(userId);
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await db.bankConnection.count({ where: { userId } })).toBe(0);
    expect(await db.bankConnectionAccount.count({ where: { accountId } })).toBe(0);
    expect(await db.bankAuthRequest.count({ where: { userId } })).toBe(0);
    expect(sessionDeletes()).toHaveLength(1);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.bankAccount.count({ where: { ownerId: userId } })).toBe(0);
    expect(await db.merchantAlias.count({ where: { userId } })).toBe(0);
    const audit = await db.auditLog.findFirst({
      where: { action: "user.deleted" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.userId).toBeNull(); // anonymous
  });

  it("deleteUser hands a solely-owned group to the earliest remaining member", async () => {
    await db.user.createMany({
      data: [
        { id: ownerB, email: "rgpd-ownerb@bilan.local" },
        { id: succ, email: "rgpd-succ@bilan.local" },
      ],
    });
    const g = await db.group.create({ data: { name: "FoyerB", createdById: ownerB } });
    await db.groupMember.create({
      data: {
        groupId: g.id,
        userId: ownerB,
        role: "OWNER",
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.groupMember.create({
      data: {
        groupId: g.id,
        userId: succ,
        role: "MEMBER",
        joinedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    await deleteUser(ownerB);

    const group = await db.group.findUnique({ where: { id: g.id } });
    expect(group).not.toBeNull(); // survives (has another member)
    expect(group?.createdById).toBe(succ); // ownership reassigned
    const succMember = await db.groupMember.findFirst({ where: { groupId: g.id, userId: succ } });
    expect(succMember?.role).toBe("OWNER"); // promoted
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: ownerB } })).toBe(0);
  });

  it("deleteUser goes on when the bank refuses to delete a session", async () => {
    const failing = "rgpd_bank_fail";
    await db.user.create({ data: { id: failing, email: "rgpd-bank-fail@bilan.local" } });
    await bankConnection(failing);
    fake.on("DELETE", /^\/sessions\//, { status: 500, body: {} });
    fake.calls.length = 0;
    await deleteUser(failing);
    expect(sessionDeletes()).toHaveLength(1);
    expect(await db.user.findUnique({ where: { id: failing } })).toBeNull();
    expect(await db.bankConnection.count({ where: { userId: failing } })).toBe(0);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { exportUserData, deleteUser } from "@/server/services/rgpd";
import { renameMerchant } from "@/server/services/merchants";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";

const userId = "rgpd_owner";
const ownerB = "rgpd_ownerB";
const succ = "rgpd_succ";
const IBAN = "FR7630006000011234567890189";
let accountId: string;
let groupId: string;
let txId: string;
let batchId: string;
let linkId: string;

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

  groupId = (await db.group.create({ data: { name: "Foyer", createdById: userId } })).id;
  await db.groupMember.create({ data: { groupId, userId, role: "OWNER" } });
  await db.groupInvitation.create({
    data: {
      groupId,
      email: "invitee@bilan.local",
      invitedById: userId,
      token: "rgpd-secret-token",
      code: "RGPD-CODE",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
});

afterAll(async () => {
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
  it("exportUserData returns the user's accounts, decrypted transactions, categories, budgets", async () => {
    const data = await exportUserData(userId);
    expect(data.user.id).toBe(userId);
    expect(data.accounts).toHaveLength(1);
    expect(data.transactions[0].label).toBe("Loyer"); // decrypted
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
    expect(data.invitationsSent[0]).not.toHaveProperty("token");
    expect(data.invitationsSent[0]).not.toHaveProperty("code");
  });

  it("deleteUser cascades owned data, clears FK-less rows, revokes sessions, keeps an anonymous audit entry", async () => {
    await db.session.create({
      data: { id: "s1", userId, token: "t1", expiresAt: new Date(Date.now() + 1e6) },
    });
    await deleteUser(userId);
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
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
});

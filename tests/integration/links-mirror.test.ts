import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { decrypt, encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { commitCsvBatch, createCsvBatch, previewCsvBatch } from "@/server/services/imports";
import { setSavingsMirror } from "@/server/services/accounts";
import { createEnableBankingClient } from "@/server/services/bank-sync/client";
import { syncConnection } from "@/server/services/bank-sync/sync";
import { mirrorExternalId, mirrorMatches, mirrorSavingsLegs } from "@/server/services/links/mirror";
import { setManualMonth } from "@/server/services/links/month";
import { pairKeyOf } from "@/lib/links";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { deleteTransactions } from "@/server/services/transactions/delete";
import { fakeEnableBanking, fakeTx, testKeyPair } from "../fixtures/enable-banking";

const owner = "mirror_owner";
const other = "mirror_other";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let courant: string;
let joint: string;
let livret: string;
let ldds: string;
let foreignSavings: string;
let connectionId: string;
let accounts: string[];

const account = (ownerId: string, name: string, type: string) =>
  db.bankAccount.create({ data: { ownerId, name, type } }).then((a) => a.id);

async function importCsv(accountId: string, lines: string[]): Promise<string> {
  const text = ["Date;Libellé;Débit;Crédit", ...lines].join("\n");
  const batch = await createCsvBatch({ accountId, filename: "m.csv", text }, { id: owner });
  const preview = await previewCsvBatch(batch.id, owner);
  await commitCsvBatch(batch.id, preview.mapping, { id: owner });
  return batch.id;
}

async function manual(accountId: string, iso: string, amount: number, type = "OTHER") {
  const s = buildSecureFields({ label: "Saisie test", rawLabel: "Saisie test" });
  return db.transaction.create({
    data: {
      accountId,
      date: day(iso),
      amount,
      type,
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      createdById: owner,
    },
  });
}

const rowsOn = (accountId: string) =>
  db.transaction.findMany({
    where: { accountId },
    include: { linkMembership: { include: { link: { include: { members: true } } } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

const partnerOf = (row: Awaited<ReturnType<typeof rowsOn>>[number]) =>
  row.linkMembership?.link.members.find((m) => m.transactionId !== row.id)?.transactionId;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  for (const id of [owner, other]) {
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  courant = await account(owner, "Courant", "CHECKING");
  joint = await account(owner, "Joint", "CHECKING");
  livret = await account(owner, "Livret A", "SAVINGS");
  ldds = await account(owner, "LDDS", "SAVINGS");
  foreignSavings = await account(other, "Autre livret", "SAVINGS");
  accounts = [courant, joint, livret, ldds, foreignSavings];
  connectionId = (
    await db.bankConnection.create({
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
    })
  ).id;
});

beforeEach(async () => {
  await db.transactionLink.deleteMany({
    where: { members: { some: { transaction: { accountId: { in: accounts } } } } },
  });
  await db.transaction.deleteMany({ where: { accountId: { in: accounts } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: accounts } } });
  await db.syncTombstone.deleteMany({ where: { accountId: { in: accounts } } });
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId: owner } });
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.savingsMirrorSource.deleteMany({ where: { savingsAccountId: { in: accounts } } });
  await db.bankAccount.updateMany({
    where: { id: { in: accounts } },
    data: { mirrorPattern: null, mirrorMatchType: "CONTAINS", archived: false },
  });
  await db.bankConnectionAccount.updateMany({
    where: { connectionId },
    data: { lastSyncedDate: null },
  });
  await db.bankConnection.update({
    where: { id: connectionId },
    data: { status: "ACTIVE", syncStartedAt: null, lastSyncAt: null },
  });
  await setSavingsMirror(owner, livret, { sourceAccountIds: [courant], pattern: "LIVRET A" });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await db.$disconnect();
});

describe("savings mirror legs", () => {
  it("adds the opposite leg of a matching transfer imported on a source", async () => {
    const batchId = await importCsv(courant, ["10/10/2026;VIR LIVRET A TEST;300,00;"]);
    const [source] = await rowsOn(courant);
    const [leg] = await rowsOn(livret);
    expect(leg).toMatchObject({
      date: day("2026-10-10"),
      type: "TRANSFER",
      externalId: mirrorExternalId({ accountId: courant, externalId: source.externalId! }),
      importBatchId: null,
      createdById: owner,
      categoryId: null,
    });
    expect(Number(leg.amount)).toBe(300);
    expect(decrypt(leg.labelEnc, dataKey)).toBe("Virement depuis Courant");
    expect(decrypt(leg.rawLabelEnc, dataKey)).toBe("Virement depuis Courant");
    expect(
      await db.transactionSearchToken.count({ where: { transactionId: leg.id } }),
    ).toBeGreaterThan(0);
    expect(partnerOf(leg)).toBe(source.id);
    expect(leg.linkMembership?.link.auto).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "link.mirrorCreated", entityId: batchId },
    });
    expect(audit).toMatchObject({ userId: owner, metadata: { count: 1, linked: 0 } });
  });

  it("an incoming transfer from the savings account takes money out of it", async () => {
    await importCsv(courant, ["10/10/2026;VIR LIVRET A TEST;;150,00"]);
    const [leg] = await rowsOn(livret);
    expect(Number(leg.amount)).toBe(-150);
    expect(decrypt(leg.labelEnc, dataKey)).toBe("Virement vers Courant");
  });

  it("does the same for a bank sync, and once only", async () => {
    const fake = fakeEnableBanking();
    fake.on("GET", /\/balances$/, { body: { balances: [] } });
    fake.on("GET", /\/transactions$/, {
      body: {
        transactions: [
          fakeTx({ date: "2026-10-12", amount: -200, label: "VIR LIVRET A TEST" }),
          fakeTx({ date: "2026-10-12", amount: -9.9, label: "CB CAFE TEST" }),
        ],
      },
    });
    const client = createEnableBankingClient({
      applicationId: "app-test-id",
      privateKeyPem: testKeyPair().privateKeyPem,
      fetch: fake.fetch,
    });
    const now = new Date("2026-11-03T10:00:00.000Z");
    expect((await syncConnection(connectionId, { client, now })).status).toBe("OK");
    await syncConnection(connectionId, { client, now: new Date("2026-11-04T10:00:00.000Z") });
    const legs = await rowsOn(livret);
    expect(legs).toHaveLength(1);
    expect(Number(legs[0].amount)).toBe(200);
    const [source] = (await rowsOn(courant)).filter((r) => Number(r.amount) === -200);
    expect(partnerOf(legs[0])).toBe(source.id);
  });

  it("re-importing the same file creates nothing more", async () => {
    const line = "10/10/2026;VIR LIVRET A TEST;300,00;";
    const batchId = await importCsv(courant, [line]);
    await expect(importCsv(courant, [line])).rejects.toThrow();
    expect(await mirrorSavingsLegs(batchId)).toEqual({ created: 0, linked: 0 });
    expect(await rowsOn(livret)).toHaveLength(1);
  });

  it("leaves cards, other labels, linked rows and unmirrored accounts alone", async () => {
    await manual(joint, "2026-10-11", 75, "TRANSFER");
    await importCsv(courant, [
      "10/10/2026;CB LIVRET A TEST;20,00;",
      "10/10/2026;VIR LOYER TEST;500,00;",
      "11/10/2026;VIR LIVRET A JOINT;75,00;",
    ]);
    await importCsv(joint, ["12/10/2026;VIR LIVRET A TEST;40,00;"]);
    expect(await rowsOn(livret)).toHaveLength(0);
    const jointToCourant = (await rowsOn(courant)).find((r) => Number(r.amount) === -75)!;
    expect(jointToCourant.linkMembership).not.toBeNull();
  });

  it("links an unlinked opposite row of the savings account instead", async () => {
    await manual(livret, "2026-10-12", 300);
    await importCsv(courant, ["10/10/2026;VIR LIVRET A TEST;300,00;"]);
    const legs = await rowsOn(livret);
    expect(legs).toHaveLength(1);
    const [source] = await rowsOn(courant);
    expect(partnerOf(legs[0])).toBe(source.id);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "link.mirrorCreated" } });
    expect(audit.metadata).toEqual({ count: 0, linked: 1 });
  });

  it("aligns the month of the new link of transfers", async () => {
    // Two transfers at the same distance: auto-links leave the tie alone.
    const first = await manual(livret, "2026-10-09", 300, "TRANSFER");
    await manual(livret, "2026-10-11", 300, "TRANSFER");
    await setManualMonth([{ id: first.id, date: first.date }], { year: 2026, month: 11 });
    await importCsv(courant, ["10/10/2026;VIR LIVRET A TEST;300,00;"]);
    const [source] = await rowsOn(courant);
    expect(partnerOf(source)).toBe(first.id);
    expect(source.periodManual).toBe(true);
    expect(source.periodDate.getUTCMonth()).toBe(10);
  });

  it("picks the closest date, then the earliest entered", async () => {
    await manual(livret, "2026-10-13", 300);
    const earliest = await manual(livret, "2026-10-09", 300);
    await manual(livret, "2026-10-11", 300);
    await importCsv(courant, ["10/10/2026;VIR LIVRET A TEST;300,00;"]);
    const [source] = await rowsOn(courant);
    expect(partnerOf(source)).toBe(earliest.id);
    expect(await rowsOn(livret)).toHaveLength(3);
  });

  it("skips a pair the owner dismissed", async () => {
    const entered = await manual(livret, "2026-10-11", 300);
    const batchId = await importCsv(courant, ["10/10/2026;VIR LIVRET A TEST;300,00;"]);
    const [source] = await rowsOn(courant);
    await db.transactionLink.deleteMany({
      where: { members: { some: { transactionId: source.id } } },
    });
    await db.ignoredLinkSuggestion.create({
      data: { userId: owner, pairKey: pairKeyOf(entered.id, source.id) },
    });
    expect(await mirrorSavingsLegs(batchId)).toEqual({ created: 1, linked: 0 });
    expect(await rowsOn(livret)).toHaveLength(2);
  });

  it("deleting the source row keeps the leg, and the next import does not add another", async () => {
    const line = "10/10/2026;VIR LIVRET A TEST;300,00;";
    await importCsv(courant, [line]);
    const [source] = await rowsOn(courant);
    await deleteTransactions(owner, [source.id]);
    const [leg] = await rowsOn(livret);
    expect(leg.linkMembership).toBeNull();
    await importCsv(courant, [line]);
    const legs = await rowsOn(livret);
    expect(legs).toHaveLength(1);
    expect(partnerOf(legs[0])).toBe((await rowsOn(courant))[0].id);
  });

  it("a deleted mirror leg is not created again", async () => {
    const line = "10/10/2026;VIR LIVRET A TEST;300,00;";
    const batchId = await importCsv(courant, [line]);
    const [source] = await rowsOn(courant);
    const [leg] = await rowsOn(livret);
    await deleteTransactions(owner, [leg.id]);
    expect(
      await db.syncTombstone.count({ where: { accountId: livret, externalId: leg.externalId! } }),
    ).toBe(1);
    expect(await mirrorSavingsLegs(batchId)).toEqual({ created: 0, linked: 0 });
    await deleteTransactions(owner, [source.id]);
    await importCsv(courant, [line]);
    expect(await rowsOn(livret)).toHaveLength(0);
  });

  it("the longest matching pattern wins between savings accounts", async () => {
    await setSavingsMirror(owner, ldds, { sourceAccountIds: [courant], pattern: "LIVRET" });
    await importCsv(courant, [
      "10/10/2026;VIR LIVRET A TEST;300,00;",
      "11/10/2026;VIR LIVRET DD TEST;50,00;",
    ]);
    expect((await rowsOn(livret)).map((r) => Number(r.amount))).toEqual([300]);
    expect((await rowsOn(ldds)).map((r) => Number(r.amount))).toEqual([50]);
  });

  it("exact mode mirrors only the transfers whose whole label is the pattern", async () => {
    await setSavingsMirror(owner, livret, {
      sourceAccountIds: [courant],
      pattern: "VIR.PERMANENT Livret A",
      matchType: "EXACT",
    });
    await importCsv(courant, [
      "05/10/2026;VIR.PERMANENT Livret A;100,00;",
      "05/10/2026;VIR.PERMANENT Livret A Camille;30,00;",
      "05/10/2026;VIR.PERMANENT Livret A Lucas;20,00;",
    ]);
    expect((await rowsOn(livret)).map((r) => Number(r.amount))).toEqual([100]);
  });

  it("an exact match beats a contains one of the same length", async () => {
    await setSavingsMirror(owner, livret, {
      sourceAccountIds: [courant],
      pattern: "VIR.PERMANENT LIVRET A",
    });
    await setSavingsMirror(owner, ldds, {
      sourceAccountIds: [courant],
      pattern: "vir.permanent livret a",
      matchType: "EXACT",
    });
    await importCsv(courant, [
      "05/10/2026;VIR.PERMANENT Livret A;100,00;",
      "05/10/2026;VIR.PERMANENT Livret A Camille;30,00;",
    ]);
    expect((await rowsOn(ldds)).map((r) => Number(r.amount))).toEqual([100]);
    expect((await rowsOn(livret)).map((r) => Number(r.amount))).toEqual([30]);
  });

  it("never writes to a savings account of another owner, nor an archived one", async () => {
    await db.bankAccount.update({
      where: { id: foreignSavings },
      data: { mirrorPattern: "LIVRET A" },
    });
    await db.savingsMirrorSource.create({
      data: { savingsAccountId: foreignSavings, sourceAccountId: courant },
    });
    await db.bankAccount.update({ where: { id: livret }, data: { archived: true } });
    await importCsv(courant, ["10/10/2026;VIR LIVRET A TEST;300,00;"]);
    expect(await rowsOn(foreignSavings)).toHaveLength(0);
    expect(await rowsOn(livret)).toHaveLength(0);
  });
});

describe("mirror label matching", () => {
  const exact = { pattern: "VIR.PERMANENT Livret A", matchType: "EXACT" } as const;
  const contains = { pattern: "VIR.PERMANENT Livret A", matchType: "CONTAINS" } as const;

  it("exact ignores case, accents, surrounding and repeated spaces", () => {
    expect(mirrorMatches(exact, "VIR.PERMANENT Livret A")).toBe(true);
    expect(mirrorMatches(exact, "  vir.permanent   LIVRET\u00a0A ")).toBe(true);
    expect(mirrorMatches({ ...exact, pattern: "VIR LIVRET EPARGNE" }, "VIR Livret Épargne")).toBe(
      true,
    );
    expect(mirrorMatches(exact, "VIR.PERMANENT Livret A Camille")).toBe(false);
    expect(mirrorMatches(exact, "VIR.PERMANENT Livret")).toBe(false);
  });

  it("contains matches the pattern anywhere", () => {
    expect(mirrorMatches(contains, "VIR.PERMANENT Livret A Camille")).toBe(true);
    expect(mirrorMatches(contains, "VIR.PERMANENT Livret B")).toBe(false);
  });
});

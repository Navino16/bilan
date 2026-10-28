import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { autoLinkTransfers, createLink, deleteLink, pairKeyOf } from "@/server/services/links";
import { getDashboard } from "@/server/services/dashboard";
import { createTransaction } from "@/server/services/transactions";
import { commitCsvBatch, createCsvBatch, previewCsvBatch } from "@/server/services/imports";
import { comparisonFor, monthPeriod } from "@/lib/period";

const owner = "autolink_owner";
const other = "autolink_other";
let courant: string;
let livret: string;
let joint: string;
let shared: string; // other's account, shared with the owner (WRITE)
let groupId: string;

async function tx(accountId: string, day: string, amount: number, label = "VIR"): Promise<string> {
  const s = buildSecureFields({ label, rawLabel: label });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(`${day}T00:00:00.000Z`),
      amount,
      type: "TRANSFER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      createdById: owner,
    },
  });
  return row.id;
}

const linkOf = (id: string) =>
  db.transactionLinkMember.findUnique({ where: { transactionId: id }, include: { link: true } });

async function clean() {
  const accounts = [courant, livret, joint, shared];
  await db.transactionLink.deleteMany({
    where: { members: { some: { transaction: { accountId: { in: accounts } } } } },
  });
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.transaction.deleteMany({ where: { accountId: { in: accounts } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: accounts } } });
}

beforeAll(async () => {
  for (const id of [owner, other]) {
    await db.user.deleteMany({ where: { id } });
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  courant = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  livret = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Livret", type: "SAVINGS" } })
  ).id;
  joint = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Commun", type: "CHECKING" } })
  ).id;
  shared = (
    await db.bankAccount.create({ data: { ownerId: other, name: "Joint", type: "CHECKING" } })
  ).id;
  groupId = (await db.group.create({ data: { name: "Foyer", createdById: other } })).id;
  await db.groupMember.create({ data: { groupId, userId: owner, role: "MEMBER" } });
  await db.accountShare.create({
    data: { accountId: shared, groupId, permission: "WRITE", createdById: other },
  });
});

beforeEach(clean);

afterAll(async () => {
  await clean();
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, other] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await db.$disconnect();
});

describe("autoLinkTransfers", () => {
  it("links a transfer between two owned accounts", async () => {
    const out = await tx(courant, "2026-03-03", -200);
    const into = await tx(livret, "2026-03-04", 200);
    expect(await autoLinkTransfers(owner)).toEqual({ linked: 1 });
    const a = await linkOf(out);
    const b = await linkOf(into);
    expect(a?.linkId).toBeTruthy();
    expect(b?.linkId).toBe(a?.linkId);
    expect(a?.link.auto).toBe(true);
    expect(a?.link.createdById).toBe(owner);
  });

  it("never links to an account the user does not own", async () => {
    await tx(courant, "2026-03-03", -50);
    await tx(shared, "2026-03-04", 50);
    expect(await autoLinkTransfers(owner)).toEqual({ linked: 0 });
  });

  it("only scans around the given range", async () => {
    const out = await tx(courant, "2026-01-10", -70);
    await tx(livret, "2026-01-11", 70);
    const range = { from: new Date("2026-03-01"), to: new Date("2026-03-31") };
    expect(await autoLinkTransfers(owner, range)).toEqual({ linked: 0 });
    expect(await linkOf(out)).toBeNull();
  });

  it("does not recreate a deleted auto link", async () => {
    const out = await tx(courant, "2026-03-03", -200);
    const into = await tx(livret, "2026-03-04", 200);
    await autoLinkTransfers(owner);
    await deleteLink((await linkOf(out))!.linkId, owner);
    expect(await autoLinkTransfers(owner)).toEqual({ linked: 0 });
    const ignored = await db.ignoredLinkSuggestion.findMany({ where: { userId: owner } });
    expect(ignored.map((r) => r.pairKey)).toEqual([pairKeyOf(out, into)]);
  });

  it("links what a first pass leaves unique", async () => {
    // P prefers N1; N2 ties between P and Q until P is linked.
    await tx(livret, "2026-03-01", 40);
    await tx(courant, "2026-03-01", -40);
    const n2 = await tx(joint, "2026-03-03", -40);
    const q = await tx(courant, "2026-03-05", 40);
    expect(await autoLinkTransfers(owner)).toEqual({ linked: 2 });
    expect((await linkOf(n2))?.linkId).toBe((await linkOf(q))?.linkId);
  });

  it("does not take a worse partner because the better one is just outside the range", async () => {
    const worse = await tx(courant, "2026-03-06", -100);
    await tx(livret, "2026-03-09", 100);
    await tx(joint, "2026-03-11", -100);
    const day = new Date("2026-03-05T00:00:00.000Z");
    await autoLinkTransfers(owner, { from: day, to: day });
    expect(await linkOf(worse)).toBeNull();
  });

  it("deleting a manual link records nothing", async () => {
    const out = await tx(courant, "2026-03-03", -200);
    const into = await tx(livret, "2026-03-04", 200);
    const { id } = await createLink({ transactionIds: [out, into], userId: owner });
    await deleteLink(id, owner);
    expect(await db.ignoredLinkSuggestion.count({ where: { userId: owner } })).toBe(0);
  });

  it("drops an auto-linked transfer from the dashboard totals", async () => {
    await tx(courant, "2026-03-03", -200);
    await tx(livret, "2026-03-04", 200);
    const period = monthPeriod(2026, 3);
    const comparison = comparisonFor(period, "prev", new Date("2026-10-05"));
    const before = await getDashboard(owner, period, comparison);
    expect([before.totals.income, before.totals.expense]).toEqual([200, 200]);
    await autoLinkTransfers(owner);
    const after = await getDashboard(owner, period, comparison);
    expect([after.totals.income, after.totals.expense]).toEqual([0, 0]);
  });
});

describe("automatic linking hooks", () => {
  it("links at CSV import", async () => {
    const out = await tx(courant, "2026-04-02", -300);
    const csv = "Date;Libellé;Débit;Crédit\n03/04/2026;VIR SEPA EPARGNE;;300,00";
    const batch = await createCsvBatch(
      { accountId: livret, filename: "l.csv", text: csv },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    const link = await linkOf(out);
    expect(link?.link.auto).toBe(true);
  });

  it("links a manual transaction when asked", async () => {
    const out = await tx(courant, "2026-04-02", -80);
    const input = { accountId: livret, date: "2026-04-03", type: "TRANSFER" as const };
    const plain = await createTransaction({ ...input, amount: 80, label: "VIR" }, { id: owner });
    expect(await linkOf(out)).toBeNull();
    await db.transaction.delete({ where: { id: plain.id } });
    await createTransaction(
      { ...input, amount: 80, label: "VIR" },
      { id: owner },
      { autoLink: true },
    );
    expect((await linkOf(out))?.link.auto).toBe(true);
  });

  it("the backfill is idempotent", async () => {
    await tx(courant, "2026-02-02", -10);
    await tx(livret, "2026-02-03", 10);
    await tx(courant, "2026-05-02", -20);
    await tx(livret, "2026-05-03", 20);
    expect(await autoLinkTransfers(owner)).toEqual({ linked: 2 });
    expect(await autoLinkTransfers(owner)).toEqual({ linked: 0 });
  });
});

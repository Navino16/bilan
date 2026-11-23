import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { setTransactionMonth } from "@/server/services/transactions";
import { autoLinkTransfers, createLink } from "@/server/services/links";

const owner = "linkmonth_owner";
const other = "linkmonth_other";
let courant: string;
let joint: string;
let readOnly: string; // other's account, shared with the owner (READ)
let groupId: string;

async function tx(
  accountId: string,
  day: string,
  amount: number,
  extra: { type?: string; periodDate?: string; periodManual?: boolean } = {},
): Promise<string> {
  const s = buildSecureFields({ label: "VIR", rawLabel: "VIR" });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(`${day}T00:00:00.000Z`),
      periodDate: new Date(`${extra.periodDate ?? day}T00:00:00.000Z`),
      periodManual: extra.periodManual ?? false,
      amount,
      type: extra.type ?? "TRANSFER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      createdById: owner,
    },
  });
  return row.id;
}

const link = (ids: string[], createdById = owner) =>
  db.transactionLink.create({
    data: { createdById, members: { create: ids.map((transactionId) => ({ transactionId })) } },
  });

async function month(id: string): Promise<[string, boolean]> {
  const row = await db.transaction.findUniqueOrThrow({ where: { id } });
  return [row.periodDate.toISOString().slice(0, 10), row.periodManual];
}

async function clean() {
  const accounts = [courant, joint, readOnly];
  await db.transactionLink.deleteMany({
    where: { members: { some: { transaction: { accountId: { in: accounts } } } } },
  });
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.transaction.deleteMany({ where: { accountId: { in: accounts } } });
}

beforeAll(async () => {
  for (const id of [owner, other]) {
    await db.user.deleteMany({ where: { id } });
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  courant = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  joint = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Commun", type: "CHECKING" } })
  ).id;
  readOnly = (
    await db.bankAccount.create({ data: { ownerId: other, name: "Joint", type: "CHECKING" } })
  ).id;
  groupId = (await db.group.create({ data: { name: "Foyer", createdById: other } })).id;
  await db.groupMember.create({ data: { groupId, userId: owner, role: "MEMBER" } });
  await db.accountShare.create({
    data: { accountId: readOnly, groupId, permission: "READ", createdById: other },
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

describe("setTransactionMonth on a linked transfer", () => {
  it("moves the other leg to the same month, then back to automatic", async () => {
    const out = await tx(courant, "2026-09-30", -500);
    const into = await tx(joint, "2026-09-30", 500);
    await link([out, into]);
    await setTransactionMonth(out, { year: 2026, month: 10 }, { id: owner });
    expect(await month(into)).toEqual(["2026-10-01", true]);
    await setTransactionMonth(out, null, { id: owner });
    expect(await month(into)).toEqual(["2026-09-30", false]);
  });

  it("pins each leg to its own date when the month is its real one", async () => {
    const out = await tx(courant, "2026-09-30", -500);
    const into = await tx(joint, "2026-10-01", 500);
    await link([out, into]);
    await setTransactionMonth(out, { year: 2026, month: 10 }, { id: owner });
    expect(await month(out)).toEqual(["2026-10-01", true]);
    expect(await month(into)).toEqual(["2026-10-01", true]);
  });

  it("leaves the other members of a link that is not only transfers", async () => {
    const out = await tx(courant, "2026-09-30", -500);
    const card = await tx(joint, "2026-09-30", 500, { type: "CARD" });
    await link([out, card]);
    await setTransactionMonth(out, { year: 2026, month: 10 }, { id: owner });
    expect(await month(card)).toEqual(["2026-09-30", false]);
  });

  it("skips a leg the actor cannot write", async () => {
    const out = await tx(courant, "2026-09-30", -500);
    const into = await tx(readOnly, "2026-09-30", 500);
    await link([out, into], other);
    await setTransactionMonth(out, { year: 2026, month: 10 }, { id: owner });
    expect(await month(out)).toEqual(["2026-10-01", true]);
    expect(await month(into)).toEqual(["2026-09-30", false]);
  });
});

describe("linking transfers aligns a manual month", () => {
  it("gives the other leg the one manual month on createLink", async () => {
    const out = await tx(courant, "2026-09-30", -500, {
      periodDate: "2026-10-01",
      periodManual: true,
    });
    const into = await tx(joint, "2026-09-30", 500);
    await createLink({ transactionIds: [out, into], userId: owner });
    expect(await month(into)).toEqual(["2026-10-01", true]);
  });

  it("changes nothing when two legs have a manual month", async () => {
    const out = await tx(courant, "2026-09-30", -500, {
      periodDate: "2026-10-01",
      periodManual: true,
    });
    const into = await tx(joint, "2026-09-30", 500, {
      periodDate: "2026-08-01",
      periodManual: true,
    });
    await createLink({ transactionIds: [out, into], userId: owner });
    expect(await month(out)).toEqual(["2026-10-01", true]);
    expect(await month(into)).toEqual(["2026-08-01", true]);
  });

  it("changes nothing when a leg is not a transfer", async () => {
    const out = await tx(courant, "2026-09-30", -500, {
      periodDate: "2026-10-01",
      periodManual: true,
    });
    const card = await tx(joint, "2026-09-30", 500, { type: "CARD" });
    await createLink({ transactionIds: [out, card], userId: owner });
    expect(await month(card)).toEqual(["2026-09-30", false]);
  });

  it("gives the other leg the manual month on an automatic link", async () => {
    const out = await tx(courant, "2026-09-29", -500);
    const into = await tx(joint, "2026-10-01", 500, {
      periodDate: "2026-09-01",
      periodManual: true,
    });
    expect(await autoLinkTransfers(owner)).toEqual({ linked: 1 });
    expect(await month(into)).toEqual(["2026-09-01", true]);
    expect(await month(out)).toEqual(["2026-09-29", true]);
  });
});

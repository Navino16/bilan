import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink, deleteLink, listLinkedTxIds, LinkAccessError } from "@/server/services/links";

const owner = "link_owner";
const stranger = "link_stranger";
let accountId: string;
let strangerAccountId: string;

async function tx(accId: string, date: string, amount: number, label: string): Promise<string> {
  const s = buildSecureFields({ label, rawLabel: label });
  const row = await db.transaction.create({
    data: {
      accountId: accId,
      date: new Date(date),
      amount,
      type: "OTHER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      createdById: owner,
    },
  });
  return row.id;
}

beforeAll(async () => {
  for (const id of [owner, stranger]) {
    await db.user.deleteMany({ where: { id } });
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  strangerAccountId = (
    await db.bankAccount.create({ data: { ownerId: stranger, name: "Autre", type: "CHECKING" } })
  ).id;
});

beforeEach(async () => {
  await db.transactionLinkMember.deleteMany({});
  await db.transactionLink.deleteMany({});
  await db.transaction.deleteMany({ where: { accountId: { in: [accountId, strangerAccountId] } } });
});

afterAll(async () => {
  await db.transactionLinkMember.deleteMany({});
  await db.transactionLink.deleteMany({});
  await db.transaction.deleteMany({ where: { accountId: { in: [accountId, strangerAccountId] } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("createLink", () => {
  it("links two visible transactions and lists their ids as linked", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const { id } = await createLink({ transactionIds: [a, b], userId: owner });
    expect(id).toBeTruthy();
    const linked = await listLinkedTxIds(owner);
    expect([...linked].sort()).toEqual([a, b].sort());
  });

  it("rejects a link with fewer than two transactions", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    await expect(createLink({ transactionIds: [a], userId: owner })).rejects.toBeInstanceOf(
      LinkAccessError,
    );
  });

  it("rejects linking a transaction the user cannot see", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const foreign = await tx(strangerAccountId, "2026-03-02T00:00:00.000Z", 50, "REMB");
    await expect(
      createLink({ transactionIds: [a, foreign], userId: owner }),
    ).rejects.toBeInstanceOf(LinkAccessError);
  });

  it("rejects linking a transaction already in a link", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const c = await tx(accountId, "2026-03-06T00:00:00.000Z", 20, "AUTRE");
    await createLink({ transactionIds: [a, b], userId: owner });
    await expect(createLink({ transactionIds: [a, c], userId: owner })).rejects.toBeInstanceOf(
      LinkAccessError,
    );
  });
});

describe("deleteLink", () => {
  it("removes the link and frees its members", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const { id } = await createLink({ transactionIds: [a, b], userId: owner });
    await deleteLink(id, owner);
    expect((await listLinkedTxIds(owner)).size).toBe(0);
  });

  it("rejects deleting a link the user did not create", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const { id } = await createLink({ transactionIds: [a, b], userId: owner });
    await expect(deleteLink(id, stranger)).rejects.toBeInstanceOf(LinkAccessError);
  });
});

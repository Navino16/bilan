import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import {
  createLink,
  deleteLink,
  listLinkedTxIds,
  suggestPairs,
  ignoreSuggestion,
  LinkAccessError,
} from "@/server/services/links";

const owner = "link_owner";
const stranger = "link_stranger";
const reader = "link_reader"; // READ-only share on the owner's account
const writer = "link_writer"; // WRITE share on the owner's account
let accountId: string;
let strangerAccountId: string;
let readGroupId: string;
let writeGroupId: string;

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
  for (const id of [owner, stranger, reader, writer]) {
    await db.user.deleteMany({ where: { id } });
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  strangerAccountId = (
    await db.bankAccount.create({ data: { ownerId: stranger, name: "Autre", type: "CHECKING" } })
  ).id;

  // Share the owner's account READ with `reader` and WRITE with `writer`, each
  // via a group they belong to.
  readGroupId = (await db.group.create({ data: { name: "ReadGrp", createdById: owner } })).id;
  writeGroupId = (await db.group.create({ data: { name: "WriteGrp", createdById: owner } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId: readGroupId, userId: reader, role: "MEMBER" },
      { groupId: writeGroupId, userId: writer, role: "MEMBER" },
    ],
  });
  await db.accountShare.createMany({
    data: [
      { accountId, groupId: readGroupId, permission: "READ", createdById: owner },
      { accountId, groupId: writeGroupId, permission: "WRITE", createdById: owner },
    ],
  });
});

beforeEach(async () => {
  await db.transactionLinkMember.deleteMany({});
  await db.transactionLink.deleteMany({});
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId: { in: [owner, stranger] } } });
  await db.transaction.deleteMany({ where: { accountId: { in: [accountId, strangerAccountId] } } });
});

afterAll(async () => {
  await db.transactionLinkMember.deleteMany({});
  await db.transactionLink.deleteMany({});
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId: { in: [owner, stranger] } } });
  await db.transaction.deleteMany({ where: { accountId: { in: [accountId, strangerAccountId] } } });
  await db.accountShare.deleteMany({ where: { groupId: { in: [readGroupId, writeGroupId] } } });
  await db.groupMember.deleteMany({ where: { groupId: { in: [readGroupId, writeGroupId] } } });
  await db.group.deleteMany({ where: { id: { in: [readGroupId, writeGroupId] } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger, reader, writer] } } });
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

  it("rejects deleting a link from a user with no access to its transactions", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const { id } = await createLink({ transactionIds: [a, b], userId: owner });
    await expect(deleteLink(id, stranger)).rejects.toBeInstanceOf(LinkAccessError);
  });
});

describe("link authorization requires WRITE", () => {
  it("createLink rejects a READ-only collaborator but allows a WRITE one", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    // READ-only share → cannot mutate the owner's data by linking.
    await expect(createLink({ transactionIds: [a, b], userId: reader })).rejects.toBeInstanceOf(
      LinkAccessError,
    );
    // WRITE share → allowed.
    const { id } = await createLink({ transactionIds: [a, b], userId: writer });
    expect(id).toBeTruthy();
  });

  it("deleteLink allows any WRITE user (incl. the owner) and rejects READ-only", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    // Link created by the WRITE collaborator…
    const { id } = await createLink({ transactionIds: [a, b], userId: writer });
    // …a READ-only user cannot delete it.
    await expect(deleteLink(id, reader)).rejects.toBeInstanceOf(LinkAccessError);
    // …but the account owner (not the creator) can unlink their own transactions.
    await deleteLink(id, owner);
    expect((await listLinkedTxIds(owner)).size).toBe(0);
  });
});

describe("suggestPairs", () => {
  it("suggests an opposite pair within the user's window and respects ignore", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");

    const first = await suggestPairs(owner);
    expect(first.map((p) => p.key)).toContain([a, b].sort().join("|"));
    // Carries decrypted labels for display.
    expect(first[0].positiveLabel).toBeTruthy();
    expect(first[0].negativeLabel).toBeTruthy();

    await ignoreSuggestion(owner, [a, b].sort().join("|"));
    const second = await suggestPairs(owner);
    expect(second.some((p) => p.key === [a, b].sort().join("|"))).toBe(false);
  });

  it("excludes transactions already linked", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -70, "CB DARTY");
    const b = await tx(accountId, "2026-03-04T00:00:00.000Z", 70, "REMB DARTY");
    await createLink({ transactionIds: [a, b], userId: owner });
    const pairs = await suggestPairs(owner);
    expect(pairs.some((p) => p.key === [a, b].sort().join("|"))).toBe(false);
  });
});

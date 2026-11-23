import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import {
  createLink,
  deleteLink,
  getLinkSummary,
  listIgnoredSuggestions,
  listLinkedTxIds,
  pairKeyOf,
  restoreSuggestion,
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
    expect(first[0].positive.label).toBe("REMB FNAC");
    expect(first[0].negative.label).toBe("CB FNAC");

    await ignoreSuggestion(owner, [a, b].sort().join("|"));
    const second = await suggestPairs(owner);
    expect(second.some((p) => p.key === [a, b].sort().join("|"))).toBe(false);
  });

  it("carries each leg's day and account name", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -40, "CB BOULANGER");
    const b = await tx(strangerAccountId, "2026-03-06T00:00:00.000Z", 40, "REMB BOULANGER");
    await tx(accountId, "2026-03-06T00:00:00.000Z", 40, "AVOIR BOULANGER");
    const [pair] = (await suggestPairs(owner)).filter((p) => p.negativeId === a);
    expect(pair).toMatchObject({
      negative: { date: "2026-03-02", accountName: "Courant", label: "CB BOULANGER" },
      positive: { date: "2026-03-06", accountName: "Courant", label: "AVOIR BOULANGER" },
    });
    expect(pair.positiveId).not.toBe(b);
  });

  it("excludes transactions already linked", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -70, "CB DARTY");
    const b = await tx(accountId, "2026-03-04T00:00:00.000Z", 70, "REMB DARTY");
    await createLink({ transactionIds: [a, b], userId: owner });
    const pairs = await suggestPairs(owner);
    expect(pairs.some((p) => p.key === [a, b].sort().join("|"))).toBe(false);
  });

  it("decrypts only each leg's own label and keeps its own date and account", async () => {
    const neg = await tx(accountId, "2026-04-02T00:00:00.000Z", -42.5, "CB DECATHLON");
    const pos = await tx(accountId, "2026-04-06T00:00:00.000Z", 42.5, "REMB DECATHLON");
    await tx(accountId, "2026-04-03T00:00:00.000Z", -13, "CB BOULANGERIE");

    expect(await suggestPairs(owner)).toEqual([
      {
        key: [neg, pos].sort().join("|"),
        positiveId: pos,
        negativeId: neg,
        amount: 42.5,
        dayDelta: 4,
        score: expect.any(Number),
        positive: { id: pos, label: "REMB DECATHLON", date: "2026-04-06", accountName: "Courant" },
        negative: { id: neg, label: "CB DECATHLON", date: "2026-04-02", accountName: "Courant" },
      },
    ]);
  });

  it("covers accounts shared with the user and nothing for a user without accounts", async () => {
    const a = await tx(accountId, "2026-05-02T00:00:00.000Z", -30, "CB SPORT");
    const b = await tx(accountId, "2026-05-03T00:00:00.000Z", 30, "REMB SPORT");
    expect((await suggestPairs(reader)).map((p) => p.key)).toEqual([[a, b].sort().join("|")]);
    expect(await suggestPairs("link_nobody")).toEqual([]);
  });

  it("keeps each user's pairs to the accounts they can see", async () => {
    const own = [
      await tx(accountId, "2026-06-02T00:00:00.000Z", -20, "CB OWNER"),
      await tx(accountId, "2026-06-03T00:00:00.000Z", 20, "REMB OWNER"),
    ];
    const foreign = [
      await tx(strangerAccountId, "2026-06-02T00:00:00.000Z", -20, "CB STRANGER"),
      await tx(strangerAccountId, "2026-06-03T00:00:00.000Z", 20, "REMB STRANGER"),
    ];
    expect((await suggestPairs(owner)).map((p) => p.key)).toEqual([own.sort().join("|")]);
    expect((await suggestPairs(stranger)).map((p) => p.key)).toEqual([foreign.sort().join("|")]);
  });

  it("still suggests pairs on an archived account", async () => {
    const archived = await db.bankAccount.create({
      data: { ownerId: owner, name: "Ancien", type: "CHECKING", archived: true },
    });
    try {
      const a = await tx(archived.id, "2026-07-02T00:00:00.000Z", -15, "CB ARCHIVE");
      const b = await tx(archived.id, "2026-07-04T00:00:00.000Z", 15, "REMB ARCHIVE");
      const pairs = await suggestPairs(owner);
      expect(pairs.map((p) => p.key)).toEqual([[a, b].sort().join("|")]);
      expect(pairs[0].negative.accountName).toBe("Ancien");
    } finally {
      await db.bankAccount.delete({ where: { id: archived.id } });
    }
  });
});

describe("ignored suggestions", () => {
  it("lists the user's ignored pairs with both legs and restores one", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -30, "CB CINEMA");
    const b = await tx(accountId, "2026-03-03T00:00:00.000Z", 30, "REMB CINEMA");
    const key = pairKeyOf(a, b);
    await ignoreSuggestion(owner, key);

    const ignored = await listIgnoredSuggestions(owner);
    expect(ignored).toEqual([
      {
        key,
        amount: 30,
        negative: { id: a, label: "CB CINEMA", date: "2026-03-02", accountName: "Courant" },
        positive: { id: b, label: "REMB CINEMA", date: "2026-03-03", accountName: "Courant" },
      },
    ]);
    expect(await listIgnoredSuggestions(stranger)).toEqual([]);

    await restoreSuggestion(owner, key);
    expect(await listIgnoredSuggestions(owner)).toEqual([]);
    expect((await suggestPairs(owner)).map((p) => p.key)).toContain(key);
  });

  it("hides pairs whose legs were deleted, linked or are no longer visible", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -30, "A");
    const b = await tx(accountId, "2026-03-03T00:00:00.000Z", 30, "B");
    const c = await tx(accountId, "2026-03-04T00:00:00.000Z", -12, "C");
    const d = await tx(accountId, "2026-03-05T00:00:00.000Z", 12, "D");
    const foreign = await tx(strangerAccountId, "2026-03-05T00:00:00.000Z", 30, "F");
    await ignoreSuggestion(owner, pairKeyOf(a, b));
    await ignoreSuggestion(owner, pairKeyOf(c, d));
    await ignoreSuggestion(owner, pairKeyOf(a, foreign));
    await db.transaction.delete({ where: { id: b } });
    await createLink({ transactionIds: [c, d], userId: owner });
    expect(await listIgnoredSuggestions(owner)).toEqual([]);
  });

  it("refuses to restore a pair the user never ignored", async () => {
    await expect(restoreSuggestion(owner, "x|y")).rejects.toBeInstanceOf(LinkAccessError);
  });
});

describe("getLinkSummary", () => {
  it("lists the other members and whether the viewer may unlink", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const { id } = await createLink({ transactionIds: [a, b], userId: owner });

    expect(await getLinkSummary(a, owner)).toEqual({
      linkId: id,
      others: [
        { id: b, label: "REMB FNAC", date: "2026-03-05", accountName: "Courant", amount: 50 },
      ],
      hiddenCount: 0,
      canUnlink: true,
    });
    expect((await getLinkSummary(a, reader))?.canUnlink).toBe(false);
    expect((await getLinkSummary(a, writer))?.canUnlink).toBe(true);
  });

  it("counts members on accounts the viewer can't see without revealing them", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const foreign = await tx(strangerAccountId, "2026-03-05T00:00:00.000Z", 50, "SECRET");
    const link = await db.transactionLink.create({
      data: {
        createdById: owner,
        members: { create: [{ transactionId: a }, { transactionId: foreign }] },
      },
    });
    const summary = await getLinkSummary(a, owner);
    expect(summary).toMatchObject({
      linkId: link.id,
      others: [],
      hiddenCount: 1,
      canUnlink: false,
    });
  });

  it("returns null for an unlinked or invisible transaction", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    expect(await getLinkSummary(a, owner)).toBeNull();
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    await createLink({ transactionIds: [a, b], userId: owner });
    expect(await getLinkSummary(a, stranger)).toBeNull();
  });
});

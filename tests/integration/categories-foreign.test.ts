import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listForeignCategories } from "@/server/services/categories";

const owner = "fc_owner";
const member = "fc_member";
let groupId: string;
let parentId: string;
let childId: string;
let hiddenId: string;
let memberCatId: string;
let archivedCatId: string;
let sharedId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  await db.user.create({ data: { id: owner, email: "fc-owner@bilan.local" } });
  await db.user.create({ data: { id: member, email: "fc-member@bilan.local" } });
  const shared = await db.bankAccount.create({
    data: { ownerId: owner, name: "Joint", type: "CHECKING" },
  });
  const personal = await db.bankAccount.create({
    data: { ownerId: owner, name: "Perso", type: "CHECKING" },
  });
  const archived = await db.bankAccount.create({
    data: { ownerId: owner, name: "Ancien", type: "CHECKING", archived: true },
  });
  const mine = await db.bankAccount.create({
    data: { ownerId: member, name: "Mien", type: "CHECKING" },
  });
  sharedId = shared.id;
  groupId = (await db.group.create({ data: { name: "Foyer FC", createdById: owner } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: owner, role: "OWNER" },
      { groupId, userId: member, role: "MEMBER" },
    ],
  });
  await db.accountShare.createMany({
    data: [shared.id, archived.id].map((accountId) => ({
      accountId,
      groupId,
      permission: "READ",
      createdById: owner,
    })),
  });
  parentId = (await db.category.create({ data: { name: "Maison", userId: owner, color: "#123" } }))
    .id;
  childId = (await db.category.create({ data: { name: "Travaux", userId: owner, parentId } })).id;
  hiddenId = (await db.category.create({ data: { name: "Secret", userId: owner } })).id;
  archivedCatId = (await db.category.create({ data: { name: "Vieux", userId: owner } })).id;
  memberCatId = (await db.category.create({ data: { name: "Courses", userId: member } })).id;

  const tx = (accountId: string, categoryId: string, label: string) => ({
    accountId,
    categoryId,
    date: new Date("2026-02-01"),
    amount: -10,
    type: "CARD",
    labelEnc: label,
    labelHash: label,
    rawLabelEnc: label,
    rawLabelHash: label,
  });
  await db.transaction.createMany({
    data: [
      tx(shared.id, childId, "a"),
      tx(personal.id, hiddenId, "b"),
      tx(mine.id, memberCatId, "c"),
      tx(archived.id, archivedCatId, "d"),
    ],
  });
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { account: { ownerId: { in: [owner, member] } } } });
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.category.deleteMany({
    where: { userId: { in: [owner, member] }, parentId: { not: null } },
  });
  await db.category.deleteMany({ where: { userId: { in: [owner, member] } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, member] } } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  await db.$disconnect();
});

describe("listForeignCategories", () => {
  it("returns the owner's categories met on a shared account, with their ancestors", async () => {
    const tree = await listForeignCategories(member);
    const maison = tree.find((n) => n.id === parentId)!;
    expect(maison.children.map((n) => n.id)).toEqual([childId]);
    // A shared account archived since still shows in budgets.
    expect(tree.map((n) => n.id).sort()).toEqual([parentId, archivedCatId].sort());
  });

  it("leaves out categories of unshared accounts and the user's own", async () => {
    const ids = JSON.stringify(await listForeignCategories(member));
    expect(ids).not.toContain(hiddenId);
    expect(ids).not.toContain(memberCatId);
    expect(await listForeignCategories(owner)).toEqual([]);
  });

  it("returns a member's category met on the user's own shared account", async () => {
    const row = await db.transaction.create({
      data: {
        accountId: sharedId,
        categoryId: memberCatId,
        date: new Date("2026-02-02"),
        amount: -5,
        type: "CARD",
        labelEnc: "e",
        labelHash: "e",
        rawLabelEnc: "e",
        rawLabelHash: "e",
      },
    });
    try {
      expect((await listForeignCategories(owner)).map((n) => n.id)).toEqual([memberCatId]);
    } finally {
      await db.transaction.delete({ where: { id: row.id } });
    }
  });

  it("adds the requested extra categories, never the user's own", async () => {
    const tree = await listForeignCategories(member, { alsoIds: [hiddenId, memberCatId] });
    const ids = tree.map((n) => n.id);
    expect(ids).toContain(hiddenId);
    expect(ids).not.toContain(memberCatId);
  });
});

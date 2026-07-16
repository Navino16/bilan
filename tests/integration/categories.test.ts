import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  listForUser,
  CategoryAccessError,
} from "@/server/services/categories";

const userId = "cat_seed_user";

beforeAll(async () => {
  await db.category.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.create({ data: { id: userId, email: "cat-seed@bilan.local" } });
});

afterAll(async () => {
  await db.category.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("seedDefaultCategories", () => {
  it("seeds the French default set as a parent/child tree owned by the user", async () => {
    await seedDefaultCategories(userId, "fr");
    const all = await db.category.findMany({ where: { userId } });
    expect(all.length).toBeGreaterThan(10);
    expect(all.every((c) => c.isDefault && c.userId === userId && c.groupId === null)).toBe(true);
    const revenus = all.find((c) => c.name === "Revenus")!;
    expect(revenus.parentId).toBeNull();
    const salaire = all.find((c) => c.name === "Salaire")!;
    expect(salaire.parentId).toBe(revenus.id);
  });

  it("is idempotent-safe: a second seed does not duplicate when categories already exist", async () => {
    const before = await db.category.count({ where: { userId } });
    await seedDefaultCategories(userId, "fr");
    const after = await db.category.count({ where: { userId } });
    expect(after).toBe(before); // skips when the user already has categories
  });
});

describe("categories service", () => {
  const owner = "cat_owner";
  const stranger = "cat_stranger";
  let groupId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
    await db.user.create({ data: { id: owner, email: "cat-owner@bilan.local" } });
    await db.user.create({ data: { id: stranger, email: "cat-stranger@bilan.local" } });
    const group = await db.group.create({ data: { name: "Foyer Cat", createdById: owner } });
    groupId = group.id;
    await db.groupMember.create({ data: { groupId, userId: owner, role: "OWNER" } });
  });

  afterAll(async () => {
    await db.category.deleteMany({
      where: { OR: [{ userId: { in: [owner, stranger] } }, { groupId }] },
    });
    await db.groupMember.deleteMany({ where: { groupId } });
    await db.group.deleteMany({ where: { id: groupId } });
    await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  });

  it("creates a personal category (userId set, groupId null)", async () => {
    const { id } = await createCategory({ name: "Perso" }, { id: owner });
    const row = await db.category.findUniqueOrThrow({ where: { id } });
    expect(row.userId).toBe(owner);
    expect(row.groupId).toBeNull();
  });

  it("creates a group category when the actor is a group ADMIN/OWNER", async () => {
    const { id } = await createCategory({ name: "Foyer", groupId }, { id: owner });
    const row = await db.category.findUniqueOrThrow({ where: { id } });
    expect(row.groupId).toBe(groupId);
    expect(row.userId).toBeNull();
  });

  it("blocks creating a group category for a non-member", async () => {
    await expect(
      createCategory({ name: "Nope", groupId }, { id: stranger }),
    ).rejects.toBeInstanceOf(CategoryAccessError);
  });

  it("blocks updating/deleting a category the actor does not own", async () => {
    const { id } = await createCategory({ name: "Mine" }, { id: owner });
    await expect(updateCategory(id, { name: "Hacked" }, { id: stranger })).rejects.toBeInstanceOf(
      CategoryAccessError,
    );
    await expect(deleteCategory(id, { id: stranger })).rejects.toBeInstanceOf(CategoryAccessError);
  });

  it("lists personal + group categories as a tree for the user", async () => {
    const parent = await createCategory({ name: "Parent" }, { id: owner });
    await createCategory({ name: "Child", parentId: parent.id }, { id: owner });
    const tree = await listForUser(owner);
    const node = tree.find((c) => c.id === parent.id)!;
    expect(node.children.some((c) => c.name === "Child")).toBe(true);
    expect(tree.some((c) => c.scope === "GROUP")).toBe(true);
  });

  it("rejects reparenting onto a category from another scope", async () => {
    const mine = await createCategory({ name: "Reparent me" }, { id: owner });
    // stranger's personal category — a different owner scope.
    const foreign = await createCategory({ name: "Foreign" }, { id: stranger });
    await expect(
      updateCategory(mine.id, { name: "Reparent me", parentId: foreign.id }, { id: owner }),
    ).rejects.toBeInstanceOf(CategoryAccessError);
    await db.category.deleteMany({ where: { id: { in: [mine.id, foreign.id] } } });
  });

  it("rejects reparenting that would create a cycle", async () => {
    const a = await createCategory({ name: "A" }, { id: owner });
    const b = await createCategory({ name: "B", parentId: a.id }, { id: owner });
    // Making A a child of its own descendant B is a cycle.
    await expect(
      updateCategory(a.id, { name: "A", parentId: b.id }, { id: owner }),
    ).rejects.toBeInstanceOf(CategoryAccessError);
    await db.category.deleteMany({ where: { id: { in: [b.id, a.id] } } });
  });
});

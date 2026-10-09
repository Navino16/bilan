import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryDeletionImpact,
  listForUser,
  withDescendants,
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
    expect(revenus.color).toBe("var(--cat-income)");
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

  it("stores a palette pick as its theme variable and keeps a legacy hex", async () => {
    const { id } = await createCategory(
      { name: "Palette", color: "var(--cat-leisure)", icon: "🎁" },
      { id: owner },
    );
    expect(await db.category.findUniqueOrThrow({ where: { id } })).toMatchObject({
      color: "var(--cat-leisure)",
      icon: "🎁",
    });
    await updateCategory(id, { name: "Palette", color: "#2563eb" }, { id: owner });
    expect((await db.category.findUniqueOrThrow({ where: { id } })).color).toBe("#2563eb");
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

  describe("deletion", () => {
    let accountId: string;
    let budgetId: string;

    async function tree() {
      const root = await createCategory({ name: "Root" }, { id: owner });
      const child = await createCategory({ name: "Child", parentId: root.id }, { id: owner });
      const leaf = await createCategory({ name: "Leaf", parentId: child.id }, { id: owner });
      const other = await createCategory({ name: "Other" }, { id: owner });
      const s = buildSecureFields({ label: "T", rawLabel: "T" });
      const t = await db.transaction.create({
        data: {
          accountId,
          date: new Date("2026-03-01"),
          amount: -5,
          type: "OTHER",
          labelEnc: s.labelEnc,
          labelHash: s.labelHash,
          rawLabelEnc: s.rawLabelEnc,
          rawLabelHash: s.rawLabelHash,
          categoryId: leaf.id,
          createdById: owner,
        },
      });
      const rule = await db.categorizationRule.create({
        data: { pattern: "X", matchType: "CONTAINS", categoryId: child.id, userId: owner },
      });
      const line = await db.budgetLine.create({
        data: { budgetId, categoryId: root.id, plannedAmount: 10 },
      });
      return { root, child, leaf, other, t, rule, line };
    }

    beforeAll(async () => {
      accountId = (
        await db.bankAccount.create({ data: { ownerId: owner, name: "Del", type: "CHECKING" } })
      ).id;
      budgetId = (
        await db.budget.create({
          data: {
            name: "Del",
            userId: owner,
            periodType: "MONTH",
            periodStart: new Date("2026-03-01"),
            periodEnd: new Date("2026-03-31"),
            createdById: owner,
          },
        })
      ).id;
    });

    afterAll(async () => {
      await db.budget.deleteMany({ where: { id: budgetId } });
      await db.transaction.deleteMany({ where: { accountId } });
      await db.bankAccount.deleteMany({ where: { id: accountId } });
      await db.categorizationRule.deleteMany({ where: { userId: owner } });
    });

    it("maps a category to itself and all its descendants", async () => {
      const { root, child, leaf, other } = await tree();
      const map = await withDescendants([root.id, child.id, other.id]);
      expect(map.get(root.id)).toEqual(new Set([root.id, child.id, leaf.id]));
      expect(map.get(child.id)).toEqual(new Set([child.id, leaf.id]));
      expect(map.get(other.id)).toEqual(new Set([other.id]));
    });

    it("counts the impact over the whole subtree", async () => {
      const { root } = await tree();
      expect(await getCategoryDeletionImpact(root.id, { id: owner })).toEqual({
        subcategories: 2,
        transactions: 1,
        rules: 1,
        budgetLines: 1,
      });
      await expect(getCategoryDeletionImpact(root.id, { id: stranger })).rejects.toBeInstanceOf(
        CategoryAccessError,
      );
    });

    it("moves everything to the target and deletes the subtree", async () => {
      const { root, child, leaf, other, t, rule, line } = await tree();
      await deleteCategory(root.id, { id: owner }, { targetId: other.id });
      const gone = await db.category.count({ where: { id: { in: [root.id, child.id, leaf.id] } } });
      expect(gone).toBe(0);
      expect((await db.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBe(
        other.id,
      );
      expect(
        (await db.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).categoryId,
      ).toBe(other.id);
      expect((await db.budgetLine.findUniqueOrThrow({ where: { id: line.id } })).categoryId).toBe(
        other.id,
      );
    });

    it("without a target, uncategorizes transactions and deletes rules and budget lines", async () => {
      const { root, t, rule, line } = await tree();
      await deleteCategory(root.id, { id: owner });
      expect((await db.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBe(
        null,
      );
      expect(await db.categorizationRule.findUnique({ where: { id: rule.id } })).toBeNull();
      expect(await db.budgetLine.findUnique({ where: { id: line.id } })).toBeNull();
    });

    it("rejects a target inside the subtree or from another scope", async () => {
      const { root, leaf } = await tree();
      await expect(
        deleteCategory(root.id, { id: owner }, { targetId: leaf.id }),
      ).rejects.toBeInstanceOf(CategoryAccessError);
      const groupCat = await createCategory({ name: "G", groupId }, { id: owner });
      await expect(
        deleteCategory(root.id, { id: owner }, { targetId: groupCat.id }),
      ).rejects.toBeInstanceOf(CategoryAccessError);
      const foreign = await createCategory({ name: "Foreign target" }, { id: stranger });
      await expect(
        deleteCategory(root.id, { id: owner }, { targetId: foreign.id }),
      ).rejects.toBeInstanceOf(CategoryAccessError);
      await expect(
        deleteCategory(root.id, { id: owner }, { targetId: "missing" }),
      ).rejects.toBeInstanceOf(CategoryAccessError);
      expect(await db.category.count({ where: { id: root.id } })).toBe(1);
    });
  });
});

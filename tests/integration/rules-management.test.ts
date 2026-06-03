import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  createRule,
  listRulesForUser,
  updateRule,
  deleteRule,
  toggleRule,
  RuleAccessError,
} from "@/server/services/categorization";

const owner = "rmgmt_owner";
const stranger = "rmgmt_stranger";
let catA: string;
let catB: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "rmgmt-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "rmgmt-stranger@bilan.local" } });
  catA = (await db.category.create({ data: { name: "Groceries", userId: owner } })).id;
  catB = (await db.category.create({ data: { name: "Salary", userId: owner } })).id;
});

afterAll(async () => {
  await db.categorizationRule.deleteMany({ where: { userId: { in: [owner, stranger] } } });
  await db.category.deleteMany({ where: { userId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("rules management", () => {
  it("lists the user's rules with their category, highest priority first", async () => {
    await createRule(
      { pattern: "aaa", matchType: "CONTAINS", priority: 100, categoryId: catA },
      { id: owner },
    );
    await createRule(
      { pattern: "bbb", matchType: "CONTAINS", priority: 500, categoryId: catB },
      { id: owner },
    );
    const rules = await listRulesForUser(owner);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules[0].priority).toBeGreaterThanOrEqual(rules[1].priority);
    expect(rules[0].category?.name).toBeDefined();
  });

  it("updates a rule's pattern and category", async () => {
    const { id } = await createRule(
      { pattern: "old", matchType: "CONTAINS", categoryId: catA },
      { id: owner },
    );
    await updateRule(id, { pattern: "new", matchType: "EXACT", categoryId: catB }, { id: owner });
    const r = await db.categorizationRule.findUniqueOrThrow({ where: { id } });
    expect(r.pattern).toBe("new");
    expect(r.matchType).toBe("EXACT");
    expect(r.categoryId).toBe(catB);
  });

  it("toggles enabled and deletes", async () => {
    const { id } = await createRule(
      { pattern: "toggle", matchType: "CONTAINS", categoryId: catA },
      { id: owner },
    );
    await toggleRule(id, false, { id: owner });
    expect((await db.categorizationRule.findUniqueOrThrow({ where: { id } })).enabled).toBe(false);
    await deleteRule(id, { id: owner });
    expect(await db.categorizationRule.findUnique({ where: { id } })).toBeNull();
  });

  it("forbids managing another user's rule", async () => {
    const { id } = await createRule(
      { pattern: "mine", matchType: "CONTAINS", categoryId: catA },
      { id: owner },
    );
    await expect(
      updateRule(
        id,
        { pattern: "hacked", matchType: "CONTAINS", categoryId: catA },
        { id: stranger },
      ),
    ).rejects.toBeInstanceOf(RuleAccessError);
    await expect(deleteRule(id, { id: stranger })).rejects.toBeInstanceOf(RuleAccessError);
    await expect(toggleRule(id, false, { id: stranger })).rejects.toBeInstanceOf(RuleAccessError);
  });
});

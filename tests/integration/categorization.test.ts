import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { suggest, createRule, RuleAccessError } from "@/server/services/categorization";

const userId = "rule_user";
const stranger = "rule_stranger";
let catA: string;
let catB: string;
let groupId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userId, stranger] } } });
  await db.user.create({ data: { id: userId, email: "rule-user@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "rule-stranger@bilan.local" } });
  catA = (await db.category.create({ data: { name: "Groceries", userId } })).id;
  catB = (await db.category.create({ data: { name: "Salary", userId } })).id;
  const g = await db.group.create({ data: { name: "Foyer Rule", createdById: userId } });
  groupId = g.id;
  await db.groupMember.create({ data: { groupId, userId, role: "OWNER" } });
});

afterAll(async () => {
  await db.categorizationRule.deleteMany({
    where: { OR: [{ userId: { in: [userId, stranger] } }, { groupId }] },
  });
  await db.category.deleteMany({ where: { userId } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.user.deleteMany({ where: { id: { in: [userId, stranger] } } });
  await db.$disconnect();
});

describe("categorization suggest", () => {
  it("returns null when no rule matches", async () => {
    expect(await suggest("UNKNOWN MERCHANT", { userId })).toEqual({
      categoryId: null,
      ruleId: null,
    });
  });

  it("applies a user rule and prefers higher priority", async () => {
    await createRule(
      { pattern: "carrefour", matchType: "CONTAINS", priority: 100, categoryId: catA },
      { id: userId },
    );
    const win = await createRule(
      { pattern: "carrefour city", matchType: "CONTAINS", priority: 500, categoryId: catB },
      { id: userId },
    );
    const res = await suggest("CB CARREFOUR CITY PARIS", { userId });
    expect(res.categoryId).toBe(catB);
    expect(res.ruleId).toBe(win.id);
  });

  it("includes group rules for the user's groups", async () => {
    const r = await createRule(
      { pattern: "edf", matchType: "CONTAINS", priority: 100, categoryId: catA, groupId },
      { id: userId },
    );
    const res = await suggest("PRLV EDF ENERGIE", { userId });
    expect(res.ruleId).toBe(r.id);
  });

  it("ignores disabled rules", async () => {
    const r = await createRule(
      { pattern: "uber", matchType: "CONTAINS", categoryId: catA },
      { id: userId },
    );
    await db.categorizationRule.update({ where: { id: r.id }, data: { enabled: false } });
    expect((await suggest("UBER EATS", { userId })).ruleId).toBeNull();
  });
});

describe("createRule authorization", () => {
  it("blocks creating a group rule for a non-member", async () => {
    await expect(
      createRule(
        { pattern: "x", matchType: "CONTAINS", categoryId: catA, groupId },
        { id: stranger },
      ),
    ).rejects.toBeInstanceOf(RuleAccessError);
  });
});

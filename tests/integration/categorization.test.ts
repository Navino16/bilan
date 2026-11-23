import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  suggest,
  suggestMany,
  createRule,
  recordHits,
  RuleAccessError,
} from "@/server/services/categorization";

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

  it("suggestMany gives each label the same suggestion as suggest", async () => {
    await createRule(
      { pattern: "^cb .*city", matchType: "REGEX", priority: 500, categoryId: catA },
      { id: userId },
    );
    const labels = ["CB CARREFOUR CITY PARIS", "PRLV EDF ENERGIE", "UBER EATS", "cb city", "NONE"];
    const one = await Promise.all(labels.map((l) => suggest(l, { userId })));
    expect(await suggestMany(labels, { userId })).toEqual(one);
    expect(one.filter((s) => s.ruleId !== null)).toHaveLength(3);
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

describe("recordHits", () => {
  it("adds one hit per occurrence and ignores nulls and unknown ids", async () => {
    const a = await createRule(
      { pattern: "hits-a", matchType: "CONTAINS", categoryId: catA },
      { id: userId },
    );
    const b = await createRule(
      { pattern: "hits-b", matchType: "CONTAINS", categoryId: catA },
      { id: userId },
    );
    await recordHits([a.id, null, b.id, a.id, "missing_rule"]);
    await recordHits([a.id]);
    const rows = await db.categorizationRule.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.hits]))).toEqual({ [a.id]: 3, [b.id]: 1 });
  });
});

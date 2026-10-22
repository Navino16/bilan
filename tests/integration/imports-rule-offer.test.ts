import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildPreview } from "@/server/services/imports/preview";
import { retargetRule, RuleAccessError } from "@/server/services/categorization";
import type { NormalizedRow } from "@/server/services/imports/types";

const owner = "roffer_owner";

const row = (rawLabel: string): NormalizedRow => ({
  date: new Date("2026-06-02T00:00:00.000Z"),
  amount: -10,
  rawLabel,
});

let accountId: string;
let groceries: string;
let pharmacy: string;
let memberGroup: string;
let adminGroup: string;
const ruleIds: Record<string, string> = {};

async function cleanup() {
  const groups = await db.group.findMany({ where: { createdById: owner }, select: { id: true } });
  const groupIds = groups.map((g) => g.id);
  await db.categorizationRule.deleteMany({
    where: { OR: [{ userId: owner }, { groupId: { in: groupIds } }] },
  });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.groupMember.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.user.deleteMany({ where: { id: owner } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: owner, email: "roffer-owner@bilan.local" } });
  groceries = (await db.category.create({ data: { name: "Courses", userId: owner } })).id;
  pharmacy = (await db.category.create({ data: { name: "Santé", userId: owner } })).id;
  memberGroup = (await db.group.create({ data: { name: "Member", createdById: owner } })).id;
  adminGroup = (await db.group.create({ data: { name: "Admin", createdById: owner } })).id;
  await db.groupMember.create({ data: { groupId: memberGroup, userId: owner, role: "MEMBER" } });
  await db.groupMember.create({ data: { groupId: adminGroup, userId: owner, role: "ADMIN" } });
  const rule = (pattern: string, scope: { userId: string } | { groupId: string }) =>
    db.categorizationRule.create({
      data: { pattern, matchType: "CONTAINS", priority: 120, categoryId: groceries, ...scope },
    });
  ruleIds.own = (await rule("GROCER", { userId: owner })).id;
  ruleIds.member = (await rule("PHARMA", { groupId: memberGroup })).id;
  ruleIds.admin = (await rule("FUEL", { groupId: adminGroup })).id;
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("import preview rule offer", () => {
  it("tells each row which rule suggested its category and whether the user may edit it", async () => {
    const preview = await buildPreview(
      accountId,
      [row("CB GROCER 1"), row("CB PHARMA 2"), row("CB FUEL 3"), row("CB OTHER 4")],
      owner,
    );
    expect(preview.rows.map((r) => r.rule)).toEqual([
      { id: ruleIds.own, pattern: "GROCER", priority: 120, canManage: true },
      { id: ruleIds.member, pattern: "PHARMA", priority: 120, canManage: false },
      { id: ruleIds.admin, pattern: "FUEL", priority: 120, canManage: true },
      null,
    ]);
  });

  it("retargets a rule to another category, keeping its pattern and priority", async () => {
    await retargetRule(ruleIds.own, pharmacy, { id: owner });
    const rule = await db.categorizationRule.findUniqueOrThrow({ where: { id: ruleIds.own } });
    expect(rule).toMatchObject({ pattern: "GROCER", priority: 120, categoryId: pharmacy });
    const preview = await buildPreview(accountId, [row("CB GROCER 1")], owner);
    expect(preview.rows[0].suggestedCategoryId).toBe(pharmacy);
  });

  it("refuses to retarget a group rule the user is only a member of", async () => {
    await expect(retargetRule(ruleIds.member, pharmacy, { id: owner })).rejects.toThrow(
      RuleAccessError,
    );
    const rule = await db.categorizationRule.findUniqueOrThrow({ where: { id: ruleIds.member } });
    expect(rule.categoryId).toBe(groceries);
  });
});

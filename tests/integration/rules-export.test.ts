import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createGroup } from "@/server/services/groups";
import { RuleAccessError } from "@/server/services/categorization";
import { exportRules } from "@/server/services/categorization/rules-export";
import { parseRulesFile } from "@/server/services/categorization/rules-file";

const actor = "re_actor";
const member = "re_member";
const stranger = "re_stranger";
const ids = [actor, member, stranger];
let groupId: string;
let leaf: string;
let householdLeaf: string;
let strangerCat: string;

async function cleanup() {
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.categorizationRule.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { group: { name: "re_group" } }] },
  });
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.category.deleteMany({
    where: {
      OR: [{ userId: { in: ids } }, { group: { name: "re_group" } }],
      parentId: { not: null },
    },
  });
  await db.category.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { group: { name: "re_group" } }] },
  });
  await db.group.deleteMany({ where: { name: "re_group" } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

const addRule = (
  pattern: string,
  categoryId: string,
  scope: { userId: string } | { groupId: string },
  extra: { priority?: number; enabled?: boolean; hits?: number } = {},
) =>
  db.categorizationRule.create({
    data: { pattern, matchType: "CONTAINS", categoryId, ...scope, ...extra },
  });

beforeAll(async () => {
  await cleanup();
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  groupId = (await createGroup({ name: "re_group" }, actor)).id;
  await db.groupMember.create({ data: { groupId, userId: member, role: "MEMBER" } });

  const root = await db.category.create({
    data: { name: "Housing", color: "#ff0000", icon: "home", userId: actor },
  });
  leaf = (await db.category.create({ data: { name: "Rent", parentId: root.id, userId: actor } }))
    .id;
  const hRoot = await db.category.create({ data: { name: "Shared", groupId } });
  householdLeaf = (
    await db.category.create({
      data: { name: "Groceries", color: "#00ff00", parentId: hRoot.id, groupId },
    })
  ).id;
  strangerCat = (
    await db.category.create({
      data: { name: "Secret", color: "#0000ff", icon: "x", userId: stranger },
    })
  ).id;

  await addRule("rent", leaf, { userId: actor }, { priority: 50, hits: 7 });
  await addRule("landlord", leaf, { userId: actor }, { priority: 200, enabled: false });
  await addRule("market", householdLeaf, { groupId }, { priority: 100 });
  await addRule("secret", strangerCat, { groupId }, { priority: 50 });
  await addRule("shared", householdLeaf, { userId: actor });
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("exportRules", () => {
  it("exports personal rules with full category paths and no ids or hits", async () => {
    const file = await exportRules({ groupId: null }, { id: actor });
    expect(file.format).toBe("bilan-rules");
    expect(file.version).toBe(1);
    expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false);
    expect(file.rules.map((r) => r.pattern)).toEqual(["landlord", "shared", "rent"]);
    expect(file.rules[0]).toEqual({
      pattern: "landlord",
      matchType: "CONTAINS",
      caseSensitive: false,
      priority: 200,
      enabled: false,
      category: [{ name: "Housing", color: "#ff0000", icon: "home" }, { name: "Rent" }],
    });
    expect(JSON.stringify(file)).not.toMatch(/hits|"id"|userId|groupId|createdAt/);
  });

  it("exports a household's rules for a plain member", async () => {
    const file = await exportRules({ groupId }, { id: member });
    expect(file.rules.map((r) => r.pattern)).toEqual(["market", "secret"]);
  });

  it("refuses a household the actor is not in", async () => {
    await expect(exportRules({ groupId }, { id: stranger })).rejects.toThrow(RuleAccessError);
    await expect(exportRules({ groupId }, { id: stranger })).rejects.toThrow("FORBIDDEN");
  });

  it("a household rule on another user's personal category exports only its name and color", async () => {
    const file = await exportRules({ groupId }, { id: actor });
    expect(file.rules.find((r) => r.pattern === "secret")?.category).toEqual([
      { name: "Secret", color: "#0000ff" },
    ]);
  });

  it("a personal rule on a household category exports the full path", async () => {
    const file = await exportRules({ groupId: null }, { id: actor });
    expect(file.rules.find((r) => r.pattern === "shared")?.category).toEqual([
      { name: "Shared" },
      { name: "Groceries", color: "#00ff00" },
    ]);
  });

  it("logs rules.exported", async () => {
    await exportRules({ groupId }, { id: actor });
    const events = await db.auditLog.findMany({
      where: { userId: actor, action: "rules.exported" },
    });
    expect(events.at(-1)?.metadata).toEqual({ count: 2, groupId });
  });

  it("parseRulesFile(JSON.stringify(exportRules(...))) round-trips with no rejected rule", async () => {
    const file = await exportRules({ groupId: null }, { id: actor });
    const parsed = parseRulesFile(JSON.stringify(file));
    expect(parsed).toEqual({ ok: true, rules: file.rules, rejected: [] });
  });
});

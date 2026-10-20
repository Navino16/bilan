import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "ri_actor" } }));
vi.mock("@/server/auth/permissions", () => ({
  requireSession: async () => session.user,
}));
import { db } from "@/server/db";
import { createGroup } from "@/server/services/groups";
import { RuleAccessError, RuleValidationError } from "@/server/services/categorization";
import { exportRules } from "@/server/services/categorization/rules-export";
import {
  commitRulesImport,
  previewRulesImport,
} from "@/server/services/categorization/rules-import";
import { importRulesAction, previewRulesImportAction } from "@/server/transport/actions/rules";
import { RULES_FILE_MAX_BYTES, type FileRule } from "@/lib/validation/rules-file";
import type { ImportDecisions } from "@/lib/rules-import";

const actor = "ri_actor";
const member = "ri_member";
const fresh = "ri_fresh";
const stranger = "ri_stranger";
const ids = [actor, member, fresh, stranger];
const GROUP = "ri_group";
let groupId: string;

const ownedBy = { OR: [{ userId: { in: ids } }, { group: { name: GROUP } }] };

async function wipeData() {
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.categorizationRule.deleteMany({ where: ownedBy });
  await db.category.updateMany({ where: ownedBy, data: { parentId: null } });
  await db.category.deleteMany({ where: ownedBy });
}

async function cleanup() {
  await wipeData();
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.group.deleteMany({ where: { name: GROUP } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

type Level = { name: string; color?: string; icon?: string };
const fileRule = (pattern: string, category: Level[], extra: Partial<FileRule> = {}) => ({
  pattern,
  matchType: "CONTAINS",
  caseSensitive: false,
  priority: 100,
  enabled: true,
  category,
  ...extra,
});
const fileOf = (rules: unknown[]) =>
  JSON.stringify({ format: "bilan-rules", version: 1, exportedAt: "2026-10-20T00:00:00Z", rules });

const category = (
  name: string,
  owner: { userId: string } | { groupId: string },
  parentId?: string,
) => db.category.create({ data: { name, parentId, ...owner } });
const addRule = (
  pattern: string,
  categoryId: string,
  owner: { userId: string } | { groupId: string },
  extra: { priority?: number; enabled?: boolean; hits?: number } = {},
) =>
  db.categorizationRule.create({
    data: { pattern, matchType: "CONTAINS", categoryId, ...owner, ...extra },
  });

async function createAll(text: string, target: { groupId: string | null }, userId: string) {
  const preview = await previewRulesImport(text, target, { id: userId });
  const decisions: ImportDecisions = { categories: {}, moves: [] };
  for (const r of preview.resolutions) {
    if (r.categoryId === null) decisions.categories[r.key] = { action: "create" };
  }
  return { preview, decisions };
}

const counts = async () => ({
  categories: await db.category.count({ where: ownedBy }),
  rules: await db.categorizationRule.count({ where: ownedBy }),
});

beforeAll(async () => {
  await cleanup();
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  groupId = (await createGroup({ name: GROUP }, actor)).id;
  await db.groupMember.create({ data: { groupId, userId: member, role: "MEMBER" } });
});

beforeEach(wipeData);

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("rules import", () => {
  it("export then import into an empty account with Create reproduces rules and categories", async () => {
    const housing = await db.category.create({
      data: { name: "Housing", color: "#ff0000", icon: "home", userId: actor },
    });
    const rent = await category("Rent", { userId: actor }, housing.id);
    const utilities = await db.category.create({
      data: { name: "Utilities", icon: "plug", parentId: housing.id, userId: actor },
    });
    const power = await category("Power", { userId: actor }, utilities.id);
    await addRule("rent", rent.id, { userId: actor }, { priority: 50, hits: 4 });
    await addRule("landlord", rent.id, { userId: actor }, { priority: 200, enabled: false });
    await addRule("edf", power.id, { userId: actor });

    const text = JSON.stringify(await exportRules({ groupId: null }, { id: actor }));
    const { decisions } = await createAll(text, { groupId: null }, fresh);
    const result = await commitRulesImport(text, { groupId: null }, decisions, { id: fresh });

    expect(result.summary).toEqual({
      created: 3,
      moved: 0,
      identical: 0,
      duplicates: 0,
      ignored: 0,
      rejected: 0,
    });
    const cats = await db.category.findMany({ where: { userId: fresh } });
    expect(cats).toHaveLength(4);
    const byName = new Map(cats.map((c) => [c.name, c]));
    expect(byName.get("Housing")).toMatchObject({
      parentId: null,
      color: "#ff0000",
      icon: "home",
      groupId: null,
      isDefault: false,
    });
    expect(byName.get("Rent")?.parentId).toBe(byName.get("Housing")?.id);
    expect(byName.get("Utilities")).toMatchObject({
      parentId: byName.get("Housing")?.id,
      icon: "plug",
      color: null,
    });
    expect(byName.get("Power")?.parentId).toBe(byName.get("Utilities")?.id);

    const rules = await db.categorizationRule.findMany({
      where: { userId: fresh },
      include: { category: true },
    });
    expect(rules.map((r) => r.id).sort()).toEqual([...result.createdRuleIds].sort());
    const ruleOf = (p: string) => rules.find((r) => r.pattern === p);
    expect(ruleOf("rent")).toMatchObject({ priority: 50, enabled: true, hits: 0, groupId: null });
    expect(ruleOf("rent")?.category.name).toBe("Rent");
    expect(ruleOf("landlord")).toMatchObject({ priority: 200, enabled: false });
    expect(ruleOf("edf")?.category.name).toBe("Power");
  });

  it("re-importing one's own export creates nothing", async () => {
    const food = await category("Food", { userId: actor });
    const shared = await category("Shared", { groupId });
    const groceries = await category("Groceries", { groupId }, shared.id);
    await addRule("bakery", food.id, { userId: actor });
    await addRule("market", groceries.id, { userId: actor });

    const text = JSON.stringify(await exportRules({ groupId: null }, { id: actor }));
    const before = await counts();
    const preview = await previewRulesImport(text, { groupId: null }, { id: actor });
    expect(preview.resolutions.every((r) => r.categoryId !== null)).toBe(true);

    const result = await commitRulesImport(
      text,
      { groupId: null },
      { categories: {}, moves: [] },
      { id: actor },
    );
    expect(result).toMatchObject({ createdRuleIds: [], movedRuleIds: [] });
    expect(result.summary).toMatchObject({ created: 0, moved: 0, identical: 2 });
    expect(await counts()).toEqual(before);
  });

  it("Create builds a shared missing parent once", async () => {
    const text = fileOf([
      fileRule("creche", [{ name: "Enfants", color: "#00ff00" }, { name: "Crèche" }]),
      fileRule("cantine", [{ name: "enfants" }, { name: "Cantine" }]),
    ]);
    const { decisions } = await createAll(text, { groupId: null }, fresh);
    await commitRulesImport(text, { groupId: null }, decisions, { id: fresh });

    const roots = await db.category.findMany({ where: { userId: fresh, parentId: null } });
    expect(roots.map((c) => c.name)).toEqual(["Enfants"]);
    const children = await db.category.findMany({ where: { parentId: roots[0].id } });
    expect(children.map((c) => c.name).sort()).toEqual(["Cantine", "Crèche"]);

    const next = fileOf([fileRule("judo", [{ name: "Enfants" }, { name: "Sport" }])]);
    const again = await createAll(next, { groupId: null }, fresh);
    expect(again.preview.resolutions[0]).toMatchObject({ anchorId: roots[0].id });
    await commitRulesImport(next, { groupId: null }, again.decisions, { id: fresh });
    expect(await db.category.count({ where: { userId: fresh, parentId: null } })).toBe(1);
    expect(await db.category.count({ where: { parentId: roots[0].id } })).toBe(3);
  });

  it("Map attaches the rules to the chosen category", async () => {
    const food = await category("Food", { userId: actor });
    const text = fileOf([
      fileRule("bakery", [{ name: "Unknown" }]),
      fileRule("butcher", [{ name: "Unknown" }]),
    ]);
    const { preview } = await createAll(text, { groupId: null }, actor);
    const key = preview.resolutions[0].key;
    const result = await commitRulesImport(
      text,
      { groupId: null },
      { categories: { [key]: { action: "map", categoryId: food.id } }, moves: [] },
      { id: actor },
    );
    expect(result.summary.created).toBe(2);
    const rules = await db.categorizationRule.findMany({ where: { userId: actor } });
    expect(rules.every((r) => r.categoryId === food.id)).toBe(true);
    expect(await db.category.count({ where: { userId: actor } })).toBe(1);
  });

  it("Ignore imports nothing for that path", async () => {
    const text = fileOf([
      fileRule("bakery", [{ name: "Unknown" }]),
      fileRule("butcher", [{ name: "Unknown" }]),
    ]);
    const { preview } = await createAll(text, { groupId: null }, actor);
    const result = await commitRulesImport(
      text,
      { groupId: null },
      { categories: { [preview.resolutions[0].key]: { action: "ignore" } }, moves: [] },
      { id: actor },
    );
    expect(result.summary).toMatchObject({ created: 0, ignored: 2 });
    expect(await counts()).toEqual({ categories: 0, rules: 0 });
  });

  it("a conflict is kept by default and moved on request, keeping priority/enabled/hits", async () => {
    const leisure = await category("Leisure", { userId: actor });
    const subscriptions = await category("Subscriptions", { userId: actor });
    const netflix = await addRule(
      "netflix",
      leisure.id,
      { userId: actor },
      {
        priority: 150,
        enabled: false,
        hits: 9,
      },
    );
    const spotify = await addRule("spotify", leisure.id, { userId: actor });
    const text = fileOf([
      fileRule("netflix", [{ name: "Subscriptions" }], { priority: 10 }),
      fileRule("spotify", [{ name: "Streaming" }]),
    ]);
    const { preview, decisions } = await createAll(text, { groupId: null }, actor);
    expect(preview.existing.map((r) => r.id).sort()).toEqual([netflix.id, spotify.id].sort());

    const kept = await commitRulesImport(text, { groupId: null }, decisions, { id: actor });
    expect(kept.summary).toMatchObject({ created: 0, moved: 0 });
    expect(
      await db.categorizationRule.findUniqueOrThrow({ where: { id: netflix.id } }),
    ).toMatchObject({ categoryId: leisure.id });
    expect(await db.category.count({ where: { name: "Streaming", userId: actor } })).toBe(0);

    const moved = await commitRulesImport(
      text,
      { groupId: null },
      { ...decisions, moves: [netflix.id, spotify.id] },
      { id: actor },
    );
    expect(moved.movedRuleIds.sort()).toEqual([netflix.id, spotify.id].sort());
    expect(moved.summary).toMatchObject({ created: 0, moved: 2 });
    expect(
      await db.categorizationRule.findUniqueOrThrow({ where: { id: netflix.id } }),
    ).toMatchObject({ categoryId: subscriptions.id, priority: 150, enabled: false, hits: 9 });
    const streaming = await db.category.findFirstOrThrow({
      where: { name: "Streaming", userId: actor },
    });
    expect(
      (await db.categorizationRule.findUniqueOrThrow({ where: { id: spotify.id } })).categoryId,
    ).toBe(streaming.id);
  });

  it("rejected rules are reported and never stored", async () => {
    const food = await category("Food", { userId: actor });
    const text = fileOf([
      fileRule("bakery", [{ name: "Food" }]),
      fileRule("(", [{ name: "Food" }], { matchType: "REGEX" }),
      { matchType: "CONTAINS", category: [{ name: "Food" }] },
    ]);
    const preview = await previewRulesImport(text, { groupId: null }, { id: actor });
    expect(preview.rejected).toEqual([
      { index: 1, pattern: "(", reason: "INVALID_REGEX" },
      { index: 2, pattern: null, reason: "INVALID" },
    ]);
    const result = await commitRulesImport(
      text,
      { groupId: null },
      { categories: {}, moves: [] },
      { id: actor },
    );
    expect(result.summary).toMatchObject({ created: 1, rejected: 2 });
    const rules = await db.categorizationRule.findMany({ where: { userId: actor } });
    expect(rules.map((r) => [r.pattern, r.categoryId])).toEqual([["bakery", food.id]]);
  });

  it("a plain household member cannot import into the household", async () => {
    const text = fileOf([fileRule("bakery", [{ name: "Food" }])]);
    const target = { groupId };
    for (const userId of [member, stranger]) {
      await expect(previewRulesImport(text, target, { id: userId })).rejects.toThrow(
        RuleAccessError,
      );
      await expect(
        commitRulesImport(text, target, { categories: {}, moves: [] }, { id: userId }),
      ).rejects.toThrow("FORBIDDEN");
    }
    await expect(previewRulesImport("not json", target, { id: member })).rejects.toThrow(
      "FORBIDDEN",
    );
    session.user = { id: member };
    try {
      expect(await previewRulesImportAction(text, groupId)).toEqual({
        ok: false,
        error: "FORBIDDEN",
      });
    } finally {
      session.user = { id: actor };
    }
    expect(await counts()).toEqual({ categories: 0, rules: 0 });
  });

  it("categories and rules land in the target household", async () => {
    await category("Food", { userId: actor });
    const text = fileOf([fileRule("bakery", [{ name: "Food" }, { name: "Bread" }])]);
    const { preview, decisions } = await createAll(text, { groupId }, actor);
    expect(preview.resolutions[0]).toMatchObject({ categoryId: null, anchorId: null });

    const result = await commitRulesImport(text, { groupId }, decisions, { id: actor });
    const created = await db.category.findMany({ where: { groupId } });
    expect(created.map((c) => [c.name, c.userId])).toEqual(
      expect.arrayContaining([
        ["Food", null],
        ["Bread", null],
      ]),
    );
    expect(created).toHaveLength(2);
    const rule = await db.categorizationRule.findUniqueOrThrow({
      where: { id: result.createdRuleIds[0] },
      include: { category: true },
    });
    expect(rule).toMatchObject({ groupId, userId: null });
    expect(rule.category).toMatchObject({ name: "Bread", groupId });
  });

  it("commit refuses undecided paths, a non-assignable map target and a stale move id, writing nothing", async () => {
    const leisure = await category("Leisure", { userId: actor });
    const secret = await category("Secret", { userId: stranger });
    const netflix = await addRule("netflix", leisure.id, { userId: actor });
    const elsewhere = await addRule("other", secret.id, { userId: stranger });
    const text = fileOf([
      fileRule("netflix", [{ name: "Streaming" }]),
      fileRule("bakery", [{ name: "Bread" }]),
    ]);
    const { decisions } = await createAll(text, { groupId: null }, actor);
    const [streamingKey, breadKey] = Object.keys(decisions.categories);
    const before = await counts();

    const attempts: ImportDecisions[] = [
      { categories: { [streamingKey]: { action: "create" } }, moves: [] },
      {
        categories: {
          ...decisions.categories,
          [breadKey]: { action: "map", categoryId: secret.id },
        },
        moves: [],
      },
      { ...decisions, moves: [elsewhere.id] },
      { ...decisions, moves: [netflix.id, "missing-rule-id"] },
    ];
    for (const attempt of attempts) {
      const error = await commitRulesImport(text, { groupId: null }, attempt, { id: actor }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(RuleValidationError);
      expect((error as Error).message).toBe("INVALID_DECISION");
    }
    expect(await counts()).toEqual(before);
  });

  it("refuses a malformed file or one with too many rules", async () => {
    await expect(previewRulesImport("{", { groupId: null }, { id: actor })).rejects.toThrow(
      "BAD_FILE",
    );
    const many = fileOf(Array.from({ length: 2001 }, (_, i) => fileRule(`p${i}`, [{ name: "X" }])));
    await expect(
      commitRulesImport(many, { groupId: null }, { categories: {}, moves: [] }, { id: actor }),
    ).rejects.toThrow("TOO_MANY");
    expect(await previewRulesImportAction("{", null)).toEqual({ ok: false, error: "BAD_FILE" });
  });

  it("importRulesAction refuses text over 512 KiB", async () => {
    const big = fileOf([fileRule("x".repeat(10), [{ name: "Food" }])]).padEnd(
      RULES_FILE_MAX_BYTES + 1,
      " ",
    );
    const decisions = { categories: {}, moves: [] };
    expect(await importRulesAction(big, null, decisions)).toEqual({
      ok: false,
      error: "TOO_LARGE",
    });
    expect(await previewRulesImportAction(big, null)).toEqual({ ok: false, error: "TOO_LARGE" });
    const multiByte = "é".repeat(RULES_FILE_MAX_BYTES / 2 + 1);
    expect(await previewRulesImportAction(multiByte, null)).toEqual({
      ok: false,
      error: "TOO_LARGE",
    });
  });

  it("the actions validate decisions and return the import result", async () => {
    const text = fileOf([fileRule("bakery", [{ name: "Bread" }])]);
    const preview = await previewRulesImportAction(text, null);
    if (!preview.ok) throw new Error(preview.error);
    const key = preview.preview.resolutions[0].key;

    for (const bad of [
      { categories: { [key]: { action: "map" } }, moves: [] },
      { categories: { [key]: { action: "delete" } }, moves: [] },
      { categories: {}, moves: Array.from({ length: 2001 }, (_, i) => `r${i}`) },
      { categories: {} },
    ]) {
      expect(await importRulesAction(text, null, bad as unknown as ImportDecisions)).toEqual({
        ok: false,
        error: "INVALID",
      });
    }
    expect(await importRulesAction(text, null, { categories: {}, moves: [] })).toEqual({
      ok: false,
      error: "INVALID_DECISION",
    });
    const done = await importRulesAction(text, null, {
      categories: { [key]: { action: "create" } },
      moves: [],
    });
    expect(done).toMatchObject({ ok: true, movedRuleIds: [], summary: { created: 1 } });
  });

  it("logs rules.imported", async () => {
    const text = fileOf([fileRule("bakery", [{ name: "Bread" }])]);
    const { decisions } = await createAll(text, { groupId }, actor);
    const { summary } = await commitRulesImport(text, { groupId }, decisions, { id: actor });
    const events = await db.auditLog.findMany({
      where: { userId: actor, action: "rules.imported" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      entity: "CategorizationRule",
      metadata: { ...summary, groupId },
    });
  });
});

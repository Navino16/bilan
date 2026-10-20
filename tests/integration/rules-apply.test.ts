import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "ra_actor" } }));
vi.mock("@/server/auth/permissions", () => ({
  requireSession: async () => session.user,
}));
import { db } from "@/server/db";
import { LONG_TX_TIMEOUT } from "@/server/db/timeouts";
import { createAccount } from "@/server/services/accounts";
import { shareAccountWithGroup } from "@/server/services/accounts/sharing";
import { createGroup } from "@/server/services/groups";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createRule, RuleAccessError, RuleValidationError } from "@/server/services/categorization";
import {
  applyRule,
  applyRules,
  previewRuleApplication,
  previewRulesApplication,
} from "@/server/services/categorization/apply";
import {
  applyRuleAction,
  applyRulesAction,
  createRuleAction,
  previewRuleApplicationAction,
  previewRulesApplicationAction,
} from "@/server/transport/actions/rules";

const actor = "ra_actor";
const other = "ra_other";
const ids = [actor, other];
let groupId: string;
let food: string;
let shops: string;
const acc = { own: "", write: "", read: "", archived: "" };
let seq = 0;

async function tx(
  accountId: string,
  rawLabel: string,
  categoryId: string | null = null,
  manual = false,
) {
  const { labelEnc, labelHash, rawLabelEnc, rawLabelHash } = buildSecureFields({
    label: rawLabel,
    rawLabel,
  });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(Date.UTC(2026, 0, 1)),
      amount: -10,
      type: "CARD",
      labelEnc,
      labelHash,
      rawLabelEnc,
      rawLabelHash,
      categoryId,
      manuallyCategorized: manual,
    },
  });
  return row.id;
}

const categoryOf = async (id: string) =>
  (await db.transaction.findUniqueOrThrow({ where: { id } })).categoryId;
const rule = (
  pattern: string,
  categoryId: string,
  priority = 100,
  scope: { groupId?: string } = {},
) => createRule({ pattern, matchType: "CONTAINS", priority, categoryId, ...scope }, { id: actor });
const label = (name: string) => `RA${seq++}${name}`;

async function cleanup() {
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.categorizationRule.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { group: { name: "ra_group" } }] },
  });
  await db.accountShare.deleteMany({ where: { account: { ownerId: { in: ids } } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.group.deleteMany({ where: { name: "ra_group" } });
  await db.category.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanup();
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  groupId = (await createGroup({ name: "ra_group" }, actor)).id;
  await db.groupMember.create({ data: { groupId, userId: other, role: "MEMBER" } });
  food = (await db.category.create({ data: { name: "Food", userId: actor } })).id;
  shops = (await db.category.create({ data: { name: "Shops", userId: actor } })).id;
  acc.own = (await createAccount({ name: "own", type: "CHECKING" }, actor)).id;
  acc.archived = (await createAccount({ name: "archived", type: "CHECKING" }, actor)).id;
  await db.bankAccount.update({ where: { id: acc.archived }, data: { archived: true } });
  acc.write = (await createAccount({ name: "write", type: "CHECKING" }, other)).id;
  acc.read = (await createAccount({ name: "read", type: "CHECKING" }, other)).id;
  for (const [accountId, permission] of [
    [acc.write, "WRITE"],
    [acc.read, "READ"],
  ] as const) {
    await shareAccountWithGroup({ accountId, groupId, permission }, { id: other });
  }
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("previewRuleApplication / applyRule", () => {
  it("previews and applies a personal rule on owned, WRITE-shared and archived accounts", async () => {
    const l = label("ALL");
    const rows = await Promise.all(
      [acc.own, acc.write, acc.archived, acc.read].map((a) => tx(a, `CB ${l}`)),
    );
    const { id } = await rule(l, food);

    const preview = await previewRuleApplication(id, { id: actor });
    expect(preview.moving).toBe(3);
    expect(await applyRule(id, { id: actor })).toEqual({ reclassified: 3 });

    for (const row of rows.slice(0, 3)) expect(await categoryOf(row)).toBe(food);
    expect(await categoryOf(rows[3])).toBeNull();
    const moved = await db.transaction.findMany({ where: { id: { in: rows.slice(0, 3) } } });
    expect(moved.every((t) => !t.manuallyCategorized)).toBe(true);
  });

  it("never touches a manual row, even one made manual after the preview", async () => {
    const l = label("MANUAL");
    const already = await tx(acc.own, l, shops, true);
    const later = await tx(acc.own, l);
    const free = await tx(acc.own, l);
    const { id } = await rule(l, food);

    const preview = await previewRuleApplication(id, { id: actor });
    expect(preview).toMatchObject({ matched: 3, moving: 2, manual: 1 });
    await db.transaction.update({ where: { id: later }, data: { manuallyCategorized: true } });

    expect(await applyRule(id, { id: actor })).toEqual({ reclassified: 1 });
    expect(await categoryOf(already)).toBe(shops);
    expect(await categoryOf(later)).toBeNull();
    expect(await categoryOf(free)).toBe(food);
  });

  it("respects a higher-priority rule", async () => {
    const l = label("PRIO");
    const row = await tx(acc.own, `${l} PRIME`);
    const strong = await rule(l, shops, 200);
    const { id } = await rule(`${l} PRIME`, food);

    const preview = await previewRuleApplication(id, { id: actor });
    expect(preview.moving).toBe(0);
    expect(preview.keptBy).toEqual([{ ruleId: strong.id, pattern: l, count: 1 }]);
    expect(await applyRule(id, { id: actor })).toEqual({ reclassified: 0 });
    expect(await categoryOf(row)).toBeNull();
  });

  it("credits hits and logs one rule.applied event", async () => {
    const l = label("AUDIT");
    await tx(acc.own, l);
    await tx(acc.own, l);
    const { id } = await rule(l, food);

    const { reclassified } = await applyRule(id, { id: actor });
    expect(reclassified).toBe(2);
    expect((await db.categorizationRule.findUniqueOrThrow({ where: { id } })).hits).toBe(2);
    const events = await db.auditLog.findMany({ where: { action: "rule.applied", entityId: id } });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({ reclassified: 2 });
  });

  it("writes nothing and logs nothing when nothing moves", async () => {
    const { id } = await rule(label("NONE"), food);
    expect((await previewRuleApplication(id, { id: actor })).matched).toBe(0);
    expect(await applyRule(id, { id: actor })).toEqual({ reclassified: 0 });
    expect(await db.auditLog.count({ where: { action: "rule.applied", entityId: id } })).toBe(0);
  });

  it("refuses a disabled rule", async () => {
    const { id } = await rule(label("OFF"), food);
    await db.categorizationRule.update({ where: { id }, data: { enabled: false } });
    await expect(applyRule(id, { id: actor })).rejects.toEqual(new RuleValidationError("DISABLED"));
    await expect(previewRuleApplication(id, { id: actor })).rejects.toBeInstanceOf(
      RuleValidationError,
    );
  });

  it("refuses another user's rule", async () => {
    const { id } = await rule(label("MINE"), food);
    await expect(applyRule(id, { id: other })).rejects.toEqual(new RuleAccessError("FORBIDDEN"));
  });

  it("refuses a group rule to a group MEMBER", async () => {
    const groupFood = (await db.category.create({ data: { name: "Group food", groupId } })).id;
    const { id } = await rule(label("GROUP"), groupFood, 100, { groupId });
    await expect(applyRule(id, { id: other })).rejects.toEqual(new RuleAccessError("FORBIDDEN"));
    await db.category.delete({ where: { id: groupFood } });
  });

  it("lets a household ADMIN apply a household rule on the accounts they can write", async () => {
    const groupFood = (await db.category.create({ data: { name: "Group food", groupId } })).id;
    const l = label("GROUPADMIN");
    const [mine, theirWrite, theirRead] = await Promise.all(
      [acc.own, acc.write, acc.read].map((a) => tx(a, l)),
    );
    const { id } = await rule(l, groupFood, 100, { groupId });
    const where = { groupId_userId: { groupId, userId: other } };
    await db.groupMember.update({ where, data: { role: "ADMIN" } });
    try {
      expect(await applyRule(id, { id: other })).toEqual({ reclassified: 2 });
      expect(await categoryOf(theirWrite)).toBe(groupFood);
      expect(await categoryOf(theirRead)).toBe(groupFood);
      expect(await categoryOf(mine)).toBeNull();
    } finally {
      await db.groupMember.update({ where, data: { role: "MEMBER" } });
      await db.transaction.deleteMany({ where: { id: { in: [mine, theirWrite, theirRead] } } });
      await db.categorizationRule.delete({ where: { id } });
      await db.category.delete({ where: { id: groupFood } });
    }
  });
});

describe("previewRulesApplication / applyRules", () => {
  it("applyRules reclassifies with each rule's category and skips manual rows", async () => {
    const l = label("BATCH");
    const [a, b, manual] = await Promise.all([
      tx(acc.own, `${l}A`),
      tx(acc.write, `${l}B`),
      tx(acc.own, `${l}A`, shops, true),
    ]);
    const ra = await rule(`${l}A`, food);
    const rb = await rule(`${l}B`, shops);

    const preview = await previewRulesApplication([ra.id, rb.id], { id: actor });
    expect(preview).toMatchObject({ matched: 3, moving: 2, manual: 1 });
    expect(await applyRules([ra.id, rb.id], { id: actor })).toEqual({ reclassified: 2 });

    expect(await categoryOf(a)).toBe(food);
    expect(await categoryOf(b)).toBe(shops);
    expect(await categoryOf(manual)).toBe(shops);
    for (const id of [ra.id, rb.id]) {
      expect((await db.categorizationRule.findUniqueOrThrow({ where: { id } })).hits).toBe(1);
      const events = await db.auditLog.findMany({
        where: { action: "rule.applied", entityId: id },
      });
      expect(events.map((e) => e.metadata)).toEqual([{ reclassified: 1 }]);
    }
  });

  it("applyRules attributes each moved row to its rule when rules share a category", async () => {
    const l = label("SHARED");
    const [a1, a2, b1, b2] = await Promise.all([
      tx(acc.own, `${l}A1`),
      tx(acc.own, `${l}A2`),
      tx(acc.own, `${l}B1`),
      tx(acc.write, `${l}B2`),
    ]);
    const ra = await rule(`${l}A`, food);
    const rb = await rule(`${l}B`, food);
    // A row made manual between the plan and the write must stay, and not count for its rule.
    const original = db.$transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(db, "$transaction").mockImplementationOnce(async (...args: unknown[]) => {
      await db.transaction.update({ where: { id: b2 }, data: { manuallyCategorized: true } });
      return original(...args);
    });
    try {
      expect(await applyRules([ra.id, rb.id], { id: actor })).toEqual({ reclassified: 3 });
      expect(spy).toHaveBeenCalledWith(expect.any(Function), LONG_TX_TIMEOUT);
    } finally {
      spy.mockRestore();
    }

    for (const row of [a1, a2, b1]) expect(await categoryOf(row)).toBe(food);
    expect(await categoryOf(b2)).toBeNull();
    for (const [id, count] of [
      [ra.id, 2],
      [rb.id, 1],
    ] as const) {
      expect((await db.categorizationRule.findUniqueOrThrow({ where: { id } })).hits).toBe(count);
      const events = await db.auditLog.findMany({
        where: { action: "rule.applied", entityId: id },
      });
      expect(events.map((e) => e.metadata)).toEqual([{ reclassified: count }]);
    }
  });

  it("applyRules drops disabled rules", async () => {
    const l = label("BATCHOFF");
    const on = await tx(acc.own, `${l}ON`);
    const off = await tx(acc.own, `${l}OFF`);
    const ron = await rule(`${l}ON`, food);
    const roff = await rule(`${l}OFF`, shops);
    await db.categorizationRule.update({ where: { id: roff.id }, data: { enabled: false } });

    expect(await applyRules([ron.id, roff.id], { id: actor })).toEqual({ reclassified: 1 });
    expect(await categoryOf(on)).toBe(food);
    expect(await categoryOf(off)).toBeNull();
    expect(await applyRules([roff.id], { id: actor })).toEqual({ reclassified: 0 });
  });

  it("applyRules refuses a household rule for a plain member", async () => {
    const groupFood = (await db.category.create({ data: { name: "Group food", groupId } })).id;
    const { id } = await rule(label("BGROUP"), groupFood, 100, { groupId });
    await expect(applyRules([id], { id: other })).rejects.toEqual(new RuleAccessError("FORBIDDEN"));
    await expect(applyRules([id, "missing-rule"], { id: actor })).rejects.toEqual(
      new RuleAccessError("NOT_FOUND"),
    );
    await db.categorizationRule.delete({ where: { id } });
    await db.category.delete({ where: { id: groupFood } });
  });

  it("previewRulesApplication counts equal the sum of applying the rules one by one in priority order", async () => {
    const l = label("EQ");
    const makeRows = () =>
      Promise.all([
        tx(acc.own, `${l}A1`),
        tx(acc.own, `${l}AB1`, food),
        tx(acc.write, `${l}Z`),
        tx(acc.own, `${l}Z`, food),
        tx(acc.own, `${l}A2`, shops, true),
      ]);
    const r1 = await rule(`${l}A`, food);
    const r2 = await rule(l, shops, 50);
    const r3 = await rule(`${l}AB`, shops);
    const ordered = [r3, r1, r2].map((r) => r.id);

    const batchRows = await makeRows();
    const preview = await previewRulesApplication(ordered, { id: actor });
    const batch = await applyRules(ordered, { id: actor });
    expect(preview.moving).toBe(batch.reclassified);
    const batchState = await Promise.all(batchRows.map(categoryOf));

    const seqRows = await makeRows();
    let sequential = 0;
    for (const id of ordered) sequential += (await applyRule(id, { id: actor })).reclassified;

    expect(sequential).toBe(batch.reclassified);
    expect(await Promise.all(seqRows.map(categoryOf))).toEqual(batchState);
  });
});

describe("applyRule category check", () => {
  it("refuses a rule whose category the actor can no longer use", async () => {
    const otherGroup = (await createGroup({ name: "ra_group" }, other)).id;
    await db.groupMember.create({ data: { groupId: otherGroup, userId: actor, role: "MEMBER" } });
    const foreign = (await db.category.create({ data: { name: "Household", groupId: otherGroup } }))
      .id;
    const l = label("LEFT");
    const row = await tx(acc.own, l);
    const { id } = await rule(l, foreign);
    await db.groupMember.deleteMany({ where: { groupId: otherGroup, userId: actor } });

    await expect(applyRule(id, { id: actor })).rejects.toBeInstanceOf(RuleAccessError);
    expect(await categoryOf(row)).toBeNull();
    await db.categorizationRule.delete({ where: { id } });
    await db.category.delete({ where: { id: foreign } });
  });
});

describe("rule application actions", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("createRuleAction returns the new rule's id, which the preview action accepts", async () => {
    session.user = { id: actor };
    const l = label("ACTION");
    await tx(acc.own, l);
    const res = await createRuleAction(null, form({ pattern: l, categoryId: food }));
    if (!res?.ok) throw new Error(`create failed: ${res?.error}`);
    const preview = await previewRuleApplicationAction(res.id);
    expect(preview).toMatchObject({ ok: true, preview: { matched: 1, moving: 1 } });
    expect(await applyRuleAction(res.id)).toEqual({ ok: true, reclassified: 1 });
  });

  it("applyRuleAction reports FORBIDDEN for a rule the session user can't manage", async () => {
    const { id } = await rule(label("NOTYOURS"), food);
    session.user = { id: other };
    expect(await applyRuleAction(id)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await previewRuleApplicationAction(id)).toEqual({ ok: false, error: "FORBIDDEN" });
    session.user = { id: actor };
  });

  it("applyRulesAction and previewRulesApplicationAction reject an empty list", async () => {
    session.user = { id: actor };
    expect(await applyRulesAction([])).toEqual({ ok: false, error: "INVALID" });
    expect(await previewRulesApplicationAction([])).toEqual({ ok: false, error: "INVALID" });
  });

  it("applyRulesAction applies a set of rules", async () => {
    session.user = { id: actor };
    const l = label("BACTION");
    await tx(acc.own, l);
    const { id } = await rule(l, food);
    expect(await previewRulesApplicationAction([id])).toMatchObject({
      ok: true,
      preview: { matched: 1, moving: 1 },
    });
    expect(await applyRulesAction([id])).toEqual({ ok: true, reclassified: 1 });
  });

  it("reports NOT_FOUND for an unknown rule", async () => {
    session.user = { id: actor };
    expect(await applyRuleAction("missing-rule")).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

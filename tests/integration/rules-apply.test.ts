import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "ra_actor" } }));
vi.mock("@/server/auth/permissions", () => ({
  requireSession: async () => session.user,
}));
import { db } from "@/server/db";
import { createAccount } from "@/server/services/accounts";
import { shareAccountWithGroup } from "@/server/services/accounts/sharing";
import { createGroup } from "@/server/services/groups";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import {
  applyRule,
  createRule,
  previewRuleApplication,
  RuleAccessError,
  RuleValidationError,
} from "@/server/services/categorization";
import {
  applyRuleAction,
  createRuleAction,
  previewRuleApplicationAction,
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

  it("reports NOT_FOUND for an unknown rule", async () => {
    session.user = { id: actor };
    expect(await applyRuleAction("missing-rule")).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

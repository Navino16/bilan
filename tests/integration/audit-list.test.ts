import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listAuditLog } from "@/server/services/audit";

const userId = "auditlist_user";
const otherId = "auditlist_other";
const prefix = "test_auditlist";
const action = `${prefix}.list`;

beforeAll(async () => {
  await db.auditLog.deleteMany({ where: { action: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.user.createMany({
    data: [
      { id: userId, email: "auditlist@bilan.local", name: "Audit User" },
      { id: otherId, email: "someone-else@bilan.local", name: "Other" },
    ],
  });
  await db.auditLog.createMany({
    data: [
      { action, userId, createdAt: new Date("2026-03-01T10:00:00Z") },
      { action, userId: "auditlist_gone", createdAt: new Date("2026-03-02T10:00:00Z") },
      { action, userId: null, createdAt: new Date("2026-03-03T10:00:00Z") },
      {
        action: `${prefix}.role`,
        userId: otherId,
        entity: "User",
        entityId: userId,
        createdAt: new Date("2026-03-04T10:00:00Z"),
      },
      { action: `${prefix}x.other`, userId, createdAt: new Date("2026-03-05T10:00:00Z") },
    ],
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { action: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.$disconnect();
});

describe("listAuditLog", () => {
  it("resolves the acting user, null for system events and deleted users", async () => {
    const { items } = await listAuditLog({ action });
    expect(items).toHaveLength(3);
    expect(items.map((i) => [i.userId, i.user])).toEqual(
      expect.arrayContaining([
        [userId, { name: "Audit User", email: "auditlist@bilan.local" }],
        ["auditlist_gone", null],
        [null, null],
      ]),
    );
  });

  it("matches the action as a prefix (#164: `group` used to return nothing)", async () => {
    const { total } = await listAuditLog({ action: `${prefix}.` });
    expect(total).toBe(4);
    const all = await listAuditLog({ action: prefix });
    expect(all.total).toBe(5);
  });

  it("matches a known family only up to its dot", async () => {
    await db.auditLog.createMany({
      data: [
        { action: "audit.test_auditlist_family", userId: otherId },
        { action: "auditlog.test_auditlist_family", userId: otherId },
      ],
    });
    try {
      const { items } = await listAuditLog({ action: "audit", user: otherId });
      expect(items.map((i) => i.action)).toEqual(["audit.test_auditlist_family"]);
    } finally {
      await db.auditLog.deleteMany({ where: { action: { endsWith: "test_auditlist_family" } } });
    }
  });

  it("resolves the user an entity=User row is about", async () => {
    const { items } = await listAuditLog({ action: `${prefix}.role` });
    expect(items[0].subject).toEqual({ name: "Audit User", email: "auditlist@bilan.local" });
    expect(items[0].user?.email).toBe("someone-else@bilan.local");
  });

  it("filters by a fragment of the user's email or name, or an exact id", async () => {
    const byEmail = await listAuditLog({ action: prefix, user: "AUDITLIST@" });
    expect(byEmail.items.map((i) => i.userId)).toEqual([userId, userId]);
    const byName = await listAuditLog({ action: prefix, user: "other" });
    expect(byName.items.map((i) => i.userId)).toEqual([otherId]);
    const byId = await listAuditLog({ action: prefix, user: "auditlist_gone" });
    expect(byId.total).toBe(1);
    const none = await listAuditLog({ action: prefix, user: "nobody-matches-this" });
    expect(none.total).toBe(0);
  });

  it("filters by a half-open date range", async () => {
    const { items } = await listAuditLog({
      action: prefix,
      from: new Date("2026-03-02T00:00:00Z"),
      to: new Date("2026-03-04T00:00:00Z"),
    });
    expect(items.map((i) => i.createdAt.toISOString())).toEqual([
      "2026-03-03T10:00:00.000Z",
      "2026-03-02T10:00:00.000Z",
    ]);
  });

  it("paginates newest first and clamps a page past the end", async () => {
    const p2 = await listAuditLog({ action: prefix, page: 2, pageSize: 2 });
    expect(p2).toMatchObject({ total: 5, page: 2, pageCount: 3 });
    expect(p2.items.map((i) => i.createdAt.toISOString())).toEqual([
      "2026-03-03T10:00:00.000Z",
      "2026-03-02T10:00:00.000Z",
    ]);
    const past = await listAuditLog({ action: prefix, page: 99, pageSize: 2 });
    expect(past.page).toBe(3);
    expect(past.items).toHaveLength(1);
  });
});

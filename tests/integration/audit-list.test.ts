import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listAuditLog } from "@/server/services/audit";

const userId = "auditlist_user";
const action = "test.audit.list";

beforeAll(async () => {
  await db.auditLog.deleteMany({ where: { action } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.create({
    data: { id: userId, email: "auditlist@bilan.local", name: "Audit User" },
  });
  await db.auditLog.createMany({
    data: [
      { action, userId },
      { action, userId: "auditlist_gone" },
      { action, userId: null },
    ],
  });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { action } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("listAuditLog", () => {
  it("resolves the acting user, null for system events and deleted users", async () => {
    const { items } = await listAuditLog({ action });
    expect(items.map((i) => [i.userId, i.user]).sort()).toEqual(
      [
        [userId, { name: "Audit User", email: "auditlist@bilan.local" }],
        ["auditlist_gone", null],
        [null, null],
      ].sort(),
    );
  });
});

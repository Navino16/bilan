import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { purgeAuditOlderThan } from "@/server/services/audit";

const oldId = "purge_old_row";
const recentId = "purge_recent_row";

beforeAll(async () => {
  await db.auditLog.deleteMany({ where: { id: { in: [oldId, recentId] } } });
  await db.auditLog.create({
    data: { id: oldId, action: "test.purge.old", createdAt: new Date("2020-01-01T00:00:00.000Z") },
  });
  await db.auditLog.create({ data: { id: recentId, action: "test.purge.recent" } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { id: { in: [oldId, recentId] } } });
  await db.$disconnect();
});

describe("purgeAuditOlderThan", () => {
  it("deletes only rows older than the cutoff", async () => {
    const count = await purgeAuditOlderThan(new Date("2021-01-01T00:00:00.000Z"));
    expect(count).toBeGreaterThanOrEqual(1);
    expect(await db.auditLog.findUnique({ where: { id: oldId } })).toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: recentId } })).not.toBeNull();
  });
});

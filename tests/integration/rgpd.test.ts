import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { exportUserData, deleteUser } from "@/server/services/rgpd";

const userId = "rgpd_owner";
let accountId: string;
let groupId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.group.deleteMany({ where: { createdById: userId } });
  await db.user.create({ data: { id: userId, email: "rgpd-owner@bilan.local", name: "RGPD Owner" } });

  accountId = (
    await db.bankAccount.create({ data: { ownerId: userId, name: "Courant", type: "CHECKING" } })
  ).id;
  await db.category.create({ data: { userId, name: "Logement", color: "#aa1111" } });

  const secure = buildSecureFields({ label: "Loyer", rawLabel: "VIR LOYER" });
  await db.transaction.create({
    data: {
      accountId,
      date: new Date("2026-03-05T00:00:00.000Z"),
      amount: -700,
      type: "TRANSFER",
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      createdById: userId,
    },
  });

  await db.budget.create({
    data: {
      name: "Mars 2026",
      userId,
      createdById: userId,
      periodType: "MONTH",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-03-31T00:00:00.000Z"),
    },
  });

  groupId = (await db.group.create({ data: { name: "Foyer", createdById: userId } })).id;
  await db.groupMember.create({ data: { groupId, userId, role: "OWNER" } });
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: userId } });
  await db.group.deleteMany({ where: { createdById: userId } });
  await db.auditLog.deleteMany({ where: { entityId: userId, action: "user.deleted" } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("rgpd", () => {
  it("exportUserData returns the user's accounts, decrypted transactions, categories, budgets", async () => {
    const data = await exportUserData(userId);
    expect(data.user.id).toBe(userId);
    expect(data.accounts).toHaveLength(1);
    expect(data.transactions[0].label).toBe("Loyer"); // decrypted
    expect(data.budgets.length).toBeGreaterThanOrEqual(1);
  });

  it("deleteUser cascades owned data, clears FK-less rows, revokes sessions, keeps an anonymous audit entry", async () => {
    await db.session.create({
      data: { id: "s1", userId, token: "t1", expiresAt: new Date(Date.now() + 1e6) },
    });
    await deleteUser(userId, { id: userId });
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.bankAccount.count({ where: { ownerId: userId } })).toBe(0);
    const audit = await db.auditLog.findFirst({
      where: { action: "user.deleted" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.userId).toBeNull(); // anonymous
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { exportUserData, deleteUser } from "@/server/services/rgpd";
import { renameMerchant } from "@/server/services/merchants";

const userId = "rgpd_owner";
const ownerB = "rgpd_ownerB";
const succ = "rgpd_succ";
let accountId: string;
let groupId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.group.deleteMany({ where: { createdById: userId } });
  await db.user.create({
    data: { id: userId, email: "rgpd-owner@bilan.local", name: "RGPD Owner" },
  });

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

  await renameMerchant(userId, "FONCIA LOYER", "Loyer");

  groupId = (await db.group.create({ data: { name: "Foyer", createdById: userId } })).id;
  await db.groupMember.create({ data: { groupId, userId, role: "OWNER" } });
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: userId } });
  await db.group.deleteMany({ where: { createdById: { in: [userId, ownerB, succ] } } });
  await db.auditLog.deleteMany({ where: { entityId: userId, action: "user.deleted" } });
  await db.user.deleteMany({ where: { id: { in: [userId, ownerB, succ] } } });
  await db.$disconnect();
});

describe("rgpd", () => {
  it("exportUserData returns the user's accounts, decrypted transactions, categories, budgets", async () => {
    const data = await exportUserData(userId);
    expect(data.user.id).toBe(userId);
    expect(data.accounts).toHaveLength(1);
    expect(data.transactions[0].label).toBe("Loyer"); // decrypted
    expect(data.budgets.length).toBeGreaterThanOrEqual(1);
    expect(data.merchantAliases).toEqual([{ merchant: "FONCIA LOYER", name: "Loyer" }]);
  });

  it("deleteUser cascades owned data, clears FK-less rows, revokes sessions, keeps an anonymous audit entry", async () => {
    await db.session.create({
      data: { id: "s1", userId, token: "t1", expiresAt: new Date(Date.now() + 1e6) },
    });
    await deleteUser(userId, { id: userId });
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.bankAccount.count({ where: { ownerId: userId } })).toBe(0);
    expect(await db.merchantAlias.count({ where: { userId } })).toBe(0);
    const audit = await db.auditLog.findFirst({
      where: { action: "user.deleted" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.userId).toBeNull(); // anonymous
  });

  it("deleteUser hands a solely-owned group to the earliest remaining member", async () => {
    await db.user.createMany({
      data: [
        { id: ownerB, email: "rgpd-ownerb@bilan.local" },
        { id: succ, email: "rgpd-succ@bilan.local" },
      ],
    });
    const g = await db.group.create({ data: { name: "FoyerB", createdById: ownerB } });
    await db.groupMember.create({
      data: {
        groupId: g.id,
        userId: ownerB,
        role: "OWNER",
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.groupMember.create({
      data: {
        groupId: g.id,
        userId: succ,
        role: "MEMBER",
        joinedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });

    await deleteUser(ownerB, { id: ownerB });

    const group = await db.group.findUnique({ where: { id: g.id } });
    expect(group).not.toBeNull(); // survives (has another member)
    expect(group?.createdById).toBe(succ); // ownership reassigned
    const succMember = await db.groupMember.findFirst({ where: { groupId: g.id, userId: succ } });
    expect(succMember?.role).toBe("OWNER"); // promoted
    expect(await db.groupMember.count({ where: { groupId: g.id, userId: ownerB } })).toBe(0);
  });
});

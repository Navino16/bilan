import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { ownDeletionImpact } from "@/server/services/users/own-deletion";

const stamp = Date.now();
const userId = `own_del_${stamp}`;
const groupName = `OwnDel solo ${stamp}`;

async function addTransaction(accountId: string, amount: number) {
  const secure = buildSecureFields({ label: "Own del", rawLabel: "OWN DEL" });
  await db.transaction.create({
    data: {
      accountId,
      date: new Date("2026-03-05T00:00:00.000Z"),
      amount,
      type: "CARD",
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      createdById: userId,
    },
  });
}

beforeAll(async () => {
  await db.user.create({
    data: { id: userId, email: `own-del-${stamp}@bilan.local`, name: "Own Del" },
  });
  const group = await db.group.create({
    data: {
      name: groupName,
      createdById: userId,
      members: { create: { userId, role: "OWNER" } },
    },
  });
  const shared = await db.bankAccount.create({
    data: { ownerId: userId, name: "Shared", type: "CHECKING" },
  });
  await db.accountShare.create({
    data: { accountId: shared.id, groupId: group.id, permission: "READ", createdById: userId },
  });
  const personal = await db.bankAccount.create({
    data: { ownerId: userId, name: "Personal", type: "SAVINGS" },
  });
  await addTransaction(shared.id, -10);
  await addTransaction(shared.id, -20);
  await addTransaction(personal.id, 30);
});

afterAll(async () => {
  await db.group.deleteMany({ where: { createdById: userId } });
  await db.user.deleteMany({ where: { id: userId } });
});

describe("ownDeletionImpact (#255)", () => {
  it("counts the accounts, their transactions and the households that go", async () => {
    expect(await ownDeletionImpact(userId)).toMatchObject({
      accounts: 2,
      sharedAccounts: 1,
      transactions: 3,
      transfers: [],
      deletedGroups: [groupName],
      budgetLines: 0,
    });
  });

  it("is null for an unknown user", async () => {
    expect(await ownDeletionImpact(`missing_${stamp}`)).toBeNull();
  });
});

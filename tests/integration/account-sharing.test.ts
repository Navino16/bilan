import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createAccount, listVisibleForUser } from "@/server/services/accounts";
import { createGroup } from "@/server/services/groups";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import {
  shareAccountWithGroup,
  revokeShare,
  getEffectiveAccess,
  canWriteAccount,
  listAccountsSharedWithGroup,
  AccountAccessError,
} from "@/server/services/accounts/sharing";

const ownerId = "shr_owner";
const memberId = "shr_member";
const strangerId = "shr_stranger";
const ids = [ownerId, memberId, strangerId];

beforeAll(async () => {
  await db.accountShare.deleteMany({});
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
});

afterAll(async () => {
  await db.accountShare.deleteMany({});
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("account sharing & permissions", () => {
  it("shares an account READ with a group → member sees it read-only, owner still writes", async () => {
    const acc = await createAccount({ name: "Shared", type: "CHECKING" }, ownerId);
    const grp = await createGroup({ name: "Shared grp" }, ownerId);
    await db.groupMember.create({ data: { groupId: grp.id, userId: memberId, role: "MEMBER" } });

    await shareAccountWithGroup(
      { accountId: acc.id, groupId: grp.id, permission: "READ" },
      { id: ownerId },
    );

    const memberView = await listVisibleForUser(memberId);
    const seen = memberView.find((a) => a.id === acc.id);
    expect(seen).toBeTruthy();
    expect(seen!.access).toBe("READ");
    expect(seen!.ownerName).not.toBeNull();

    expect(await getEffectiveAccess(ownerId, acc.id)).toBe("OWNER");
    expect(await getEffectiveAccess(memberId, acc.id)).toBe("READ");
    expect(await canWriteAccount(memberId, acc.id)).toBe(false);
    expect(await canWriteAccount(ownerId, acc.id)).toBe(true);
  });

  it("WRITE share grants write to members; strangers see nothing", async () => {
    const acc = await createAccount({ name: "W", type: "OTHER" }, ownerId);
    const grp = await createGroup({ name: "W grp" }, ownerId);
    await db.groupMember.create({ data: { groupId: grp.id, userId: memberId, role: "MEMBER" } });
    await shareAccountWithGroup(
      { accountId: acc.id, groupId: grp.id, permission: "WRITE" },
      { id: ownerId },
    );

    expect(await canWriteAccount(memberId, acc.id)).toBe(true);
    expect(await getEffectiveAccess(strangerId, acc.id)).toBeNull();
    expect((await listVisibleForUser(strangerId)).some((a) => a.id === acc.id)).toBe(false);

    // The group's members see the account in the group's shared-accounts list.
    const groupShared = await listAccountsSharedWithGroup(grp.id, { id: memberId });
    expect(groupShared.some((a) => a.id === acc.id && a.permission === "WRITE")).toBe(true);
    // A non-member can't list the group's shared accounts.
    await expect(listAccountsSharedWithGroup(grp.id, { id: strangerId })).rejects.toThrow();
  });

  it("only the owner can share; revoke removes visibility", async () => {
    const acc = await createAccount({ name: "R", type: "OTHER" }, ownerId);
    const grp = await createGroup({ name: "R grp" }, ownerId);
    await db.groupMember.create({ data: { groupId: grp.id, userId: memberId, role: "MEMBER" } });
    await expect(
      shareAccountWithGroup(
        { accountId: acc.id, groupId: grp.id, permission: "READ" },
        { id: memberId },
      ),
    ).rejects.toBeInstanceOf(AccountAccessError);

    await shareAccountWithGroup(
      { accountId: acc.id, groupId: grp.id, permission: "READ" },
      { id: ownerId },
    );
    expect((await listVisibleForUser(memberId)).some((a) => a.id === acc.id)).toBe(true);
    await revokeShare({ accountId: acc.id, groupId: grp.id }, { id: ownerId });
    expect((await listVisibleForUser(memberId)).some((a) => a.id === acc.id)).toBe(false);
  });
});

async function txOn(accountId: string) {
  const secure = buildSecureFields({ label: "Courses", rawLabel: "CB COURSES" });
  return db.transaction.create({
    data: {
      accountId,
      date: new Date("2026-03-05T00:00:00Z"),
      amount: -20,
      type: "CARD",
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      createdById: ownerId,
    },
  });
}

function budgetFor(owner: { groupId: string } | { userId: string }) {
  return db.budget.create({
    data: {
      ...owner,
      name: "Revoke budget",
      periodType: "MONTH",
      periodStart: new Date("2026-03-01T00:00:00Z"),
      periodEnd: new Date("2026-03-31T23:59:59Z"),
      createdById: ownerId,
    },
  });
}

describe("revoking a share (#259 follow-up)", () => {
  it("drops that household's assignments on the account's transactions only", async () => {
    const acc = await createAccount({ name: "Revoked", type: "CHECKING" }, ownerId);
    const kept = await createAccount({ name: "Still shared", type: "CHECKING" }, ownerId);
    const grp = await createGroup({ name: "Revoke grp" }, ownerId);
    const other = await createGroup({ name: "Revoke other grp" }, ownerId);
    for (const [accountId, groupId] of [
      [acc.id, grp.id],
      [acc.id, other.id],
      [kept.id, grp.id],
    ])
      await shareAccountWithGroup({ accountId, groupId, permission: "READ" }, { id: ownerId });
    const [tAcc, tKept] = [await txOn(acc.id), await txOn(kept.id)];
    const [budget, otherBudget, personal] = [
      await budgetFor({ groupId: grp.id }),
      await budgetFor({ groupId: other.id }),
      await budgetFor({ userId: ownerId }),
    ];
    const assign = (budgetId: string, transactionId: string, mode: string) =>
      db.budgetAssignment.create({
        data: { budgetId, transactionId, mode, assignedById: ownerId },
      });
    await assign(budget.id, tAcc.id, "EXCLUDE");
    await assign(budget.id, tKept.id, "EXCLUDE");
    await assign(otherBudget.id, tAcc.id, "EXCLUDE");
    await assign(personal.id, tAcc.id, "INCLUDE");

    await revokeShare({ accountId: acc.id, groupId: grp.id }, { id: ownerId });

    const left = await db.budgetAssignment.findMany({
      where: { budgetId: { in: [budget.id, otherBudget.id, personal.id] } },
      select: { budgetId: true, transactionId: true },
    });
    expect(left).toHaveLength(3);
    expect(left).not.toContainEqual({ budgetId: budget.id, transactionId: tAcc.id });
    expect(left).toContainEqual({ budgetId: budget.id, transactionId: tKept.id });
    expect(await db.accountShare.count({ where: { accountId: acc.id } })).toBe(1);
    const audit = await db.auditLog.findFirst({
      where: { action: "account.share.revoke", entityId: acc.id },
    });
    expect(audit?.metadata).toEqual({ groupId: grp.id, removedAssignments: 1 });

    // Nothing was shared any more: an owner's INCLUDE from that account stays.
    await assign(budget.id, tAcc.id, "INCLUDE");
    await revokeShare({ accountId: acc.id, groupId: grp.id }, { id: ownerId });
    expect(
      await db.budgetAssignment.count({ where: { budgetId: budget.id, transactionId: tAcc.id } }),
    ).toBe(1);

    await db.budget.deleteMany({ where: { id: { in: [budget.id, otherBudget.id, personal.id] } } });
    await db.group.deleteMany({ where: { id: { in: [grp.id, other.id] } } });
  });
});

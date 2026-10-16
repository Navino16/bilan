import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  createGroup,
  listGroupsForUser,
  getGroupDetail,
  updateGroup,
  deleteGroup,
  groupDeletionImpact,
  changeMemberRole,
  removeMember,
  leaveGroup,
} from "@/server/services/groups";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { GroupAccessError } from "@/server/services/groups/roles";
import { getBudgetDetail, listBudgetsForUser } from "@/server/services/budgets";
import { visibleAccountIds } from "@/server/services/accounts";
import { canReadAccount } from "@/server/services/accounts/sharing";

const owner = "grp_owner";
const admin = "grp_admin";
const member = "grp_member";
const ids = [owner, admin, member];

beforeAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
});

afterAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("groups service", () => {
  it("creates a group with the creator as sole OWNER + audit", async () => {
    const g = await createGroup({ name: "Foyer" }, owner);
    const detail = await getGroupDetail(g.id, owner);
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0]).toMatchObject({ userId: owner, role: "OWNER" });
    expect(
      await db.auditLog.findFirst({ where: { action: "group.created", entityId: g.id } }),
    ).not.toBeNull();
  });

  it("trims names and rejects blank or oversized names and descriptions (#163)", async () => {
    await expect(createGroup({ name: "   " }, owner)).rejects.toThrow("INVALID");
    const g = await createGroup({ name: "  Trimmed  " }, owner);
    expect((await getGroupDetail(g.id, owner)).name).toBe("Trimmed");
    await expect(updateGroup(g.id, { name: "   " }, { id: owner })).rejects.toThrow("INVALID");
    await expect(updateGroup(g.id, { name: "x".repeat(101) }, { id: owner })).rejects.toThrow(
      "INVALID",
    );
    await expect(
      updateGroup(g.id, { name: "Ok", description: "d".repeat(192) }, { id: owner }),
    ).rejects.toThrow("INVALID");
    expect((await getGroupDetail(g.id, owner)).name).toBe("Trimmed");
  });

  it("lists only groups the user belongs to, with their role", async () => {
    const g = await createGroup({ name: "Mine" }, owner);
    expect((await listGroupsForUser(owner)).some((x) => x.id === g.id && x.role === "OWNER")).toBe(
      true,
    );
    expect((await listGroupsForUser(member)).some((x) => x.id === g.id)).toBe(false);
  });

  it("enforces role rules", async () => {
    const g = await createGroup({ name: "Rules" }, owner);
    // seed an ADMIN and a MEMBER directly
    await db.groupMember.create({ data: { groupId: g.id, userId: admin, role: "ADMIN" } });
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });

    // MEMBER cannot rename
    await expect(updateGroup(g.id, { name: "x" }, { id: member })).rejects.toBeInstanceOf(
      GroupAccessError,
    );
    // ADMIN can rename
    await updateGroup(g.id, { name: "Renamed" }, { id: admin });
    // ADMIN cannot delete; OWNER can
    await expect(deleteGroup(g.id, { id: admin })).rejects.toBeInstanceOf(GroupAccessError);
    // only OWNER changes roles
    await expect(changeMemberRole(g.id, member, "ADMIN", { id: admin })).rejects.toBeInstanceOf(
      GroupAccessError,
    );
    await changeMemberRole(g.id, member, "ADMIN", { id: owner });
    expect((await getGroupDetail(g.id, owner)).members.find((m) => m.userId === member)?.role).toBe(
      "ADMIN",
    );
  });

  it("prevents removing/demoting the last OWNER", async () => {
    const g = await createGroup({ name: "Solo" }, owner);
    await expect(changeMemberRole(g.id, owner, "ADMIN", { id: owner })).rejects.toBeInstanceOf(
      GroupAccessError,
    );
    await expect(leaveGroup(g.id, owner)).rejects.toBeInstanceOf(GroupAccessError);
    await expect(removeMember(g.id, owner, { id: owner })).rejects.toBeInstanceOf(GroupAccessError);
  });

  it("an ADMIN can only remove members ranked below them", async () => {
    const g = await createGroup({ name: "Ranks" }, owner);
    await db.groupMember.create({ data: { groupId: g.id, userId: admin, role: "ADMIN" } });
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });

    // ADMIN cannot remove an OWNER (even though another owner would remain — here
    // the owner is the last one, so this also guards the rank check, not just the
    // last-owner check).
    await expect(removeMember(g.id, owner, { id: admin })).rejects.toBeInstanceOf(GroupAccessError);

    // ADMIN cannot remove a peer ADMIN.
    const admin2 = await db.user.create({
      data: { id: "grp_admin2", email: "grp_admin2@b.local" },
    });
    await db.groupMember.create({ data: { groupId: g.id, userId: admin2.id, role: "ADMIN" } });
    await expect(removeMember(g.id, admin2.id, { id: admin })).rejects.toBeInstanceOf(
      GroupAccessError,
    );

    // ADMIN can remove a MEMBER.
    await removeMember(g.id, member, { id: admin });
    expect((await getGroupDetail(g.id, owner)).members.some((m) => m.userId === member)).toBe(
      false,
    );

    // OWNER can remove an ADMIN.
    await removeMember(g.id, admin, { id: owner });
    expect((await getGroupDetail(g.id, owner)).members.some((m) => m.userId === admin)).toBe(false);

    await db.groupMember.deleteMany({ where: { userId: admin2.id } });
    await db.user.delete({ where: { id: admin2.id } });
  });

  it("lets a MEMBER leave, and an OWNER delete the group", async () => {
    const g = await createGroup({ name: "Leaveable" }, owner);
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });
    await leaveGroup(g.id, member);
    expect((await getGroupDetail(g.id, owner)).members.some((m) => m.userId === member)).toBe(
      false,
    );
    await deleteGroup(g.id, { id: owner });
    expect(await db.group.findUnique({ where: { id: g.id } })).toBeNull();
  });

  it("previews what deleting a household takes with it (#255)", async () => {
    const g = await createGroup({ name: "Impact" }, owner);
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });
    const account = await db.bankAccount.create({
      data: { ownerId: owner, name: "Impact account", type: "CHECKING" },
    });
    await db.accountShare.create({
      data: { accountId: account.id, groupId: g.id, permission: "READ", createdById: owner },
    });
    const category = await db.category.create({ data: { groupId: g.id, name: "Courses" } });
    await db.categorizationRule.create({
      data: { groupId: g.id, categoryId: category.id, pattern: "carrefour", matchType: "CONTAINS" },
    });
    await db.budget.create({
      data: {
        groupId: g.id,
        name: "Impact budget",
        periodType: "MONTH",
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-01-31T00:00:00Z"),
        createdById: owner,
      },
    });
    const secure = buildSecureFields({ label: "Carrefour", rawLabel: "CB CARREFOUR" });
    const tx = await db.transaction.create({
      data: {
        accountId: account.id,
        categoryId: category.id,
        date: new Date("2026-01-05T00:00:00Z"),
        amount: -12,
        type: "CARD",
        labelEnc: secure.labelEnc,
        labelHash: secure.labelHash,
        rawLabelEnc: secure.rawLabelEnc,
        rawLabelHash: secure.rawLabelHash,
        createdById: owner,
      },
    });

    await expect(groupDeletionImpact(g.id, { id: member })).rejects.toBeInstanceOf(
      GroupAccessError,
    );
    expect(await groupDeletionImpact(g.id, { id: owner })).toEqual({
      shares: 1,
      categories: 1,
      rules: 1,
      budgets: 1,
      uncategorized: 1,
    });

    await deleteGroup(g.id, { id: owner });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId).toBe(
      null,
    );
    await db.bankAccount.delete({ where: { id: account.id } });
  });
});

async function txOn(accountId: string, createdById: string) {
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
      createdById,
    },
  });
}

async function budgetFor(owner: { groupId: string } | { userId: string }, createdById: string) {
  return db.budget.create({
    data: {
      ...owner,
      name: "Departure budget",
      periodType: "MONTH",
      periodStart: new Date("2026-03-01T00:00:00Z"),
      periodEnd: new Date("2026-03-31T23:59:59Z"),
      createdById,
      lines: { create: { plannedAmount: 100 } },
    },
  });
}

// The member shares one account with the household and with a second one (owner not in it),
// keeps another private; the owner shares one account too.
async function seedDeparture() {
  const g = await createGroup({ name: "Departure" }, owner);
  const other = await createGroup({ name: "Other household" }, admin);
  for (const groupId of [g.id, other.id])
    await db.groupMember.create({ data: { groupId, userId: member, role: "MEMBER" } });
  const account = (ownerId: string, name: string) =>
    db.bankAccount.create({ data: { ownerId, name, type: "CHECKING" } });
  const memberShared = await account(member, "Member shared");
  const memberPrivate = await account(member, "Member private");
  const ownerShared = await account(owner, "Owner shared");
  const share = (accountId: string, groupId: string, createdById: string) =>
    db.accountShare.create({ data: { accountId, groupId, permission: "READ", createdById } });
  await share(memberShared.id, g.id, member);
  await share(memberShared.id, other.id, member);
  await share(ownerShared.id, g.id, owner);

  const [tMemberShared, tMemberPrivate, tOwner] = await Promise.all([
    txOn(memberShared.id, member),
    txOn(memberPrivate.id, member),
    txOn(ownerShared.id, owner),
  ]);
  const budget = await budgetFor({ groupId: g.id }, owner);
  const otherBudget = await budgetFor({ groupId: other.id }, admin);
  const personal = await budgetFor({ userId: member }, member);
  const assign = (budgetId: string, transactionId: string, mode: string, assignedById: string) =>
    db.budgetAssignment.create({ data: { budgetId, transactionId, mode, assignedById } });
  await assign(budget.id, tMemberShared.id, "EXCLUDE", owner);
  await assign(budget.id, tMemberPrivate.id, "INCLUDE", member);
  await assign(budget.id, tOwner.id, "EXCLUDE", owner);
  await assign(otherBudget.id, tMemberShared.id, "EXCLUDE", admin);
  await assign(personal.id, tMemberShared.id, "INCLUDE", member);

  expect((await getBudgetDetail(budget.id, owner)).spentTotal).toBe(20);
  return { g, other, memberShared, ownerShared, tOwner, budget, otherBudget, personal };
}

async function expectDetached(s: Awaited<ReturnType<typeof seedDeparture>>) {
  const shares = await db.accountShare.findMany({
    where: { groupId: { in: [s.g.id, s.other.id] } },
    select: { accountId: true, groupId: true },
  });
  expect(shares).toHaveLength(2);
  expect(shares).toEqual(
    expect.arrayContaining([
      { accountId: s.ownerShared.id, groupId: s.g.id },
      { accountId: s.memberShared.id, groupId: s.other.id },
    ]),
  );
  const left = await db.budgetAssignment.findMany({
    where: { budgetId: { in: [s.budget.id, s.otherBudget.id, s.personal.id] } },
    select: { budgetId: true, transactionId: true },
  });
  expect(left).toHaveLength(3);
  expect(left).toContainEqual({ budgetId: s.budget.id, transactionId: s.tOwner.id });
  expect(left.filter((a) => a.budgetId !== s.budget.id)).toHaveLength(2);

  expect((await listBudgetsForUser(member)).some((b) => b.id === s.budget.id)).toBe(false);
  await expect(getBudgetDetail(s.budget.id, member)).rejects.toThrow("FORBIDDEN");
  expect(await visibleAccountIds(owner)).not.toContain(s.memberShared.id);
  expect(await canReadAccount(owner, s.memberShared.id)).toBe(false);
  expect((await getBudgetDetail(s.budget.id, owner)).spentTotal).toBe(0);
}

async function cleanupDeparture(s: Awaited<ReturnType<typeof seedDeparture>>) {
  await db.group.deleteMany({ where: { id: { in: [s.g.id, s.other.id] } } });
  await db.budget.deleteMany({ where: { id: s.personal.id } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, member] } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: [s.g.id, s.other.id] } } });
}

describe("leaving or being removed from a household (#259)", () => {
  it("drops the leaver's shares and the assignments of their transactions", async () => {
    const s = await seedDeparture();
    await leaveGroup(s.g.id, member);
    await expectDetached(s);
    const audit = await db.auditLog.findFirst({
      where: { action: "group.member.removed", entityId: s.g.id },
    });
    expect(audit?.metadata).toEqual({
      targetUserId: member,
      self: true,
      unsharedAccounts: 1,
      removedAssignments: 2,
    });
    await cleanupDeparture(s);
  });

  it("does the same when an admin removes the member", async () => {
    const s = await seedDeparture();
    await removeMember(s.g.id, member, { id: owner });
    await expectDetached(s);
    const audit = await db.auditLog.findFirst({
      where: { action: "group.member.removed", entityId: s.g.id },
    });
    expect(audit?.metadata).toEqual({
      targetUserId: member,
      unsharedAccounts: 1,
      removedAssignments: 2,
    });
    await cleanupDeparture(s);
  });
});

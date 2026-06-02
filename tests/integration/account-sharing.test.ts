import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createAccount, listVisibleForUser } from "@/server/services/accounts";
import { createGroup } from "@/server/services/groups";
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

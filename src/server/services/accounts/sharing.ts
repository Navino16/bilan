import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import {
  AccountAccessError,
  accountBalances,
  ownedOrThrow,
  type AccountAccess,
} from "@/server/services/accounts";
import { requireGroupRole } from "@/server/services/groups/roles";
import { dropGroupAssignments, unshareFromGroup } from "@/server/services/groups/detach";
import { displayName } from "@/lib/validation/name";

export { AccountAccessError } from "@/server/services/accounts";

export type SharedAccount = {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  color: string | null;
  balance: number;
  permission: SharePermission;
  ownerName: string;
};

const PERMISSIONS = ["READ", "WRITE"] as const;
export type SharePermission = (typeof PERMISSIONS)[number];

export async function shareAccountWithGroup(
  input: { accountId: string; groupId: string; permission: SharePermission },
  actor: { id: string },
): Promise<void> {
  if (!PERMISSIONS.includes(input.permission)) throw new AccountAccessError("INVALID");
  await ownedOrThrow(input.accountId, actor.id);
  // The owner must belong to the group they share into.
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: input.groupId, userId: actor.id } },
  });
  if (!membership) throw new AccountAccessError("FORBIDDEN");

  await db.accountShare.upsert({
    where: { accountId_groupId: { accountId: input.accountId, groupId: input.groupId } },
    update: { permission: input.permission },
    create: {
      accountId: input.accountId,
      groupId: input.groupId,
      permission: input.permission,
      createdById: actor.id,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "account.share.create",
    entity: "AccountShare",
    entityId: input.accountId,
    metadata: { groupId: input.groupId, permission: input.permission },
  });
}

export async function revokeShare(
  input: { accountId: string; groupId: string },
  actor: { id: string },
): Promise<void> {
  await ownedOrThrow(input.accountId, actor.id);
  const account = { id: input.accountId };
  // Without a share there is nothing to undo: the owner's INCLUDEs from a private account stay.
  const removedAssignments = await db.$transaction(async (tx) =>
    (await unshareFromGroup(tx, input.groupId, account)) > 0
      ? dropGroupAssignments(tx, input.groupId, account)
      : 0,
  );
  await logEvent({
    userId: actor.id,
    action: "account.share.revoke",
    entity: "AccountShare",
    entityId: input.accountId,
    metadata: { groupId: input.groupId, removedAssignments },
  });
}

export async function listSharesForAccount(accountId: string, actor: { id: string }) {
  await ownedOrThrow(accountId, actor.id);
  return db.accountShare.findMany({ where: { accountId }, include: { group: true } });
}

// Accounts shared with a group, visible to its members (for the group detail page).
export async function listAccountsSharedWithGroup(
  groupId: string,
  actor: { id: string },
): Promise<SharedAccount[]> {
  await requireGroupRole(groupId, actor.id, "MEMBER");
  const shares = await db.accountShare.findMany({
    where: { groupId, account: { archived: false } },
    include: { account: { include: { owner: true } } },
    orderBy: { createdAt: "desc" },
  });
  const balances = await accountBalances(shares.map((s) => s.account));
  return shares.map((s) => ({
    id: s.account.id,
    name: s.account.name,
    type: s.account.type,
    bankName: s.account.bankName,
    color: s.account.color,
    balance: balances.get(s.account.id) ?? Number(s.account.initialBalance),
    permission: s.permission as SharePermission,
    ownerName: displayName(s.account.owner),
  }));
}

// Highest access the user has on the account: OWNER > WRITE > READ > null.
export async function getEffectiveAccess(
  userId: string,
  accountId: string,
): Promise<AccountAccess | null> {
  const acc = await db.bankAccount.findUnique({ where: { id: accountId } });
  if (!acc) return null;
  if (acc.ownerId === userId) return "OWNER";
  const shares = await db.accountShare.findMany({
    where: { accountId, group: { members: { some: { userId } } } },
  });
  if (shares.length === 0) return null;
  return shares.some((s) => s.permission === "WRITE") ? "WRITE" : "READ";
}

export async function canWriteAccount(userId: string, accountId: string): Promise<boolean> {
  const access = await getEffectiveAccess(userId, accountId);
  return access === "OWNER" || access === "WRITE";
}

export async function canReadAccount(userId: string, accountId: string): Promise<boolean> {
  return (await getEffectiveAccess(userId, accountId)) !== null;
}

import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { AccountAccessError, type AccountAccess } from "@/server/services/accounts";

export { AccountAccessError } from "@/server/services/accounts";

const PERMISSIONS = ["READ", "WRITE"] as const;
export type SharePermission = (typeof PERMISSIONS)[number];

async function ownedOrThrow(accountId: string, actorId: string) {
  const acc = await db.bankAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.ownerId !== actorId) throw new AccountAccessError("FORBIDDEN");
  return acc;
}

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
  await db.accountShare
    .delete({
      where: { accountId_groupId: { accountId: input.accountId, groupId: input.groupId } },
    })
    .catch(() => undefined);
  await logEvent({
    userId: actor.id,
    action: "account.share.revoke",
    entity: "AccountShare",
    entityId: input.accountId,
    metadata: { groupId: input.groupId },
  });
}

export async function listSharesForAccount(accountId: string, actor: { id: string }) {
  await ownedOrThrow(accountId, actor.id);
  return db.accountShare.findMany({ where: { accountId }, include: { group: true } });
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

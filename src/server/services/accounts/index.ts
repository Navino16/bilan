import { db } from "@/server/db";
import { encrypt, decrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { accountInputSchema, type AccountInput } from "@/lib/validation/account";
import { isValidIban, normalizeIban, maskIban, formatIban } from "./iban";

// Thrown for both authorization failures and invalid business input so callers
// (Server Actions) can map any of them to a single user-facing error state.
export class AccountAccessError extends Error {}

export type AccountAccess = "OWNER" | "WRITE" | "READ";

export type VisibleAccount = {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  color: string | null;
  icon: string | null;
  archived: boolean;
  initialBalance: number;
  balance: number; // opening balance + every transaction of the account
  ibanMasked: string | null;
  access: AccountAccess;
  sharedCount: number; // groups this account is shared with (owner view only; 0 otherwise)
  ownerName: string | null; // null when the viewer owns it
};

// Current balance per account: opening balance + sum of its transactions.
export async function accountBalances(
  accounts: { id: string; initialBalance: unknown }[],
): Promise<Map<string, number>> {
  const sums = await db.transaction.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _sum: { amount: true },
  });
  const byId = new Map(sums.map((s) => [s.accountId, Number(s._sum.amount ?? 0)]));
  return new Map(
    accounts.map((a) => [
      a.id,
      Math.round((Number(a.initialBalance) + (byId.get(a.id) ?? 0)) * 100) / 100,
    ]),
  );
}

function ibanFields(iban: string | undefined): {
  ibanEnc: string | null;
  ibanHash: string | null;
} {
  if (!iban) return { ibanEnc: null, ibanHash: null };
  const normalized = normalizeIban(iban);
  if (!isValidIban(normalized)) throw new AccountAccessError("INVALID_IBAN");
  return { ibanEnc: encrypt(normalized, dataKey), ibanHash: hmacForSearch(normalized, searchKey) };
}

export async function createAccount(input: AccountInput, ownerId: string): Promise<{ id: string }> {
  const data = accountInputSchema.parse(input);
  const { ibanEnc, ibanHash } = ibanFields(data.iban);
  const acc = await db.bankAccount.create({
    data: {
      ownerId,
      name: data.name,
      type: data.type,
      bankName: data.bankName ?? null,
      color: data.color ?? undefined,
      icon: data.icon ?? null,
      initialBalance: data.initialBalance,
      ibanEnc,
      ibanHash,
    },
  });
  await logEvent({
    userId: ownerId,
    action: "account.created",
    entity: "BankAccount",
    entityId: acc.id,
  });
  return { id: acc.id };
}

export async function ownedOrThrow(id: string, actorId: string) {
  const acc = await db.bankAccount.findUnique({ where: { id } });
  if (!acc || acc.ownerId !== actorId) throw new AccountAccessError("FORBIDDEN");
  return acc;
}

// A blank IBAN keeps the stored one; `removeIban` clears it.
export async function updateAccount(
  id: string,
  input: AccountInput,
  actor: { id: string },
  opts: { removeIban?: boolean } = {},
): Promise<void> {
  await ownedOrThrow(id, actor.id);
  const data = accountInputSchema.parse(input);
  const iban = data.iban
    ? ibanFields(data.iban)
    : opts.removeIban
      ? { ibanEnc: null, ibanHash: null }
      : {};
  await db.bankAccount.update({
    where: { id },
    data: {
      name: data.name,
      type: data.type,
      bankName: data.bankName ?? null,
      color: data.color ?? undefined,
      icon: data.icon ?? null,
      initialBalance: data.initialBalance,
      ...iban,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "account.updated",
    entity: "BankAccount",
    entityId: id,
  });
}

export async function archiveAccount(id: string, actor: { id: string }): Promise<void> {
  await ownedOrThrow(id, actor.id);
  await db.bankAccount.update({ where: { id }, data: { archived: true } });
  await logEvent({
    userId: actor.id,
    action: "account.archived",
    entity: "BankAccount",
    entityId: id,
  });
}

export async function unarchiveAccount(id: string, actor: { id: string }): Promise<void> {
  await ownedOrThrow(id, actor.id);
  await db.bankAccount.update({ where: { id }, data: { archived: false } });
  await logEvent({
    userId: actor.id,
    action: "account.unarchived",
    entity: "BankAccount",
    entityId: id,
  });
}

export async function getAccountForUser(id: string, userId: string) {
  const acc = await db.bankAccount.findUnique({ where: { id } });
  if (!acc || acc.ownerId !== userId) return null;
  return acc;
}

// Decrypts the IBAN on demand for the owner only — kept out of listVisibleForUser
// so the clear IBAN never ships in the page payload, only on explicit reveal.
export async function getAccountIban(id: string, userId: string): Promise<string | null> {
  const acc = await db.bankAccount.findUnique({ where: { id } });
  if (!acc || acc.ownerId !== userId || !acc.ibanEnc) return null;
  return formatIban(decrypt(acc.ibanEnc, dataKey));
}

export async function isAccountArchived(id: string): Promise<boolean> {
  const acc = await db.bankAccount.findUnique({ where: { id }, select: { archived: true } });
  return acc?.archived ?? false;
}

// Every account whose history the user can read (owned or shared), archived ones
// included: archiving hides an account from pickers, not from history (#174).
export async function visibleAccountRefs(userId: string): Promise<{ id: string; name: string }[]> {
  return db.bankAccount.findMany({
    where: {
      OR: [{ ownerId: userId }, { shares: { some: { group: { members: { some: { userId } } } } } }],
    },
    select: { id: true, name: true },
  });
}

export async function visibleAccountIds(userId: string): Promise<string[]> {
  return (await visibleAccountRefs(userId)).map((a) => a.id);
}

// Owned accounts plus accounts shared via the viewer's groups; archived ones only
// on request. Owner access wins; shared viewers never receive the IBAN.
export async function listVisibleForUser(
  userId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<VisibleAccount[]> {
  const archived = opts.includeArchived ? {} : { archived: false };
  const owned = await db.bankAccount.findMany({
    where: { ownerId: userId, ...archived },
    include: { _count: { select: { shares: true } } },
    orderBy: { createdAt: "desc" },
  });
  const shared = await db.bankAccount.findMany({
    where: {
      ...archived,
      ownerId: { not: userId },
      shares: { some: { group: { members: { some: { userId } } } } },
    },
    include: {
      owner: true,
      shares: { where: { group: { members: { some: { userId } } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const balances = await accountBalances([...owned, ...shared]);

  const ownedView: VisibleAccount[] = owned.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    bankName: a.bankName,
    color: a.color,
    icon: a.icon,
    archived: a.archived,
    initialBalance: Number(a.initialBalance),
    balance: balances.get(a.id) ?? Number(a.initialBalance),
    ibanMasked: a.ibanEnc ? maskIban(decrypt(a.ibanEnc, dataKey)) : null,
    access: "OWNER",
    sharedCount: a._count.shares,
    ownerName: null,
  }));

  const sharedView: VisibleAccount[] = shared.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    bankName: a.bankName,
    color: a.color,
    icon: a.icon,
    archived: a.archived,
    initialBalance: Number(a.initialBalance),
    balance: balances.get(a.id) ?? Number(a.initialBalance),
    ibanMasked: null, // shared viewers never see the IBAN
    access: a.shares.some((s) => s.permission === "WRITE") ? "WRITE" : "READ",
    sharedCount: 0,
    ownerName: a.owner.name ?? a.owner.email,
  }));

  return [...ownedView, ...sharedView];
}

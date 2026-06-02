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
  balance: number; // displayed balance: opening balance for now, + transactions later
  ibanMasked: string | null;
  access: AccountAccess;
  ownerName: string | null; // null when the viewer owns it
};

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

async function ownedOrThrow(id: string, actorId: string) {
  const acc = await db.bankAccount.findUnique({ where: { id } });
  if (!acc || acc.ownerId !== actorId) throw new AccountAccessError("FORBIDDEN");
  return acc;
}

export async function updateAccount(
  id: string,
  input: AccountInput,
  actor: { id: string },
): Promise<void> {
  await ownedOrThrow(id, actor.id);
  const data = accountInputSchema.parse(input);
  const { ibanEnc, ibanHash } = ibanFields(data.iban);
  await db.bankAccount.update({
    where: { id },
    data: {
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

// Phase 2.1: owned, non-archived accounts only. Extended in 2.4 to merge in
// accounts shared via the viewer's groups.
export async function listVisibleForUser(userId: string): Promise<VisibleAccount[]> {
  const owned = await db.bankAccount.findMany({
    where: { ownerId: userId, archived: false },
    orderBy: { createdAt: "desc" },
  });
  return owned.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    bankName: a.bankName,
    color: a.color,
    icon: a.icon,
    archived: a.archived,
    balance: Number(a.initialBalance),
    ibanMasked: a.ibanEnc ? maskIban(decrypt(a.ibanEnc, dataKey)) : null,
    access: "OWNER",
    ownerName: null,
  }));
}

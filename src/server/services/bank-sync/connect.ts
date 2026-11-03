import { randomBytes } from "node:crypto";
import { db } from "@/server/db";
import { decrypt, encrypt } from "@/server/crypto/encryption";
import { hmacExact } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { normalizeIban } from "@/server/services/accounts/iban";
import { EnableBankingError, type EnableBankingClient } from "@/server/services/bank-sync/client";
import {
  bankSyncClient,
  bankSyncRedirectUrl,
  isBankSyncAvailable,
} from "@/server/services/bank-sync/config";
import { asBankSyncError, BankSyncError } from "@/server/services/bank-sync/errors";

export const AUTH_REQUEST_TTL_MS = 15 * 60_000;
export const ASPSP_CACHE_MS = 24 * 3600_000;
const CONSENT_MARGIN_MS = 3600_000;

export type BankOption = { name: string; country: string; maxConsentDays: number };

const bankCache = new Map<string, { at: number; banks: BankOption[] }>();

export function clearBankListCache(): void {
  bankCache.clear();
}

async function availableClient(client?: EnableBankingClient): Promise<EnableBankingClient> {
  if (!(await isBankSyncAvailable())) throw new BankSyncError("UNAVAILABLE");
  const c = client ?? (await bankSyncClient());
  if (!c) throw new BankSyncError("UNAVAILABLE");
  return c;
}

export async function listBanks(
  country: string,
  opts: { client?: EnableBankingClient } = {},
): Promise<BankOption[]> {
  const client = await availableClient(opts.client);
  const cached = bankCache.get(country);
  if (cached && Date.now() - cached.at < ASPSP_CACHE_MS) return cached.banks;
  let aspsps;
  try {
    aspsps = await client.aspsps(country);
  } catch (e) {
    throw asBankSyncError(e);
  }
  // The authorization is always requested for a personal PSU.
  const banks = aspsps
    .filter((a) => a.psu_types.includes("personal"))
    .map((a) => ({
      name: a.name,
      country: a.country,
      maxConsentDays: Math.floor(a.maximum_consent_validity / 86_400),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  bankCache.set(country, { at: Date.now(), banks });
  return banks;
}

export async function startBankAuth(
  userId: string,
  input: { aspspName: string; country: string; reconnectOf?: string },
  opts: { client?: EnableBankingClient; now?: Date } = {},
): Promise<{ url: string }> {
  const now = opts.now ?? new Date();
  const client = await availableClient(opts.client);
  const bank = (await listBanks(input.country, { client })).find((b) => b.name === input.aspspName);
  if (!bank) throw new BankSyncError("UNKNOWN_BANK");
  if (input.reconnectOf) {
    const owned = await db.bankConnection.count({ where: { id: input.reconnectOf, userId } });
    if (owned === 0) throw new BankSyncError("NOT_FOUND");
  }

  const state = randomBytes(32).toString("base64url");
  const request = await db.bankAuthRequest.create({
    data: {
      stateHash: hmacExact(state, searchKey),
      userId,
      aspspName: bank.name,
      aspspCountry: bank.country,
      reconnectOf: input.reconnectOf ?? null,
      createdAt: now,
    },
  });
  try {
    return await client.startAuth({
      aspspName: bank.name,
      country: bank.country,
      validUntil: new Date(now.getTime() + bank.maxConsentDays * 86_400_000 - CONSENT_MARGIN_MS),
      state,
      redirectUrl: bankSyncRedirectUrl(),
    });
  } catch (e) {
    await db.bankAuthRequest.deleteMany({ where: { id: request.id } });
    throw asBankSyncError(e);
  }
}

// Review Focus 5: a foreign user leaves the request for its owner; every other refusal consumes it.
export async function completeBankAuth(
  userId: string,
  input: { state: string; code?: string; error?: string },
  opts: { client?: EnableBankingClient; now?: Date } = {},
): Promise<{ connectionId: string; needsMapping: boolean }> {
  const now = opts.now ?? new Date();
  const request = await db.bankAuthRequest.findUnique({
    where: { stateHash: hmacExact(input.state, searchKey) },
  });
  if (!request) throw new BankSyncError("UNKNOWN_STATE");
  if (request.userId !== userId) throw new BankSyncError("WRONG_USER");
  const { count } = await db.bankAuthRequest.deleteMany({ where: { id: request.id, userId } });
  if (count !== 1) throw new BankSyncError("UNKNOWN_STATE");
  if (request.createdAt.getTime() < now.getTime() - AUTH_REQUEST_TTL_MS) {
    throw new BankSyncError("EXPIRED_STATE");
  }
  if (input.error || !input.code) throw new BankSyncError("DENIED");

  const client = await availableClient(opts.client);
  let session;
  try {
    session = await client.createSession(input.code);
  } catch (e) {
    throw asBankSyncError(e);
  }
  const validUntil = new Date(session.access?.valid_until);
  if (Number.isNaN(validUntil.getTime())) throw new BankSyncError("HTTP");

  const accounts = (session.accounts ?? []).flatMap((a, i) =>
    a.uid
      ? [
          {
            uidEnc: encrypt(a.uid, dataKey),
            ibanHash: a.account_id?.iban
              ? hmacExact(normalizeIban(a.account_id.iban), searchKey)
              : null,
            name: (a.name?.trim() || `${request.aspspName} ${i + 1}`).slice(0, 100),
            currency: (a.currency ?? "EUR").slice(0, 3),
          },
        ]
      : [],
  );
  const connection = await db.bankConnection.create({
    data: {
      userId,
      aspspName: request.aspspName,
      aspspCountry: request.aspspCountry,
      sessionIdEnc: encrypt(session.session_id, dataKey),
      validUntil,
      accounts: { create: accounts },
    },
  });
  await logEvent({
    userId,
    action: "bank_sync.connection.created",
    entity: "BankConnection",
    entityId: connection.id,
    metadata: { aspspName: request.aspspName, accounts: accounts.length },
  });
  return { connectionId: connection.id, needsMapping: true };
}

export async function purgeExpiredAuthRequests(now: Date): Promise<number> {
  const { count } = await db.bankAuthRequest.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - AUTH_REQUEST_TTL_MS) } },
  });
  return count;
}

export type BankConnectionSummary = {
  id: string;
  aspspName: string;
  status: string;
  validUntil: Date;
  mappedAccounts: string[];
};

export async function listBankConnections(userId: string): Promise<BankConnectionSummary[]> {
  const rows = await db.bankConnection.findMany({
    where: { userId, status: { not: "REVOKED" } },
    select: {
      id: true,
      aspspName: true,
      status: true,
      validUntil: true,
      accounts: { select: { account: { select: { name: true } } }, orderBy: { name: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(({ accounts, ...c }) => ({
    ...c,
    mappedAccounts: accounts.flatMap((a) => (a.account ? [a.account.name] : [])),
  }));
}

// Read before a user deletion erases the connections; revoked once it committed.
export async function userBankSessions(userId: string): Promise<string[]> {
  const rows = await db.bankConnection.findMany({
    where: { userId, status: { not: "REVOKED" } },
    select: { sessionIdEnc: true },
  });
  return rows.map((r) => r.sessionIdEnc);
}

// Best effort: a session Enable Banking still holds expires with its consent.
export async function revokeBankSessions(
  sessionIdsEnc: string[],
  opts: { client?: EnableBankingClient } = {},
): Promise<void> {
  if (sessionIdsEnc.length === 0) return;
  const client = opts.client ?? (await bankSyncClient({ requireEnabled: false }).catch(() => null));
  if (!client) return;
  for (const enc of sessionIdsEnc) {
    try {
      await client.deleteSession(decrypt(enc, dataKey));
    } catch (e) {
      console.error(
        "[bilan] bank session revoke failed",
        e instanceof EnableBankingError ? e.code : "UNKNOWN",
      );
    }
  }
}

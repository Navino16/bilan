import { randomBytes } from "node:crypto";
import type { BankConnectionAccount, PrismaClient } from "@prisma/client";
import { consentState, type ConsentState } from "@/lib/bank-sync";
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

export async function availableClient(client?: EnableBankingClient): Promise<EnableBankingClient> {
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
    const owned = await db.bankConnection.count({
      where: {
        id: input.reconnectOf,
        userId,
        status: { not: "REVOKED" },
        aspspName: bank.name,
        aspspCountry: bank.country,
      },
    });
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

type NewLink = {
  uidEnc: string;
  ibanHash: string | null;
  name: string;
  currency: string;
};
type CarriedFields = Pick<
  BankConnectionAccount,
  | "accountId"
  | "syncFrom"
  | "lastSyncedDate"
  | "bookedBalance"
  | "bookedBalanceDate"
  | "expectedBalance"
  | "expectedBalanceDate"
  | "pendingCount"
  | "pendingTotal"
>;

// Pairs each new account with the previous connection's by IBAN hash; an account without IBAN
// falls back to a name + currency that is unique on both sides (design §Consent lifecycle).
function matchPrevious(
  previous: BankConnectionAccount[],
  next: NewLink[],
): (BankConnectionAccount | null)[] {
  const byIban = new Map<string, BankConnectionAccount[]>();
  const byName = new Map<string, BankConnectionAccount[]>();
  const nameKey = (a: { name: string; currency: string }) => `${a.name}\u0000${a.currency}`;
  for (const p of previous) {
    const [map, key] = p.ibanHash ? [byIban, p.ibanHash] : [byName, nameKey(p)];
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  const nextNames = new Map<string, number>();
  for (const n of next) {
    if (!n.ibanHash) nextNames.set(nameKey(n), (nextNames.get(nameKey(n)) ?? 0) + 1);
  }
  return next.map((n) => {
    const candidates = n.ibanHash
      ? byIban.get(n.ibanHash)
      : nextNames.get(nameKey(n)) === 1
        ? byName.get(nameKey(n))
        : undefined;
    return candidates?.length === 1 ? candidates[0] : null;
  });
}

type Previous = { id: string; sessionIdEnc: string; accounts: BankConnectionAccount[] };

// What a reconnect keeps of each matched account. A target no longer mappable (archived, or
// mapped meanwhile by another active connection) is left for the mapping page.
async function carryOver(
  userId: string,
  previous: Previous,
  next: NewLink[],
): Promise<{ carried: (CarriedFields | null)[]; needsMapping: boolean }> {
  const matches = matchPrevious(previous.accounts, next);
  const targetIds = matches.flatMap((m) => (m?.accountId ? [m.accountId] : []));
  const [mappable, taken] = await Promise.all([
    db.bankAccount.findMany({
      where: { id: { in: targetIds }, ownerId: userId, archived: false },
      select: { id: true },
    }),
    db.bankConnectionAccount.findMany({
      where: {
        accountId: { in: targetIds },
        connectionId: { not: previous.id },
        connection: { status: "ACTIVE" },
      },
      select: { accountId: true },
    }),
  ]);
  const usable = new Set(mappable.map((a) => a.id));
  for (const t of taken) usable.delete(t.accountId!);
  const carried = matches.map((m) =>
    m && (m.accountId === null || usable.has(m.accountId))
      ? {
          accountId: m.accountId,
          syncFrom: m.syncFrom,
          lastSyncedDate: m.lastSyncedDate,
          bookedBalance: m.bookedBalance,
          bookedBalanceDate: m.bookedBalanceDate,
          expectedBalance: m.expectedBalance,
          expectedBalanceDate: m.expectedBalanceDate,
          pendingCount: m.pendingCount,
          pendingTotal: m.pendingTotal,
        }
      : null,
  );
  const mappedBefore = previous.accounts.filter((a) => a.accountId !== null).length;
  const mappedNow = carried.filter((c) => c?.accountId).length;
  return {
    carried,
    needsMapping: carried.some((c) => c === null) || mappedNow < mappedBefore,
  };
}

// A foreign user leaves the request for its owner; every other refusal consumes it (design §Security and privacy).
// A reconnect skips the mapping page when every account is carried over from the previous connection.
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
  let connection;
  let accounts: (NewLink & Partial<CarriedFields>)[];
  let previous: Previous | null = null;
  let needsMapping = true;
  try {
    const validUntil = new Date(session.access?.valid_until);
    if (Number.isNaN(validUntil.getTime())) throw new BankSyncError("HTTP");

    const links: NewLink[] = (session.accounts ?? []).flatMap((a, i) =>
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
    previous = request.reconnectOf
      ? await db.bankConnection.findFirst({
          where: {
            id: request.reconnectOf,
            userId,
            status: { not: "REVOKED" },
            aspspName: request.aspspName,
            aspspCountry: request.aspspCountry,
          },
          select: { id: true, sessionIdEnc: true, accounts: { orderBy: { id: "asc" } } },
        })
      : null;
    const carry = previous ? await carryOver(userId, previous, links) : null;
    const data = (create: NewLink[]) => ({
      userId,
      aspspName: request.aspspName,
      aspspCountry: request.aspspCountry,
      sessionIdEnc: encrypt(session.session_id, dataKey),
      validUntil,
      accounts: { create },
    });
    accounts = links;
    const replaced = previous;
    connection = replaced
      ? await db.$transaction(async (tx) => {
          // Revoked first: a disconnect or another reconnect that won the race keeps its mappings.
          const { count } = await tx.bankConnection.updateMany({
            where: { id: replaced.id, status: { not: "REVOKED" } },
            data: { status: "REVOKED" },
          });
          if (count === 1) {
            accounts = links.map((l, i) => ({ ...l, ...carry!.carried[i] }));
            needsMapping = carry!.needsMapping;
          } else {
            previous = null;
          }
          return tx.bankConnection.create({ data: data(accounts) });
        })
      : await db.bankConnection.create({ data: data(links) });
  } catch (e) {
    await deleteSessionQuietly(client, session.session_id);
    throw e;
  }
  await logEvent({
    userId,
    action: previous ? "bank_sync.connection.reconnected" : "bank_sync.connection.created",
    entity: "BankConnection",
    entityId: connection.id,
    metadata: {
      aspspName: request.aspspName,
      accounts: accounts.length,
      ...(previous && {
        previousId: previous.id,
        carried: accounts.filter((a) => a.accountId).length,
      }),
    },
  });
  if (previous) await deleteSessionQuietly(client, decrypt(previous.sessionIdEnc, dataKey));
  return { connectionId: connection.id, needsMapping };
}

// Synced rows stay; the session is deleted at Enable Banking best effort (design §Consent lifecycle).
export async function disconnectBank(
  userId: string,
  connectionId: string,
  opts: { client?: EnableBankingClient } = {},
): Promise<void> {
  const connection = await db.bankConnection.findFirst({
    where: { id: connectionId, userId, status: { not: "REVOKED" } },
    select: { aspspName: true, sessionIdEnc: true },
  });
  if (!connection) throw new BankSyncError("NOT_FOUND");
  const { count } = await db.bankConnection.updateMany({
    where: { id: connectionId, userId, status: { not: "REVOKED" } },
    data: { status: "REVOKED" },
  });
  if (count === 0) throw new BankSyncError("NOT_FOUND");
  await logEvent({
    userId,
    action: "bank_sync.connection.revoked",
    entity: "BankConnection",
    entityId: connectionId,
    metadata: { aspspName: connection.aspspName },
  });
  await revokeBankSessions([connection.sessionIdEnc], opts);
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
  aspspCountry: string;
  status: string;
  validUntil: Date;
  consent: ConsentState;
  mappedAccounts: string[];
};

// Time flags are computed here, not during render (react-hooks/purity).
export async function listBankConnections(
  userId: string,
  now: Date = new Date(),
): Promise<BankConnectionSummary[]> {
  const rows = await db.bankConnection.findMany({
    where: { userId, status: { not: "REVOKED" } },
    select: {
      id: true,
      aspspName: true,
      aspspCountry: true,
      status: true,
      validUntil: true,
      accounts: { select: { account: { select: { name: true } } }, orderBy: { name: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(({ accounts, ...c }) => ({
    ...c,
    consent: consentState(c.validUntil, now),
    mappedAccounts: accounts.flatMap((a) => (a.account ? [a.account.name] : [])),
  }));
}

// Read before a user deletion erases the connections; revoked once it committed.
export async function userBankSessions(
  userId: string,
  client: Pick<PrismaClient, "bankConnection"> = db,
): Promise<string[]> {
  const rows = await client.bankConnection.findMany({
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
  for (const enc of sessionIdsEnc) await deleteSessionQuietly(client, decrypt(enc, dataKey));
}

async function deleteSessionQuietly(client: EnableBankingClient, sessionId: string): Promise<void> {
  try {
    await client.deleteSession(sessionId);
  } catch (e) {
    console.error(
      "[bilan] bank session revoke failed",
      e instanceof EnableBankingError ? e.code : "UNKNOWN",
    );
  }
}

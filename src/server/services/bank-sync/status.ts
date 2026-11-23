import { db } from "@/server/db";
import type { EnableBankingClient, Psu } from "@/server/services/bank-sync/client";
import { availableClient } from "@/server/services/bank-sync/connect";
import { BankSyncError } from "@/server/services/bank-sync/errors";
import { syncConnection, type ConnectionSyncResult } from "@/server/services/bank-sync/sync";

// Client-safe: no uid, IBAN or session field (design §Security and privacy).
export type SyncedAccountInfo = {
  connectionId: string;
  aspspName: string;
  status: string;
  lastSyncAt: Date | null;
  lastError: string | null;
  pendingCount: number;
  pendingTotal: number;
};

// Keyed by Bilan account id; only the connection's owner sees it, not the account's group members.
export async function listSyncedAccounts(
  userId: string,
): Promise<Record<string, SyncedAccountInfo>> {
  const links = await db.bankConnectionAccount.findMany({
    where: { accountId: { not: null }, connection: { userId, status: { not: "REVOKED" } } },
    select: {
      accountId: true,
      pendingCount: true,
      pendingTotal: true,
      connection: {
        select: { id: true, aspspName: true, status: true, lastSyncAt: true, lastError: true },
      },
    },
    orderBy: { connection: { createdAt: "asc" } },
  });
  const out: Record<string, SyncedAccountInfo> = {};
  for (const { accountId, connection: c, ...link } of links) {
    // An account left on an expired connection and mapped again elsewhere shows the active one.
    if (out[accountId!]?.status === "ACTIVE") continue;
    out[accountId!] = {
      connectionId: c.id,
      aspspName: c.aspspName,
      status: c.status,
      lastSyncAt: c.lastSyncAt,
      lastError: c.lastError,
      pendingCount: link.pendingCount,
      pendingTotal: Number(link.pendingTotal),
    };
  }
  return out;
}

// User-present sync of one's own connection; also retries a connection in ERROR.
export async function syncNow(
  userId: string,
  connectionId: string,
  psu: Psu,
  opts: { client?: EnableBankingClient; now?: Date } = {},
): Promise<ConnectionSyncResult> {
  const owned = await db.bankConnection.count({
    where: { id: connectionId, userId, status: { not: "REVOKED" } },
  });
  if (owned === 0) throw new BankSyncError("NOT_FOUND");
  const client = await availableClient(opts.client);
  return syncConnection(connectionId, { psu, client, now: opts.now, allowError: true });
}

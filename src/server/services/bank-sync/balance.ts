import { db } from "@/server/db";
import { accountBalances } from "@/server/services/accounts";
import { dayEnd, toIsoDay } from "@/lib/period";

// Client-safe; gap = bank − Bilan, both booked-only at `bookedDate` (design §Bank balance check).
export type BankBalanceCheck = {
  bookedBalance: number;
  bookedDate: string;
  bilanBalance: number;
  gap: number;
  expectedBalance: number | null;
  expectedDate: string | null;
};

const cents = (n: number) => Math.round(n * 100);

// Keyed by Bilan account id; only for accounts the user owns, through their own connection.
export async function listBankBalanceChecks(
  userId: string,
): Promise<Record<string, BankBalanceCheck>> {
  const links = await db.bankConnectionAccount.findMany({
    where: {
      accountId: { not: null },
      bookedBalance: { not: null },
      bookedBalanceDate: { not: null },
      connection: { userId, status: { not: "REVOKED" } },
      account: { ownerId: userId },
    },
    select: {
      bookedBalance: true,
      bookedBalanceDate: true,
      expectedBalance: true,
      expectedBalanceDate: true,
      connection: { select: { status: true } },
      account: { select: { id: true, initialBalance: true } },
    },
    orderBy: { connection: { createdAt: "asc" } },
  });

  // Same pick as listSyncedAccounts: an account mapped on an active connection shows that one.
  const picked = new Map<string, (typeof links)[number]>();
  for (const link of links) {
    const id = link.account!.id;
    if (picked.get(id)?.connection.status === "ACTIVE") continue;
    picked.set(id, link);
  }

  const byDay = new Map<string, { id: string; initialBalance: unknown }[]>();
  for (const link of picked.values()) {
    const day = toIsoDay(link.bookedBalanceDate!);
    byDay.set(day, [...(byDay.get(day) ?? []), link.account!]);
  }
  const bilan = new Map<string, number>();
  await Promise.all(
    [...byDay].map(async ([day, accounts]) => {
      const balances = await accountBalances(accounts, { asOf: dayEnd(day) });
      for (const [id, balance] of balances) bilan.set(id, balance);
    }),
  );

  const out: Record<string, BankBalanceCheck> = {};
  for (const [id, link] of picked) {
    const bookedBalance = Number(link.bookedBalance);
    const bilanBalance = bilan.get(id)!;
    out[id] = {
      bookedBalance,
      bookedDate: toIsoDay(link.bookedBalanceDate!),
      bilanBalance,
      gap: (cents(bookedBalance) - cents(bilanBalance)) / 100,
      expectedBalance: link.expectedBalance === null ? null : Number(link.expectedBalance),
      expectedDate: link.expectedBalanceDate ? toIsoDay(link.expectedBalanceDate) : null,
    };
  }
  return out;
}

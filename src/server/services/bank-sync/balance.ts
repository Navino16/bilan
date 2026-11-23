import { db } from "@/server/db";
import { accountBalances } from "@/server/services/accounts";
import { dayEnd, toIsoDay } from "@/lib/period";

// Client-safe; gap = bank − Bilan, both booked-only at `date` (design §Bank balance check).
export type BankBalanceCheck = {
  bankBalance: number;
  date: string;
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
      pendingTotal: true,
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

  // The bank can book a pending row with a booking date its CLBD was computed before (LCL), so
  // XPCD minus the pending rows of the same sync is the safer booked reference when given.
  const reference = new Map<string, { amount: number; day: string }>();
  for (const [id, link] of picked) {
    reference.set(
      id,
      link.expectedBalance !== null && link.expectedBalanceDate
        ? {
            amount: (cents(Number(link.expectedBalance)) - cents(Number(link.pendingTotal))) / 100,
            day: toIsoDay(link.expectedBalanceDate),
          }
        : { amount: Number(link.bookedBalance), day: toIsoDay(link.bookedBalanceDate!) },
    );
  }

  const byDay = new Map<string, { id: string; initialBalance: unknown }[]>();
  for (const [id, link] of picked) {
    const { day } = reference.get(id)!;
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
    const { amount: bankBalance, day } = reference.get(id)!;
    const bilanBalance = bilan.get(id)!;
    out[id] = {
      bankBalance,
      date: day,
      bilanBalance,
      gap: (cents(bankBalance) - cents(bilanBalance)) / 100,
      expectedBalance: link.expectedBalance === null ? null : Number(link.expectedBalance),
      expectedDate: link.expectedBalanceDate ? toIsoDay(link.expectedBalanceDate) : null,
    };
  }
  return out;
}

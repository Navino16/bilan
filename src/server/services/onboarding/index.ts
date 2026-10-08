import { cache } from "react";
import { db } from "@/server/db";
import { visibleAccountRefs } from "@/server/services/accounts";
import { addTransactionBlocker, type AddTransactionBlocker } from "@/lib/onboarding";

export type OnboardingState = {
  hasTransaction: boolean;
  addBlocker: AddTransactionBlocker | null;
};

// Memoized per server render.
export const getOnboardingState = cache(async (userId: string): Promise<OnboardingState> => {
  const refs = await visibleAccountRefs(userId);
  if (refs.length === 0) return { hasTransaction: false, addBlocker: "NO_ACCOUNT" };

  const [writable, tx] = await Promise.all([
    // An active account wins over an archived one (false sorts first).
    db.bankAccount.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          {
            shares: {
              some: { permission: "WRITE", group: { members: { some: { userId } } } },
            },
          },
        ],
      },
      select: { archived: true },
      orderBy: { archived: "asc" },
    }),
    db.transaction.findFirst({
      where: { accountId: { in: refs.map((a) => a.id) } },
      select: { id: true },
    }),
  ]);

  return { hasTransaction: tx !== null, addBlocker: addTransactionBlocker(true, writable) };
});

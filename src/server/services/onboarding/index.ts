import { cache } from "react";
import { db } from "@/server/db";
import { visibleAccountRefs } from "@/server/services/accounts";
import { writableAccountIds } from "@/server/services/accounts/sharing";
import { currentMcpPrincipal } from "@/server/mcp/context";
import { addTransactionBlocker, type AddTransactionBlocker } from "@/lib/onboarding";

export type OnboardingState = {
  hasTransaction: boolean;
  addBlocker: AddTransactionBlocker | null;
};

// Memoized per server render, keyed by the MCP context too (see visibleAccountRefs).
const onboardingState = cache(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- memo key only
  async (userId: string, inMcp: boolean): Promise<OnboardingState> => {
    const refs = await visibleAccountRefs(userId);
    if (refs.length === 0) return { hasTransaction: false, addBlocker: "NO_ACCOUNT" };

    const [writable, tx] = await Promise.all([
      writableAccountIds(userId).then((ids) =>
        // An active account wins over an archived one (false sorts first).
        db.bankAccount.findFirst({
          where: { id: { in: ids } },
          select: { archived: true },
          orderBy: { archived: "asc" },
        }),
      ),
      db.transaction.findFirst({
        where: { accountId: { in: refs.map((a) => a.id) } },
        select: { id: true },
      }),
    ]);

    return { hasTransaction: tx !== null, addBlocker: addTransactionBlocker(true, writable) };
  },
);

export function getOnboardingState(userId: string): Promise<OnboardingState> {
  return onboardingState(userId, currentMcpPrincipal() !== null);
}

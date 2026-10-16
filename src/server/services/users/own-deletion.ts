import { db } from "@/server/db";
import { userDeletionImpact, type UserDeletionImpact } from "@/server/services/users/lifecycle";

export type OwnDeletionImpact = UserDeletionImpact & { transactions: number };

// Shown in the self-deletion confirmation: the admin preview plus the transactions
// that go with the user's accounts.
export async function ownDeletionImpact(userId: string): Promise<OwnDeletionImpact | null> {
  const [impact, transactions] = await Promise.all([
    userDeletionImpact(userId),
    db.transaction.count({ where: { account: { ownerId: userId } } }),
  ]);
  return impact && { ...impact, transactions };
}

import type { Prisma } from "@prisma/client";

// What stops reaching a household also stops counting in its budgets (#259): its INCLUDE and
// EXCLUDE assignments on the accounts' transactions go with the shares.
export async function unshareFromGroup(
  tx: Prisma.TransactionClient,
  groupId: string,
  account: Prisma.BankAccountWhereInput,
): Promise<number> {
  return (await tx.accountShare.deleteMany({ where: { groupId, account } })).count;
}

export async function dropGroupAssignments(
  tx: Prisma.TransactionClient,
  groupId: string,
  account: Prisma.BankAccountWhereInput,
): Promise<number> {
  return (
    await tx.budgetAssignment.deleteMany({
      where: { budget: { groupId }, transaction: { account } },
    })
  ).count;
}

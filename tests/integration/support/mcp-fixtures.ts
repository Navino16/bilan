import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import type { McpPrincipal } from "@/server/mcp/context";

export type McpFixture = {
  ownerId: string; // A: owns both shared accounts
  memberId: string; // B: member of the household, owns `own`
  groupId: string;
  categoryId: string; // household category the expenses use
  accounts: { sharedAi: string; sharedPlain: string; own: string };
  expenses: { sharedAi: string; sharedPlain: string; own: string };
};

// Amounts of each account's expense, dated the 10th of `now`'s month.
export const MCP_FIXTURE_AMOUNTS = { sharedAi: -10, sharedPlain: -40, own: -100 } as const;

const userIds = (prefix: string) => [`${prefix}_owner`, `${prefix}_member`];

export function mcpPrincipal(userId: string): McpPrincipal {
  return {
    userId,
    scopes: ["bilan:read"],
    client: { kind: "token", id: `tok_${userId}`, name: "Test client" },
  };
}

export async function expense(
  accountId: string,
  date: Date,
  amount: number,
  categoryId: string | null,
): Promise<string> {
  const { tokens, ...fields } = buildSecureFields({ label: "Shop", rawLabel: "SHOP" });
  void tokens;
  const row = await db.transaction.create({
    data: { accountId, date, periodDate: date, amount, type: "CARD", categoryId, ...fields },
  });
  return row.id;
}

// Owner A and member B in household G; A shares `shared-ai` (READ, AI allowed) and
// `shared-plain` (WRITE, AI not allowed) with G; B owns `own`.
export async function createMcpFixture(prefix: string, now: Date): Promise<McpFixture> {
  await cleanupMcpFixture(prefix);
  const [ownerId, memberId] = userIds(prefix);
  await db.user.createMany({
    data: [
      { id: ownerId, email: `${ownerId}@bilan.local`, name: "Owner A" },
      { id: memberId, email: `${memberId}@bilan.local`, name: "Member B" },
    ],
  });
  const groupId = (await db.group.create({ data: { name: `${prefix} G`, createdById: ownerId } }))
    .id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: ownerId, role: "OWNER" },
      { groupId, userId: memberId, role: "MEMBER" },
    ],
  });
  const account = async (ownerId: string, name: string) =>
    (await db.bankAccount.create({ data: { ownerId, name, type: "CHECKING" } })).id;
  const accounts = {
    sharedAi: await account(ownerId, "shared-ai"),
    sharedPlain: await account(ownerId, "shared-plain"),
    own: await account(memberId, "own"),
  };
  await db.accountShare.createMany({
    data: [
      {
        accountId: accounts.sharedAi,
        groupId,
        permission: "READ",
        allowAiAssistants: true,
        createdById: ownerId,
      },
      {
        accountId: accounts.sharedPlain,
        groupId,
        permission: "WRITE",
        allowAiAssistants: false,
        createdById: ownerId,
      },
    ],
  });
  const categoryId = (await db.category.create({ data: { groupId, name: "Groceries" } })).id;
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 12));
  const expenses = {
    sharedAi: await expense(accounts.sharedAi, day, MCP_FIXTURE_AMOUNTS.sharedAi, categoryId),
    sharedPlain: await expense(
      accounts.sharedPlain,
      day,
      MCP_FIXTURE_AMOUNTS.sharedPlain,
      categoryId,
    ),
    own: await expense(accounts.own, day, MCP_FIXTURE_AMOUNTS.own, categoryId),
  };
  return { ownerId, memberId, groupId, categoryId, accounts, expenses };
}

export async function cleanupMcpFixture(prefix: string): Promise<void> {
  const ids = userIds(prefix);
  const gids = (
    await db.group.findMany({ where: { createdById: { in: ids } }, select: { id: true } })
  ).map((g) => g.id);
  await db.budget.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { groupId: { in: gids } }] },
  });
  await db.transactionLink.deleteMany({ where: { createdById: { in: ids } } });
  await db.transaction.deleteMany({ where: { account: { ownerId: { in: ids } } } });
  await db.accountShare.deleteMany({ where: { groupId: { in: gids } } });
  await db.category.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { groupId: { in: gids } }] },
  });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.groupMember.deleteMany({ where: { groupId: { in: gids } } });
  await db.group.deleteMany({ where: { id: { in: gids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

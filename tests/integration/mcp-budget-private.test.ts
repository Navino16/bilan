import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import type { BudgetInput } from "@/lib/schemas/budget";
import { createBudget, getBudgetDetail } from "@/server/services/budgets";
import { runAsMcp } from "@/server/mcp/context";
import {
  cleanupMcpFixture,
  createMcpFixture,
  expense,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcppriv";
const now = new Date("2026-06-15T12:00:00.000Z");
const june = { periodType: "MONTH", periodStart: "2026-06-01", periodEnd: "2026-06-30" } as const;
let f: McpFixture;
let budgetId = "";
const tx = {} as Record<"big" | "refund" | "small" | "hiddenPrimary", string>;

const inMcp = <T>(userId: string, fn: () => Promise<T>) => runAsMcp(mcpPrincipal(userId), fn);
const at = (day: number) => new Date(Date.UTC(2026, 5, day, 12));

async function link(ids: string[]): Promise<void> {
  await db.transactionLink.create({
    data: {
      createdById: f.ownerId,
      members: { create: ids.map((transactionId) => ({ transactionId })) },
    },
  });
}

async function balanceOf(accountId: string): Promise<number> {
  const [account, sum] = await Promise.all([
    db.bankAccount.findUniqueOrThrow({ where: { id: accountId } }),
    db.transaction.aggregate({ where: { accountId }, _sum: { amount: true } }),
  ]);
  return Number(account.initialBalance) + Number(sum._sum.amount ?? 0);
}

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
  budgetId = (
    await createBudget(
      {
        name: "Household June",
        groupId: f.groupId,
        ...june,
        lines: [{ categoryId: f.categoryId, plannedAmount: 500 }],
      },
      { id: f.ownerId },
    )
  ).id;
  // A visible −50 refunded +20 on shared-plain, and a visible +5 netting a hidden −30 primary.
  tx.big = await expense(f.accounts.sharedAi, at(11), -50, f.categoryId);
  tx.refund = await expense(f.accounts.sharedPlain, at(12), 20, f.categoryId);
  tx.small = await expense(f.accounts.sharedAi, at(13), 5, f.categoryId);
  tx.hiddenPrimary = await expense(f.accounts.sharedPlain, at(14), -30, f.categoryId);
  await link([tx.big, tx.refund]);
  await link([tx.small, tx.hiddenPrimary]);
});

afterAll(async () => {
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

describe("MCP household budget details", () => {
  it("splits a linked row between its visible legs and the private total", async () => {
    const app = await getBudgetDetail(budgetId, f.memberId, { now });
    // 10 + 40 + (50 − 20) + (30 − 5)
    expect(app.lines[0].spent).toBe(105);
    const d = await inMcp(f.memberId, () => getBudgetDetail(budgetId, f.memberId, { now }));
    expect(d.spentTotal).toBe(app.spentTotal);
    const listed = new Map(d.transactions.map((t) => [t.id, t.amount]));
    expect(listed).toEqual(
      new Map([
        [f.expenses.sharedAi, -10],
        [tx.big, -50],
        [tx.small, 5],
      ]),
    );
    expect(d.privateAccountTotals).toEqual([
      {
        private: true,
        label: "Private account",
        lineId: d.lines[0].id,
        outside: null,
        amount: -50,
        count: 3,
      },
    ]);
    const json = JSON.stringify(d);
    for (const needle of [
      tx.refund,
      tx.hiddenPrimary,
      f.expenses.sharedPlain,
      f.accounts.sharedPlain,
      "shared-plain",
      "2026-06-12",
      "2026-06-14",
    ])
      expect(json).not.toContain(needle);
  });

  it("lists a visible leg whose account has no counted row of its own", async () => {
    const categoryId = (
      await db.category.create({ data: { groupId: f.groupId, name: "Pharmacy" } })
    ).id;
    const id = (
      await createBudget(
        {
          name: "Pharmacy June",
          groupId: f.groupId,
          ...june,
          lines: [{ categoryId, plannedAmount: 50 }],
        },
        { id: f.ownerId },
      )
    ).id;
    const visibleLeg = await expense(f.accounts.sharedAi, at(3), 5, categoryId);
    const hiddenLeg = await expense(f.accounts.sharedPlain, at(4), -30, categoryId);
    await link([visibleLeg, hiddenLeg]);

    const d = await inMcp(f.memberId, () => getBudgetDetail(id, f.memberId, { now }));
    expect(d.lines[0].spent).toBe(25);
    expect(d.transactions.map((t) => [t.id, t.amount])).toEqual([[visibleLeg, 5]]);
    expect(d.privateAccountTotals).toMatchObject([
      { lineId: d.lines[0].id, amount: -30, count: 1 },
    ]);
    expect(JSON.stringify(d)).not.toContain(hiddenLeg);
  });

  it("keeps the forecast on the accounts the assistant can see", async () => {
    await db.bankAccount.update({
      where: { id: f.accounts.sharedPlain },
      data: { initialBalance: 5000 },
    });
    await db.bankAccount.update({
      where: { id: f.accounts.sharedAi },
      data: { initialBalance: 1000 },
    });
    const [ai, plain] = await Promise.all([
      balanceOf(f.accounts.sharedAi),
      balanceOf(f.accounts.sharedPlain),
    ]);
    const app = await getBudgetDetail(budgetId, f.memberId, { now, withTransactions: false });
    const d = await inMcp(f.memberId, () =>
      getBudgetDetail(budgetId, f.memberId, { now, withTransactions: false }),
    );
    expect(app.forecast!.balance).toBe(Math.round((ai + plain) * 100) / 100);
    expect(d.forecast!.balance).toBe(Math.round(ai * 100) / 100);
  });

  it("gives no landing for a budget attached to a hidden account", async () => {
    const attached = await createBudget(
      {
        name: "Plain attached",
        groupId: f.groupId,
        accountId: f.accounts.sharedPlain,
        ...june,
        lines: [{ categoryId: f.categoryId, plannedAmount: 100 }],
      },
      { id: f.ownerId },
    );
    const app = await getBudgetDetail(attached.id, f.memberId, { now, withTransactions: false });
    const d = await inMcp(f.memberId, () =>
      getBudgetDetail(attached.id, f.memberId, { now, withTransactions: false }),
    );
    expect(app.landing).not.toBeNull();
    expect(d.landing).toBeNull();
    expect(d.spentTotal).toBe(app.spentTotal);
  });

  it("keeps the line and attach guards on the assistant's accounts", async () => {
    await db.groupMember.updateMany({
      where: { groupId: f.groupId, userId: f.memberId },
      data: { role: "ADMIN" },
    });
    const july = {
      periodType: "MONTH",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    } as const;
    const withLine: BudgetInput = {
      name: "Plain line",
      groupId: f.groupId,
      ...july,
      lines: [{ accountId: f.accounts.sharedPlain, plannedAmount: 10 }],
    };
    const attach: BudgetInput = {
      name: "Plain attach",
      groupId: f.groupId,
      accountId: f.accounts.sharedPlain,
      ...july,
      lines: [{ categoryId: f.categoryId, plannedAmount: 10 }],
    };
    try {
      await expect(
        inMcp(f.memberId, () => createBudget(withLine, { id: f.memberId })),
      ).rejects.toThrow("INVALID_LINE");
      await expect(
        inMcp(f.memberId, () => createBudget(attach, { id: f.memberId })),
      ).rejects.toThrow("INVALID_ACCOUNT");
      const created = await Promise.all([
        createBudget(withLine, { id: f.memberId }),
        createBudget(attach, { id: f.memberId }),
      ]);
      expect(created).toHaveLength(2);
    } finally {
      await db.groupMember.updateMany({
        where: { groupId: f.groupId, userId: f.memberId },
        data: { role: "MEMBER" },
      });
    }
  });

  // X is shared with G without the AI flag but with H with it: B's assistant sees it anyway.
  it("counts an account AI-allowed through another household as visible", async () => {
    const h = (await db.group.create({ data: { name: `${PREFIX} H`, createdById: f.ownerId } })).id;
    await db.groupMember.createMany({
      data: [
        { groupId: h, userId: f.ownerId, role: "OWNER" },
        { groupId: h, userId: f.memberId, role: "MEMBER" },
      ],
    });
    const x = (
      await db.bankAccount.create({
        data: { ownerId: f.ownerId, name: "x-account", type: "CHECKING", initialBalance: 300 },
      })
    ).id;
    await db.accountShare.createMany({
      data: [
        {
          accountId: x,
          groupId: f.groupId,
          permission: "READ",
          allowAiAssistants: false,
          createdById: f.ownerId,
        },
        {
          accountId: x,
          groupId: h,
          permission: "READ",
          allowAiAssistants: true,
          createdById: f.ownerId,
        },
      ],
    });
    const xRow = await expense(x, at(9), -7, f.categoryId);
    const [ai, xBalance] = await Promise.all([balanceOf(f.accounts.sharedAi), balanceOf(x)]);

    const d = await inMcp(f.memberId, () => getBudgetDetail(budgetId, f.memberId, { now }));
    expect(d.transactions.map((t) => t.id)).toContain(xRow);
    expect(d.forecast!.balance).toBe(Math.round((ai + xBalance) * 100) / 100);

    await db.groupMember.updateMany({
      where: { groupId: f.groupId, userId: f.memberId },
      data: { role: "ADMIN" },
    });
    try {
      const created = await inMcp(f.memberId, () =>
        createBudget(
          {
            name: "X line",
            groupId: f.groupId,
            periodType: "MONTH",
            periodStart: "2026-08-01",
            periodEnd: "2026-08-31",
            lines: [{ accountId: x, plannedAmount: 10 }],
          },
          { id: f.memberId },
        ),
      );
      expect(created.id).toBeTruthy();
    } finally {
      await db.groupMember.updateMany({
        where: { groupId: f.groupId, userId: f.memberId },
        data: { role: "MEMBER" },
      });
    }
  });
});

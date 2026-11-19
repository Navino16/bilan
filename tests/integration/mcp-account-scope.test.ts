import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { listVisibleForUser, visibleAccountIds } from "@/server/services/accounts";
import {
  canReadAccount,
  getEffectiveAccess,
  listAccountsSharedWithGroup,
  writableAccountIds,
} from "@/server/services/accounts/sharing";
import {
  assignTransaction,
  createBudget,
  getBudgetDetail,
  listBudgetSeriesHistory,
} from "@/server/services/budgets";
import { getDashboard } from "@/server/services/dashboard";
import { getInsights } from "@/server/services/dashboard/insights";
import { listTransactions } from "@/server/services/transactions";
import { runAsMcp } from "@/server/mcp/context";
import { comparisonFor, monthPeriod } from "@/lib/period";
import {
  cleanupMcpFixture,
  createMcpFixture,
  expense,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpscope";
const now = new Date("2026-06-15T12:00:00.000Z");
const period = monthPeriod(2026, 6);
const comparison = comparisonFor(period, "prev", now);
let f: McpFixture;
let budgetId = "";

// Runs `fn` outside, then inside an MCP call made by member B.
async function both<T>(fn: () => Promise<T>): Promise<{ outside: T; inside: T }> {
  const outside = await fn();
  const inside = await runAsMcp(mcpPrincipal(f.memberId), fn);
  return { outside, inside };
}

const sorted = (ids: string[]) => [...ids].sort();

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
  budgetId = (
    await createBudget(
      {
        name: "Household June",
        groupId: f.groupId,
        periodType: "MONTH",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        lines: [{ categoryId: f.categoryId, plannedAmount: 500 }],
      },
      { id: f.ownerId },
    )
  ).id;
  // An out-of-period shared-plain expense pulled into the household budget by an INCLUDE.
  const may = await expense(
    f.accounts.sharedPlain,
    new Date("2026-05-20T12:00:00.000Z"),
    -7,
    f.categoryId,
  );
  await assignTransaction({ budgetId, transactionId: may, mode: "INCLUDE" }, { id: f.ownerId });
});

afterAll(async () => {
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

describe("MCP account narrowing", () => {
  it("visibleAccountIds keeps owned and AI-allowed shared accounts only", async () => {
    const { outside, inside } = await both(() => visibleAccountIds(f.memberId));
    expect(sorted(outside)).toEqual(sorted(Object.values(f.accounts)));
    expect(sorted(inside)).toEqual(sorted([f.accounts.own, f.accounts.sharedAi]));
  });

  it("listVisibleForUser follows the same split", async () => {
    const { outside, inside } = await both(async () =>
      (await listVisibleForUser(f.memberId, { includeArchived: true })).map((a) => a.id),
    );
    expect(sorted(outside)).toEqual(sorted(Object.values(f.accounts)));
    expect(sorted(inside)).toEqual(sorted([f.accounts.own, f.accounts.sharedAi]));
  });

  it("denies access to a share without the AI flag", async () => {
    const plain = await both(async () => ({
      access: await getEffectiveAccess(f.memberId, f.accounts.sharedPlain),
      read: await canReadAccount(f.memberId, f.accounts.sharedPlain),
    }));
    expect(plain.outside).toEqual({ access: "WRITE", read: true });
    expect(plain.inside).toEqual({ access: null, read: false });

    const ai = await both(() => getEffectiveAccess(f.memberId, f.accounts.sharedAi));
    expect(ai).toEqual({ outside: "READ", inside: "READ" });
  });

  it("drops the WRITE share without the AI flag from the writable accounts", async () => {
    const { outside, inside } = await both(() => writableAccountIds(f.memberId));
    expect(sorted(outside)).toEqual(sorted([f.accounts.own, f.accounts.sharedPlain]));
    expect(inside).toEqual([f.accounts.own]);
  });

  it("lists only AI-allowed accounts among the household's shared accounts", async () => {
    const { outside, inside } = await both(async () =>
      (await listAccountsSharedWithGroup(f.groupId, { id: f.memberId })).map((a) => a.id),
    );
    expect(sorted(outside)).toEqual(sorted([f.accounts.sharedAi, f.accounts.sharedPlain]));
    expect(inside).toEqual([f.accounts.sharedAi]);
  });

  it("leaves the shared-plain expense out of the dashboard totals", async () => {
    const { outside, inside } = await both(() => getDashboard(f.memberId, period, comparison, now));
    expect(outside.totals.expense).toBe(150);
    expect(inside.totals.expense).toBe(110);
  });

  it("leaves the shared-plain expense out of the insights overview", async () => {
    const { outside, inside } = await both(() => getInsights(f.memberId, period, comparison, now));
    expect(outside.overview.net).toBe(-157);
    expect(inside.overview.net).toBe(-110);
  });

  it("gives a household budget the app's spent, shared-plain INCLUDEs too", async () => {
    const { outside, inside } = await both(() => getBudgetDetail(budgetId, f.memberId, { now }));
    expect(outside.spentTotal).toBe(57);
    expect(inside.spentTotal).toBe(57);
  });

  it("leaves shared-plain rows out of a personal budget's spent", async () => {
    const personal = await createBudget(
      {
        name: "Personal June",
        periodType: "MONTH",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        lines: [{ categoryId: f.categoryId, plannedAmount: 500 }],
      },
      { id: f.memberId },
    );
    const { outside, inside } = await both(() => getBudgetDetail(personal.id, f.memberId, { now }));
    expect(outside.spentTotal).toBe(150);
    expect(inside.spentTotal).toBe(110);
    await db.budget.delete({ where: { id: personal.id } });
  });

  it("leaves shared-plain rows out of the transaction list", async () => {
    const { outside, inside } = await both(async () =>
      (await listTransactions(f.memberId, {})).items.map((t) => t.accountId),
    );
    expect(outside).toContain(f.accounts.sharedPlain);
    expect(inside).not.toContain(f.accounts.sharedPlain);
    expect(sorted([...new Set(inside)])).toEqual(sorted([f.accounts.own, f.accounts.sharedAi]));
  });

  it("does not match a pending transfer leg on shared-plain", async () => {
    const june = { periodType: "MONTH", periodStart: period.from, periodEnd: period.to };
    // A household budget on shared-plain sends 25 to `own`: B's budget on `own` mirrors it.
    await db.budget.create({
      data: {
        ...june,
        name: "Plain household",
        groupId: f.groupId,
        accountId: f.accounts.sharedPlain,
        createdById: f.ownerId,
        lines: {
          create: [
            {
              kind: "TRANSFER",
              direction: "OUT",
              counterpartAccountId: f.accounts.own,
              plannedAmount: 25,
            },
          ],
        },
      },
    });
    const ownBudget = await db.budget.create({
      data: {
        ...june,
        name: "Own account",
        userId: f.memberId,
        accountId: f.accounts.own,
        createdById: f.memberId,
        lines: { create: [{ categoryId: f.categoryId, plannedAmount: 200 }] },
      },
    });
    const day = new Date("2026-06-12T12:00:00.000Z");
    await expense(f.accounts.sharedPlain, day, -25, null);
    await expense(f.accounts.own, day, 25, null);

    const { outside, inside } = await both(async () => {
      const d = await getBudgetDetail(ownBudget.id, f.memberId, { now });
      return d.lines.find((l) => l.mirrorOf)?.spent;
    });
    expect(outside).toBe(25);
    expect(inside).toBe(0);
  });

  it("never filters the caller's own accounts in a household budget", async () => {
    await db.accountShare.create({
      data: {
        accountId: f.accounts.own,
        groupId: f.groupId,
        permission: "READ",
        allowAiAssistants: false,
        createdById: f.memberId,
      },
    });
    try {
      const { outside, inside } = await both(() => getBudgetDetail(budgetId, f.memberId, { now }));
      expect(outside.spentTotal).toBe(157);
      expect(inside.spentTotal).toBe(157);
    } finally {
      await db.accountShare.deleteMany({ where: { accountId: f.accounts.own } });
    }
  });

  it("gives a household series the app's figures over time", async () => {
    const month = (m: number) => ({
      name: "Household series",
      groupId: f.groupId,
      periodType: "MONTH",
      periodStart: new Date(Date.UTC(2026, m - 1, 1)),
      periodEnd: new Date(Date.UTC(2026, m, 0)),
      recurring: true,
      createdById: f.ownerId,
      lines: { create: [{ categoryId: f.categoryId, plannedAmount: 100 }] },
    });
    const april = await db.budget.create({ data: month(4) });
    await db.budget.create({ data: { ...month(5), parentBudgetId: april.id } });
    await expense(f.accounts.sharedPlain, new Date("2026-04-10T12:00:00.000Z"), -20, f.categoryId);

    const { outside, inside } = await both(async () =>
      (await listBudgetSeriesHistory(f.memberId, now))
        .find((s) => s.name === "Household series")!
        .periods.map((p) => p.spent),
    );
    expect(outside).toEqual([20, 7]);
    expect(inside).toEqual(outside);
  });
});

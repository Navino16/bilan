import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { encrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createBudget } from "@/server/services/budgets";
import { buildMcpServer } from "@/server/mcp/server";
import { UNTRUSTED_NOTE } from "@/server/mcp/tools/read";
import type { McpPrincipal } from "@/server/mcp/context";
import { addMonths, monthPeriod, toIsoDay } from "@/lib/period";
import {
  cleanupMcpFixture,
  createMcpFixture,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpread";
const BULK_PREFIX = "mcpreadbulk";
const IBAN = "FR7630006000011234567890189";
const RAW_LABEL = "ZZRAWSECRET CB BAKERY 4242";
const now = new Date();
const thisMonth = monthPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
const day = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), n, 12));
const prev = addMonths(now.getUTCFullYear(), now.getUTCMonth() + 1, -1);
const lastMonthDay = new Date(Date.UTC(prev.year, prev.month - 1, 5, 12));
const round2 = (n: number) => Math.round(n * 100) / 100;

const ALL_TOOLS = [
  "list_accounts",
  "get_dashboard",
  "get_insights",
  "search_transactions",
  "get_transaction",
  "list_categories",
  "list_rules",
  "list_budgets",
  "get_budget",
  "list_merchants",
  "list_households",
  "list_link_suggestions",
  "get_preferences",
];

let f: McpFixture;
let budgetId = "";
const tx = {} as Record<
  | "bakery"
  | "pairAPos"
  | "pairANeg"
  | "pairBPos"
  | "pairBNeg"
  | "l1Own"
  | "l1Ai"
  | "l2Own"
  | "l2Plain",
  string
>;

async function row(
  accountId: string,
  date: Date,
  amount: number,
  opts: { label?: string; rawLabel?: string; type?: string; categoryId?: string | null } = {},
): Promise<string> {
  const label = opts.label ?? "Transfer";
  const { tokens, ...fields } = buildSecureFields({ label, rawLabel: opts.rawLabel ?? label });
  const created = await db.transaction.create({
    data: {
      accountId,
      date,
      periodDate: date,
      amount,
      type: opts.type ?? "TRANSFER",
      categoryId: opts.categoryId ?? null,
      ...fields,
      searchTokens: { create: tokens.map((tokenHash) => ({ tokenHash })) },
    },
  });
  return created.id;
}

async function link(createdById: string, ids: string[]): Promise<void> {
  await db.transactionLink.create({
    data: { createdById, members: { create: ids.map((transactionId) => ({ transactionId })) } },
  });
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type Connected = { client: Client; close: () => Promise<void> };

async function connect(principal: McpPrincipal): Promise<Connected> {
  const server = buildMcpServer(principal);
  const client = new Client({ name: "bilan-test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const textOf = (r: ToolResult) => (r.content as { type: string; text: string }[])[0].text;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (r: ToolResult): any => {
  expect(r.isError, textOf(r)).toBeFalsy();
  expect(JSON.parse(textOf(r))).toEqual(r.structuredContent);
  return r.structuredContent;
};

let member: Connected;
const call = (name: string, args: Record<string, unknown> = {}) =>
  member.client.callTool({ name, arguments: args });

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
  await db.bankAccount.updateMany({
    where: { id: { in: [f.accounts.own, f.accounts.sharedAi, f.accounts.sharedPlain] } },
    data: { ibanEnc: encrypt(IBAN, dataKey) },
  });
  tx.bakery = await row(f.accounts.own, day(now, 10), -5, {
    label: "Bakery",
    rawLabel: RAW_LABEL,
    type: "CARD",
  });
  // A: own ↔ shared-ai, suggested. B: shared-plain ↔ own, must stay hidden.
  tx.pairAPos = await row(f.accounts.own, lastMonthDay, 77.77);
  tx.pairANeg = await row(f.accounts.sharedAi, lastMonthDay, -77.77);
  tx.pairBPos = await row(f.accounts.sharedPlain, lastMonthDay, 33.33);
  tx.pairBNeg = await row(f.accounts.own, lastMonthDay, -33.33);
  tx.l1Own = await row(f.accounts.own, lastMonthDay, 12);
  tx.l1Ai = await row(f.accounts.sharedAi, lastMonthDay, -12);
  tx.l2Own = await row(f.accounts.own, lastMonthDay, -21);
  tx.l2Plain = await row(f.accounts.sharedPlain, lastMonthDay, 21);
  await link(f.memberId, [tx.l1Own, tx.l1Ai]);
  await link(f.memberId, [tx.l2Own, tx.l2Plain]);

  budgetId = (
    await createBudget(
      {
        name: "Household month",
        groupId: f.groupId,
        periodType: "MONTH",
        periodStart: toIsoDay(thisMonth.from),
        periodEnd: toIsoDay(thisMonth.to),
        lines: [{ categoryId: f.categoryId, plannedAmount: 500 }],
      },
      { id: f.ownerId },
    )
  ).id;
  await db.budgetAssignment.create({
    data: { budgetId, transactionId: tx.bakery, mode: "INCLUDE", assignedById: f.ownerId },
  });
  await db.categorizationRule.create({
    data: { pattern: "shop", matchType: "CONTAINS", categoryId: f.categoryId, groupId: f.groupId },
  });

  member = await connect(mcpPrincipal(f.memberId));
});

afterAll(async () => {
  await member?.close();
  await cleanupMcpFixture(PREFIX);
  await cleanupMcpFixture(BULK_PREFIX);
  await db.$disconnect();
});

describe("MCP read tools", () => {
  it("lists the 13 read tools, read-only, each description ending with the untrusted note", async () => {
    const { tools } = await member.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALL_TOOLS].sort());
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.description?.endsWith(UNTRUSTED_NOTE), t.name).toBe(true);
      expect(t.inputSchema.type).toBe("object");
    }
  });

  it("serves the read tools to a read+write principal too", async () => {
    const rw = await connect({
      ...mcpPrincipal(f.memberId),
      scopes: ["bilan:read", "bilan:write"],
    });
    try {
      const { tools } = await rw.client.listTools();
      expect(tools).toHaveLength(ALL_TOOLS.length);
      const accounts = data(await rw.client.callTool({ name: "list_accounts", arguments: {} }));
      expect(accounts.accounts.length).toBe(2);
    } finally {
      await rw.close();
    }
  });

  it("list_accounts: own and shared-ai with balances, IBAN masked on the owned one only", async () => {
    const { accounts } = data(await call("list_accounts"));
    const byId = new Map(accounts.map((a: { id: string }) => [a.id, a]));
    expect([...byId.keys()].sort()).toEqual([f.accounts.own, f.accounts.sharedAi].sort());
    expect(byId.get(f.accounts.own)).toMatchObject({
      name: "own",
      access: "OWNER",
      ibanMasked: "•••• 0189",
      balance: round2(-100 - 5 + 77.77 - 33.33 + 12 - 21),
    });
    expect(byId.get(f.accounts.sharedAi)).toMatchObject({ access: "READ", ibanMasked: null });
  });

  it("get_dashboard: totals and balances over own and shared-ai only", async () => {
    const d = data(await call("get_dashboard"));
    expect(d.period).toMatchObject({ from: toIsoDay(thisMonth.from), to: toIsoDay(thisMonth.to) });
    expect(d.comparison.baseline).toBe("prev");
    expect(d.totals.expense).toBe(115);
    expect(d.byCategory).toContainEqual({
      categoryId: f.categoryId,
      categoryPath: "Groceries",
      amount: 110,
    });
    const balances = new Map(
      d.balances.map((b: { id: string; balance: number }) => [b.id, b.balance]),
    );
    expect([...balances.keys()].sort()).toEqual([f.accounts.own, f.accounts.sharedAi].sort());
    expect(balances.get(f.accounts.sharedAi)).toBe(round2(-10 - 77.77 - 12));
  });

  it("get_insights: defaults to the 3-month average and leaves shared-plain out", async () => {
    const d = data(await call("get_insights"));
    expect(d.comparison.baseline).toBe("avg3");
    // The overview nets the 12-month window: last month's visible legs count, l1 nets to 0.
    expect(d.overview.net).toBe(round2(-115 + 77.77 - 77.77 - 33.33 - 21));
  });

  it("search_transactions: own and shared-ai rows, decrypted label, search by word", async () => {
    const all = data(await call("search_transactions"));
    const accountIds = new Set(all.items.map((t: { accountId: string }) => t.accountId));
    expect([...accountIds].sort()).toEqual([f.accounts.own, f.accounts.sharedAi].sort());
    expect(all.total).toBe(9);
    expect(all.capped).toBe(false);

    const found = data(await call("search_transactions", { search: "bakery" }));
    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({ id: tx.bakery, label: "Bakery", amount: -5 });
    expect(found.items[0]).not.toHaveProperty("rawLabel");
    expect(found.items[0].date).toBe(toIsoDay(day(now, 10)));
  });

  it("get_transaction: the row with its visible links and its budgets", async () => {
    const shop = data(await call("get_transaction", { id: f.expenses.own }));
    expect(shop.transaction).toMatchObject({
      id: f.expenses.own,
      label: "Shop",
      amount: -100,
      categoryPath: "Groceries",
    });
    expect(shop.links).toBeNull();

    const bakery = data(await call("get_transaction", { id: tx.bakery }));
    expect(bakery.budgets.map((b: { budgetId: string }) => b.budgetId)).toEqual([budgetId]);

    const l1 = data(await call("get_transaction", { id: tx.l1Own }));
    expect(l1.links.others.map((o: { id: string }) => o.id)).toEqual([tx.l1Ai]);

    const l2 = data(await call("get_transaction", { id: tx.l2Own }));
    expect(l2.links).toMatchObject({ others: [], hiddenCount: 1 });

    const ai = data(await call("get_transaction", { id: f.expenses.sharedAi }));
    expect(ai.transaction.accountId).toBe(f.accounts.sharedAi);
  });

  it("get_transaction: NOT_FOUND on a shared-plain row and on an unknown id", async () => {
    for (const id of [f.expenses.sharedPlain, "nope"]) {
      const r = await call("get_transaction", { id });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toBe("NOT_FOUND");
    }
  });

  it("list_categories, list_rules: the household definitions", async () => {
    const { categories } = data(await call("list_categories"));
    expect(categories.map((c: { id: string }) => c.id)).toContain(f.categoryId);
    const { rules } = data(await call("list_rules"));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ pattern: "shop", categoryId: f.categoryId });
  });

  // `own` isn't shared with the household: its budget counts shared-ai only (50 outside MCP).
  it("list_budgets, get_budget: figures over shared-ai, not shared-plain", async () => {
    const { budgets } = data(await call("list_budgets"));
    expect(budgets.map((b: { id: string }) => b.id)).toEqual([budgetId]);
    expect(budgets[0].spentTotal).toBe(10);
    expect(data(await call("list_budgets", { archived: true })).budgets).toEqual([]);

    const { budget } = data(await call("get_budget", { id: budgetId }));
    expect(budget.spentTotal).toBe(10);
    expect(budget.transactions).toEqual([]);
    const detailed = data(await call("get_budget", { id: budgetId, withTransactions: true }));
    // The INCLUDE'd bakery row shows, out of budget.
    expect(detailed.budget.transactions.map((t: { id: string }) => t.id).sort()).toEqual(
      [f.expenses.sharedAi, tx.bakery].sort(),
    );
    expect(detailed.budget.outOfBudget).toMatchObject({ spent: 5, count: 1 });

    const missing = await call("get_budget", { id: "nope" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("NOT_FOUND");
  });

  it("list_merchants: totals over own and shared-ai only", async () => {
    const { others } = data(await call("list_merchants"));
    const shop = others.find((m: { label: string }) => m.label === "Shop");
    expect(shop).toMatchObject({ total: 110, count: 2 });
  });

  it("list_households: names and roles only, never an e-mail", async () => {
    const r = await call("list_households");
    const { households } = data(r);
    expect(households).toEqual([
      {
        id: f.groupId,
        name: `${PREFIX} G`,
        description: null,
        role: "MEMBER",
        members: [
          { name: "Owner A", role: "OWNER" },
          { name: "Member B", role: "MEMBER" },
        ],
      },
    ]);
    expect(textOf(r)).not.toMatch(/email|@bilan\.local/);
  });

  it("list_link_suggestions: the own ↔ shared-ai pair, not the shared-plain one", async () => {
    const { suggestions } = data(await call("list_link_suggestions"));
    expect(
      suggestions.map((s: { positiveId: string; negativeId: string }) => [
        s.positiveId,
        s.negativeId,
      ]),
    ).toEqual([[tx.pairAPos, tx.pairANeg]]);
  });

  it("get_preferences: link settings and exceptional rule", async () => {
    const prefs = data(await call("get_preferences"));
    expect(prefs.linkSuggestions).toHaveProperty("windowDays");
    expect(prefs.exceptionalRule).toHaveProperty("factor");
  });

  it("no tool output carries the IBAN, a raw label or anything from shared-plain", async () => {
    const args: Record<string, Record<string, unknown>> = {
      get_transaction: { id: tx.l2Own },
      get_budget: { id: budgetId, withTransactions: true },
    };
    const forbidden = [
      IBAN,
      IBAN.slice(4, 20),
      RAW_LABEL,
      "ZZRAWSECRET",
      "shared-plain",
      f.accounts.sharedPlain,
      f.expenses.sharedPlain,
      tx.pairBPos,
      tx.l2Plain,
    ];
    for (const name of ALL_TOOLS) {
      const text = textOf(await call(name, args[name] ?? {}));
      for (const needle of forbidden) expect(text, `${name} leaks ${needle}`).not.toContain(needle);
    }
  });

  it("returns INVALID_PERIOD on a bad period and INVALID_INPUT on schema-invalid arguments", async () => {
    const reversed = await call("get_dashboard", {
      period: { from: "2026-10-31", to: "2026-10-01" },
    });
    expect(reversed.isError).toBe(true);
    expect(textOf(reversed)).toBe("INVALID_PERIOD");

    for (const args of [{ take: 0 }, { take: "many" }, { skip: -1 }, { type: "BRIBE" }]) {
      const r = await call("search_transactions", args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
      expect(textOf(r)).toBe("INVALID_INPUT");
    }
    const noId = await call("get_transaction", {});
    expect(textOf(noId)).toBe("INVALID_INPUT");
  });

  it("checks the period through the tool path", async () => {
    const badPreset = await call("get_dashboard", { period: { preset: "next-decade" } });
    expect(badPreset.isError).toBe(true);
    expect(textOf(badPreset)).toBe("INVALID_INPUT");
    const badDay = await call("get_insights", { period: { from: "2026-13-01" } });
    expect(badDay.isError).toBe(true);
    expect(textOf(badDay)).toBe("INVALID_PERIOD");
  });

  it("rejects misplaced or misspelled arguments, naming the unknown key", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["get_dashboard", { preset: "last-month" }, "preset"],
      ["get_dashboard", { from: "2026-01-01", to: "2026-01-31" }, "from"],
      ["search_transactions", { category: f.categoryId }, "category"],
      ["get_insights", { period: { start: "2026-01-01" } }, "start"],
      ["list_merchants", { limit: 5 }, "limit"],
    ];
    for (const [name, args, key] of cases) {
      const r = await call(name, args);
      expect(r.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(textOf(r)).toBe("INVALID_INPUT");
      const detail = (r.content as { text: string }[])[1]?.text ?? "";
      expect(detail).toContain(key);
    }
  });
});

describe("search_transactions pagination", () => {
  it("never returns more than take (1000) rows", async () => {
    const userId = `${BULK_PREFIX}_owner`;
    await cleanupMcpFixture(BULK_PREFIX);
    await db.user.create({ data: { id: userId, email: `${userId}@bilan.local`, name: "Bulk" } });
    const accountId = (
      await db.bankAccount.create({ data: { ownerId: userId, name: "bulk", type: "CHECKING" } })
    ).id;
    const { tokens, ...fields } = buildSecureFields({ label: "Coffee", rawLabel: "COFFEE" });
    void tokens;
    await db.transaction.createMany({
      data: Array.from({ length: 1001 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 0, 1 + (i % 300), 12));
        return { accountId, date, periodDate: date, amount: -1, type: "CARD", ...fields };
      }),
    });
    const bulk = await connect(mcpPrincipal(userId));
    try {
      const page = data(
        await bulk.client.callTool({ name: "search_transactions", arguments: { take: 1000 } }),
      );
      expect(page.items).toHaveLength(1000);
      expect(page.capped || page.total === 1001).toBe(true);
      const rest = data(
        await bulk.client.callTool({
          name: "search_transactions",
          arguments: { take: 1000, skip: 1000 },
        }),
      );
      expect(rest.items).toHaveLength(1);
    } finally {
      await bulk.close();
    }
  });
});

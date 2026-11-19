import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { buildMcpServer } from "@/server/mcp/server";
import { mcpLimiterKey, runAsMcp } from "@/server/mcp/context";
import type { BudgetInput, BudgetLineInput } from "@/lib/schemas/budget";
import { assignTransaction, BudgetAccessError, createBudget } from "@/server/services/budgets";
import {
  cleanupMcpFixture,
  createMcpFixture,
  expense,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpwbud";
const now = new Date();
const y = now.getUTCFullYear();
const m = now.getUTCMonth();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const month = {
  periodType: "MONTH" as const,
  periodStart: iso(new Date(Date.UTC(y, m, 1))),
  periodEnd: iso(new Date(Date.UTC(y, m + 1, 0))),
};
const day = new Date(Date.UTC(y, m, 12, 12));

let f: McpFixture;
let h = ""; // second household: B is a member, `x` is shared there WITH the AI flag
let k = ""; // a household B isn't in
let x = ""; // owner A's account, shared to G without AI and to H with AI
let xTx = "";
let personalCategory = "";
let client: Client;
let close: () => Promise<void>;

const principal = () => ({
  ...mcpPrincipal(f.memberId),
  scopes: ["bilan:read", "bilan:write"] as ("bilan:read" | "bilan:write")[],
});

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const textOf = (r: ToolResult) => (r.content as { type: string; text: string }[])[0].text;
const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (r: ToolResult): any => {
  expect(r.isError, textOf(r)).toBeFalsy();
  return r.structuredContent;
};
const failed = (r: ToolResult, code: string) => {
  expect(r.isError).toBe(true);
  expect(textOf(r)).toBe(code);
};
const stamped = async (action: string, entityId: string) => {
  const rows = await db.auditLog.findMany({ where: { userId: f.memberId, action, entityId } });
  expect(rows.length, action).toBeGreaterThan(0);
  for (const r of rows) expect(r.metadata).toMatchObject({ via: "mcp", client: { kind: "token" } });
};
const budgetCount = () =>
  db.budget.count({ where: { OR: [{ userId: f.memberId }, { groupId: f.groupId }] } });

const personal = (accountId: string, extra: Record<string, unknown> = {}) => ({
  name: "Groceries",
  ...month,
  lines: [{ kind: "EXPENSE", categoryId: personalCategory, accountId, plannedAmount: 300 }],
  ...extra,
});
const household = (
  line: Partial<BudgetLineInput>,
  extra: Partial<BudgetInput> = {},
): BudgetInput => ({
  name: "Household",
  groupId: f.groupId,
  ...month,
  lines: [{ kind: "EXPENSE" as const, categoryId: f.categoryId, plannedAmount: 200, ...line }],
  ...extra,
});
const groupBudget = async () =>
  (await createBudget(household({ accountId: f.accounts.sharedAi }), { id: f.memberId })).id;
const asMcp = <T>(fn: () => Promise<T>) => runAsMcp(principal(), fn);
const serviceError = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(BudgetAccessError);
  return (e as Error).message;
};

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
  await db.groupMember.updateMany({
    where: { groupId: f.groupId, userId: f.memberId },
    data: { role: "ADMIN" },
  });
  personalCategory = (await db.category.create({ data: { userId: f.memberId, name: "Food" } })).id;
  h = (await db.group.create({ data: { name: `${PREFIX} H`, createdById: f.ownerId } })).id;
  k = (await db.group.create({ data: { name: `${PREFIX} K`, createdById: f.ownerId } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId: h, userId: f.ownerId, role: "OWNER" },
      { groupId: h, userId: f.memberId, role: "MEMBER" },
      { groupId: k, userId: f.ownerId, role: "OWNER" },
    ],
  });
  x = (await db.bankAccount.create({ data: { ownerId: f.ownerId, name: "x", type: "CHECKING" } }))
    .id;
  const share = (accountId: string, groupId: string, allowAiAssistants: boolean) => ({
    accountId,
    groupId,
    permission: "READ" as const,
    allowAiAssistants,
    createdById: f.ownerId,
  });
  await db.accountShare.createMany({
    data: [
      share(x, h, true),
      share(x, f.groupId, false),
      { ...share(f.accounts.own, f.groupId, false), createdById: f.memberId },
    ],
  });
  xTx = await expense(x, day, -15, null);

  const server = buildMcpServer(principal());
  client = new Client({ name: "bilan-test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  close = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(() => mcpWriteLimiter.reset(mcpLimiterKey(principal())));

afterAll(async () => {
  await close();
  await db.auditLog.deleteMany({ where: { userId: { in: [f.ownerId, f.memberId] } } });
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

describe("budget lifecycle over MCP", () => {
  it("creates, renames, archives, unarchives and rolls a personal budget", async () => {
    const created = ok(await call("create_budget", personal(f.accounts.own, { recurring: true })));
    expect(created).toEqual({ ok: true, id: expect.any(String) });
    const id: string = created.id;
    const detail = ok(await call("get_budget", { id }));
    expect(detail.budget.name).toBe("Groceries");
    await stamped("budget.created", id);

    ok(
      await call("update_budget", {
        id,
        ...personal(f.accounts.own, { name: "Food", recurring: true }),
      }),
    );
    expect((await db.budget.findUniqueOrThrow({ where: { id } })).name).toBe("Food");
    await stamped("budget.updated", id);

    expect(ok(await call("archive_budget", { id }))).toEqual({ ok: true, id });
    expect((await db.budget.findUniqueOrThrow({ where: { id } })).archived).toBe(true);
    await stamped("budget.archived", id);
    ok(await call("unarchive_budget", { id }));
    expect((await db.budget.findUniqueOrThrow({ where: { id } })).archived).toBe(false);
    await stamped("budget.unarchived", id);

    const rolled = ok(await call("roll_recurring_budget", { id }));
    expect(rolled).toMatchObject({ ok: true, created: true, id: expect.any(String) });
    const next = await db.budget.findUniqueOrThrow({ where: { id: rolled.id } });
    expect(next.parentBudgetId).toBe(id);
    expect(iso(next.periodStart)).toBe(iso(new Date(Date.UTC(y, m + 1, 1))));
    await stamped("budget.created", rolled.id);
  });

  it("assigns then unassigns an own transaction", async () => {
    const id = ok(await call("create_budget", personal(f.accounts.own))).id;
    const args = { budgetId: id, transactionId: f.expenses.own };
    ok(await call("assign_transaction_to_budget", { ...args, mode: "EXCLUDE" }));
    const where = { budgetId_transactionId: args };
    expect((await db.budgetAssignment.findUniqueOrThrow({ where })).mode).toBe("EXCLUDE");
    await stamped("budget.assignment.create", `${id}:${f.expenses.own}`);

    expect(ok(await call("unassign_transaction_from_budget", args))).toEqual({ ok: true, id });
    expect(await db.budgetAssignment.findUnique({ where })).toBeNull();
    await stamped("budget.assignment.delete", `${id}:${f.expenses.own}`);
  });

  it("rejects an invalid budget and refuses a line on an account the client can't see", async () => {
    const before = await budgetCount();
    failed(await call("create_budget", personal(f.accounts.own, { lines: [] })), "INVALID_INPUT");
    failed(await call("create_budget", personal(f.accounts.sharedPlain)), "INVALID_INPUT");
    failed(
      await call("create_budget", personal(f.accounts.own, { accountId: f.accounts.sharedAi })),
      "INVALID_INPUT",
    );
    expect(await budgetCount()).toBe(before);
  });

  it("refuses to include a transaction on an account the client can't see", async () => {
    const id = ok(await call("create_budget", personal(f.accounts.own))).id;
    failed(
      await call("assign_transaction_to_budget", {
        budgetId: id,
        transactionId: f.expenses.sharedPlain,
        mode: "INCLUDE",
      }),
      "FORBIDDEN",
    );
    expect(await db.budgetAssignment.count({ where: { budgetId: id } })).toBe(0);
  });
});

// Per-share rule (spec, PR 3 design §3): over MCP an account enters G's budgets only if owned
// or AI-allowed on its G share, even when another household's share lets the client see it.
describe("per-share AI rule on household budgets", () => {
  it("refuses a line on x over MCP and accepts it outside", async () => {
    const before = await budgetCount();
    failed(await call("create_budget", household({ accountId: x })), "INVALID_INPUT");
    expect(
      await serviceError(
        asMcp(() => createBudget(household({ accountId: x }), { id: f.memberId })),
      ),
    ).toBe("INVALID_LINE");
    expect(await budgetCount()).toBe(before);
    const { id } = await createBudget(household({ accountId: x }), { id: f.memberId });
    await db.budget.delete({ where: { id } });
  });

  it("refuses x as a transfer counterpart over MCP", async () => {
    const input = household(
      {
        kind: "TRANSFER",
        categoryId: undefined,
        direction: "OUT",
        counterpartAccountId: x,
      },
      { accountId: f.accounts.sharedAi },
    );
    expect(await serviceError(asMcp(() => createBudget(input, { id: f.memberId })))).toBe(
      "INVALID_LINE",
    );
    failed(await call("create_budget", input), "INVALID_INPUT");
  });

  it("refuses a budget attached to x over MCP and accepts it outside", async () => {
    const input = household({}, { accountId: x });
    expect(await serviceError(asMcp(() => createBudget(input, { id: f.memberId })))).toBe(
      "INVALID_ACCOUNT",
    );
    failed(await call("create_budget", input), "INVALID_INPUT");
    const { id } = await createBudget(input, { id: f.memberId });
    await db.budget.delete({ where: { id } });
  });

  it("refuses to INCLUDE an x transaction into a G budget over MCP, not outside", async () => {
    const budgetId = await groupBudget();
    const args = { budgetId, transactionId: xTx, mode: "INCLUDE" as const };
    failed(await call("assign_transaction_to_budget", args), "FORBIDDEN");
    expect(await db.budgetAssignment.count({ where: { budgetId } })).toBe(0);
    await assignTransaction(args, { id: f.memberId });
    expect(await db.budgetAssignment.count({ where: { budgetId } })).toBe(1);
  });

  it("accepts an owned account shared to G without the AI flag", async () => {
    const id = ok(await call("create_budget", household({ accountId: f.accounts.own }))).id;
    const budget = await db.budget.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(budget.groupId).toBe(f.groupId);
    expect(budget.lines[0].accountId).toBe(f.accounts.own);
    ok(
      await call("assign_transaction_to_budget", {
        budgetId: id,
        transactionId: f.expenses.own,
        mode: "INCLUDE",
      }),
    );
    await stamped("budget.created", id);
  });

  it("keeps an AI-allowed G share usable", async () => {
    ok(await call("create_budget", household({ accountId: f.accounts.sharedAi })));
  });

  it("refuses sharedPlain, invisible to the client, in a G budget line", async () => {
    failed(
      await call("create_budget", household({ accountId: f.accounts.sharedPlain })),
      "INVALID_INPUT",
    );
    expect(
      await serviceError(
        asMcp(() =>
          createBudget(household({ accountId: f.accounts.sharedPlain }), { id: f.memberId }),
        ),
      ),
    ).toBe("INVALID_LINE");
  });
});

describe("budgets of a household the user isn't in", () => {
  it("refuses every write on them", async () => {
    const other = await db.budget.create({
      data: {
        name: "Other",
        groupId: k,
        periodType: "MONTH",
        periodStart: new Date(`${month.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${month.periodEnd}T23:59:59.999Z`),
        recurring: true,
        createdById: f.ownerId,
      },
    });
    const id = other.id;
    const tx = { budgetId: id, transactionId: f.expenses.own };
    failed(await call("update_budget", { id, ...personal(f.accounts.own) }), "FORBIDDEN");
    failed(await call("archive_budget", { id }), "FORBIDDEN");
    failed(await call("unarchive_budget", { id }), "FORBIDDEN");
    failed(await call("roll_recurring_budget", { id }), "FORBIDDEN");
    failed(await call("assign_transaction_to_budget", { ...tx, mode: "EXCLUDE" }), "FORBIDDEN");
    failed(await call("unassign_transaction_from_budget", tx), "FORBIDDEN");
    failed(await call("create_budget", { ...household({}), groupId: k }), "FORBIDDEN");
    expect(await db.budget.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: "Other",
      archived: false,
    });
    expect(await db.budget.count({ where: { groupId: k } })).toBe(1);
    expect(await db.budgetAssignment.count({ where: { budgetId: id } })).toBe(0);

    failed(await call("update_budget", { id: "nope", ...personal(f.accounts.own) }), "NOT_FOUND");
    failed(
      await call("assign_transaction_to_budget", { ...tx, budgetId: "nope", mode: "INCLUDE" }),
      "NOT_FOUND",
    );
  });
});

describe("annotations", () => {
  it("flags removals destructive and repeatable writes idempotent", async () => {
    const tools = (await client.listTools()).tools;
    const hint = (n: string) => tools.find((t) => t.name === n)?.annotations;
    expect(hint("unassign_transaction_from_budget")?.destructiveHint).toBe(true);
    expect(hint("archive_budget")?.destructiveHint).toBe(true);
    expect(hint("unarchive_budget")?.idempotentHint).toBe(true);
    expect(hint("assign_transaction_to_budget")?.idempotentHint).toBe(true);
    expect(hint("create_budget")?.readOnlyHint).toBe(false);
    expect(tools.map((t) => t.name)).not.toContain("delete_budget");
  });
});

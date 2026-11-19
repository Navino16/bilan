import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { createRule } from "@/server/services/categorization";
import { buildMcpServer } from "@/server/mcp/server";
import { mcpLimiterKey } from "@/server/mcp/context";
import { addMonths } from "@/lib/period";
import {
  cleanupMcpFixture,
  createMcpFixture,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpwtx";
const now = new Date();
let f: McpFixture;
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
const countRows = (accountId: string) => db.transaction.count({ where: { accountId } });

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
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
  await db.categorizationRule.deleteMany({ where: { userId: f.memberId } });
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

describe("create_transaction", () => {
  it("applies the user's rules when no category is given and stamps the audit log", async () => {
    await createRule(
      { pattern: "zzbakery", matchType: "CONTAINS", categoryId: f.categoryId },
      { id: f.memberId },
    );
    const res = ok(
      await call("create_transaction", {
        accountId: f.accounts.own,
        date: "2026-03-05",
        amount: -12.5,
        type: "CARD",
        label: "ZZBAKERY Paris",
      }),
    );
    expect(res.ok).toBe(true);
    const row = await db.transaction.findUniqueOrThrow({ where: { id: res.id } });
    expect(row.categoryId).toBe(f.categoryId);
    expect(Number(row.amount)).toBe(-12.5);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { userId: f.memberId, action: "transaction.created", entityId: res.id },
    });
    expect(audit.metadata).toMatchObject({ via: "mcp", client: { kind: "token" } });
  });

  it("refuses accounts the MCP client may not write", async () => {
    const before = [await countRows(f.accounts.sharedPlain), await countRows(f.accounts.sharedAi)];
    for (const accountId of [f.accounts.sharedPlain, f.accounts.sharedAi]) {
      failed(
        await call("create_transaction", {
          accountId,
          date: "2026-03-05",
          amount: -1,
          type: "CARD",
          label: "Nope",
        }),
        "FORBIDDEN",
      );
    }
    expect([await countRows(f.accounts.sharedPlain), await countRows(f.accounts.sharedAi)]).toEqual(
      before,
    );
  });

  it("advertises a JSON schema without the bank-string field", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "create_transaction");
    const props = Object.keys(tool?.inputSchema.properties ?? {});
    expect(props).toEqual(
      expect.arrayContaining(["accountId", "date", "amount", "type", "label", "note"]),
    );
    expect(props).not.toContain("rawLabel");
  });
});

describe("update_transaction", () => {
  it("changes the label and amount of an own transaction", async () => {
    const res = ok(
      await call("update_transaction", { id: f.expenses.own, label: "Renamed", amount: -33.2 }),
    );
    expect(res).toEqual({ ok: true, id: f.expenses.own });
    const row = await db.transaction.findUniqueOrThrow({ where: { id: f.expenses.own } });
    expect(Number(row.amount)).toBe(-33.2);
  });

  it("refuses a transaction on a shared account the client may not write", async () => {
    failed(
      await call("update_transaction", { id: f.expenses.sharedPlain, label: "Hack" }),
      "FORBIDDEN",
    );
  });

  it("answers NOT_FOUND for an unknown id", async () => {
    failed(await call("update_transaction", { id: "nope", label: "x" }), "NOT_FOUND");
  });
});

describe("recategorize_transaction", () => {
  it("sets the household category and clears it back to null", async () => {
    expect(
      ok(await call("recategorize_transaction", { id: f.expenses.own, categoryId: null })),
    ).toEqual({ ok: true, id: f.expenses.own });
    const clear = await db.transaction.findUniqueOrThrow({ where: { id: f.expenses.own } });
    expect(clear.categoryId).toBeNull();
    ok(await call("recategorize_transaction", { id: f.expenses.own, categoryId: f.categoryId }));
    const set = await db.transaction.findUniqueOrThrow({ where: { id: f.expenses.own } });
    expect(set.categoryId).toBe(f.categoryId);
  });

  it("answers NOT_FOUND for an unknown id", async () => {
    failed(await call("recategorize_transaction", { id: "nope", categoryId: null }), "NOT_FOUND");
  });
});

describe("set_transaction_month", () => {
  it("assigns the previous month then returns to the automatic one", async () => {
    const prev = addMonths(now.getUTCFullYear(), now.getUTCMonth() + 1, -1);
    const month = `${prev.year}-${String(prev.month).padStart(2, "0")}`;
    ok(await call("set_transaction_month", { id: f.expenses.own, month }));
    const manual = await db.transaction.findUniqueOrThrow({ where: { id: f.expenses.own } });
    expect(manual.periodManual).toBe(true);
    expect(manual.periodDate.getUTCMonth() + 1).toBe(prev.month);
    ok(await call("set_transaction_month", { id: f.expenses.own, month: null }));
    const auto = await db.transaction.findUniqueOrThrow({ where: { id: f.expenses.own } });
    expect(auto.periodManual).toBe(false);
  });

  it("rejects a malformed month and an unknown id", async () => {
    failed(
      await call("set_transaction_month", { id: f.expenses.own, month: "2026-13" }),
      "INVALID_INPUT",
    );
    failed(await call("set_transaction_month", { id: "nope", month: null }), "NOT_FOUND");
  });
});

describe("writes stay inside the MCP account set", () => {
  const targets = [
    ["sharedAi", () => f.expenses.sharedAi],
    ["sharedPlain", () => f.expenses.sharedPlain],
  ] as const;

  it.each(targets)("refuses every update-style tool on %s and leaves the row", async (_n, txId) => {
    const id = txId();
    const before = await db.transaction.findUniqueOrThrow({ where: { id } });
    failed(await call("update_transaction", { id, label: "Hack", amount: -1 }), "FORBIDDEN");
    failed(await call("recategorize_transaction", { id, categoryId: null }), "FORBIDDEN");
    failed(await call("set_transaction_month", { id, month: "2020-01" }), "FORBIDDEN");
    expect(await db.transaction.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });

  it("stamps update, recategorize and set-month audit rows with via mcp", async () => {
    const id = f.expenses.own;
    ok(await call("update_transaction", { id, label: "Audited" }));
    ok(await call("recategorize_transaction", { id, categoryId: null }));
    ok(await call("set_transaction_month", { id, month: null }));
    for (const action of [
      "transaction.updated",
      "transaction.recategorized",
      "transaction.month_set",
    ]) {
      const rows = await db.auditLog.findMany({
        where: { userId: f.memberId, action, entityId: id },
      });
      expect(rows.length, action).toBeGreaterThan(0);
      for (const r of rows) expect(r.metadata).toMatchObject({ via: "mcp" });
    }
  });
});

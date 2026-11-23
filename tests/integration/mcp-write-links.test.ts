import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { buildMcpServer } from "@/server/mcp/server";
import { mcpLimiterKey } from "@/server/mcp/context";
import {
  cleanupMcpFixture,
  createMcpFixture,
  expense,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpwlk";
const now = new Date();
const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 12, 12));
let f: McpFixture;
let second: string; // member B's second account
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
const detailOf = (r: ToolResult) =>
  (r.content as { type: string; text: string }[])[1]?.text ?? null;
const linkCount = () => db.transactionLink.count({ where: { createdById: f.memberId } });
const audit = (action: string, entityId?: string) =>
  db.auditLog.findMany({ where: { userId: f.memberId, action, ...(entityId && { entityId }) } });
const stamped = async (action: string, entityId?: string) => {
  const rows = await audit(action, entityId);
  expect(rows.length, action).toBeGreaterThan(0);
  for (const r of rows) expect(r.metadata).toMatchObject({ via: "mcp", client: { kind: "token" } });
};
const pair = async (amount: number) => [
  await expense(f.accounts.own, day, amount, null),
  await expense(second, day, -amount, null),
];

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
  second = (
    await db.bankAccount.create({ data: { ownerId: f.memberId, name: "second", type: "SAVINGS" } })
  ).id;
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
  await db.ignoredLinkSuggestion.deleteMany({ where: { userId: f.memberId } });
  await db.auditLog.deleteMany({ where: { userId: { in: [f.ownerId, f.memberId] } } });
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

describe("create_link and delete_link", () => {
  it("links two own transactions, shows it on get_transaction, then deletes it", async () => {
    const ids = await pair(50);
    const res = ok(await call("create_link", { transactionIds: ids }));
    expect(res.ok).toBe(true);
    const members = await db.transactionLinkMember.findMany({ where: { linkId: res.id } });
    expect(members.map((m) => m.transactionId).sort()).toEqual([...ids].sort());
    const tx = ok(await call("get_transaction", { id: ids[0] }));
    expect(JSON.stringify(tx)).toContain(res.id);
    await stamped("link.created", res.id);

    expect(ok(await call("delete_link", { linkId: res.id }))).toEqual({ ok: true, id: res.id });
    expect(await db.transactionLink.findUnique({ where: { id: res.id } })).toBeNull();
    await stamped("link.deleted", res.id);
  });

  it("refuses a link involving a shared account the client may not write", async () => {
    const mine = await expense(f.accounts.own, day, 40, null);
    const before = await linkCount();
    for (const other of [f.expenses.sharedPlain, f.expenses.sharedAi]) {
      failed(await call("create_link", { transactionIds: [mine, other] }), "FORBIDDEN");
    }
    expect(await linkCount()).toBe(before);
  });

  it("rejects fewer than two transactions", async () => {
    failed(await call("create_link", { transactionIds: [f.expenses.own] }), "INVALID_INPUT");
    const res = await call("create_link", { transactionIds: [f.expenses.own, f.expenses.own] });
    failed(res, "FORBIDDEN");
    expect(detailOf(res)).toBe("TOO_FEW");
  });

  it("names ALREADY_LINKED on own transactions, not on one it may not write", async () => {
    const [a, b] = await pair(61);
    ok(await call("create_link", { transactionIds: [a, b] }));
    const mine = await expense(f.accounts.own, day, 62, null);
    const res = await call("create_link", { transactionIds: [mine, a] });
    failed(res, "FORBIDDEN");
    expect(detailOf(res)).toBe("ALREADY_LINKED");

    const hidden = await expense(f.accounts.sharedPlain, day, -63, null);
    await db.transactionLink.create({
      data: {
        createdById: f.ownerId,
        members: { create: [{ transactionId: hidden }, { transactionId: f.expenses.sharedAi }] },
      },
    });
    const refused = await call("create_link", { transactionIds: [mine, hidden] });
    failed(refused, "FORBIDDEN");
    expect(detailOf(refused)).toBeNull();
  });

  it("refuses to delete a link it may not write and keeps the link", async () => {
    const mine = await expense(f.accounts.own, day, 30, null);
    const link = await db.transactionLink.create({
      data: {
        createdById: f.ownerId,
        members: { create: [{ transactionId: mine }, { transactionId: f.expenses.sharedPlain }] },
      },
    });
    failed(await call("delete_link", { linkId: link.id }), "FORBIDDEN");
    expect(await db.transactionLink.findUnique({ where: { id: link.id } })).not.toBeNull();
    failed(await call("delete_link", { linkId: "nope" }), "NOT_FOUND");
  });
});

describe("create_opposite_transaction", () => {
  it("mirrors an own transaction into a second owned account", async () => {
    const source = await expense(f.accounts.own, day, -25, null);
    const res = ok(
      await call("create_opposite_transaction", {
        transactionId: source,
        targetAccountId: second,
      }),
    );
    const leg = await db.transaction.findUniqueOrThrow({ where: { id: res.id } });
    expect(leg.accountId).toBe(second);
    expect(Number(leg.amount)).toBe(25);
    const member = await db.transactionLinkMember.findUniqueOrThrow({
      where: { transactionId: source },
    });
    expect(
      (await db.transactionLinkMember.findMany({ where: { linkId: member.linkId } })).length,
    ).toBe(2);
    await stamped("link.oppositeCreated");
  });

  it("names SAME_ACCOUNT when the target is the source's account", async () => {
    const source = await expense(f.accounts.own, day, -27, null);
    const res = await call("create_opposite_transaction", {
      transactionId: source,
      targetAccountId: f.accounts.own,
    });
    failed(res, "FORBIDDEN");
    expect(detailOf(res)).toBe("SAME_ACCOUNT");
  });

  it("refuses a target the client may not write", async () => {
    const source = await expense(f.accounts.own, day, -26, null);
    const before = await db.transaction.count({ where: { accountId: f.accounts.sharedPlain } });
    failed(
      await call("create_opposite_transaction", {
        transactionId: source,
        targetAccountId: f.accounts.sharedPlain,
      }),
      "FORBIDDEN",
    );
    expect(await db.transaction.count({ where: { accountId: f.accounts.sharedPlain } })).toBe(
      before,
    );
  });

  it("refuses a source on a shared account", async () => {
    const before = await db.transaction.count({ where: { accountId: second } });
    for (const source of [f.expenses.sharedPlain, f.expenses.sharedAi]) {
      const res = await call("create_opposite_transaction", {
        transactionId: source,
        targetAccountId: second,
      });
      expect(res.isError).toBe(true);
      expect(["FORBIDDEN", "NOT_FOUND"]).toContain(textOf(res));
    }
    expect(await db.transaction.count({ where: { accountId: second } })).toBe(before);
  });
});

describe("link suggestions", () => {
  it("ignores then restores a suggested pair and stamps both audit rows", async () => {
    const ids = await pair(77);
    const key = [...ids].sort().join("|");
    const listed = ok(await call("list_link_suggestions", {}));
    expect(listed.suggestions.map((s: { key: string }) => s.key)).toContain(key);

    expect(ok(await call("ignore_link_suggestion", { pairKey: key }))).toEqual({
      ok: true,
      id: key,
    });
    const after = ok(await call("list_link_suggestions", {}));
    expect(after.suggestions.map((s: { key: string }) => s.key)).not.toContain(key);
    const dismissed = ok(await call("list_link_suggestions", { ignored: true }));
    expect(dismissed.suggestions.map((s: { key: string }) => s.key)).toContain(key);

    ok(await call("restore_link_suggestion", { pairKey: key }));
    const back = ok(await call("list_link_suggestions", {}));
    expect(back.suggestions.map((s: { key: string }) => s.key)).toContain(key);
    await stamped("link.suggestionIgnored", key);
    await stamped("link.suggestionRestored", key);
  });

  it("rejects a pair key without a separator or too long, and too many transactions", async () => {
    failed(await call("ignore_link_suggestion", { pairKey: "abc" }), "INVALID_INPUT");
    failed(await call("restore_link_suggestion", { pairKey: "abc" }), "INVALID_INPUT");
    failed(
      await call("ignore_link_suggestion", { pairKey: `${"a".repeat(100)}|${"b".repeat(100)}` }),
      "INVALID_INPUT",
    );
    const ids = Array.from({ length: 51 }, (_, i) => `tx${i}`);
    failed(await call("create_link", { transactionIds: ids }), "INVALID_INPUT");
  });

  it("answers NOT_FOUND when restoring a pair that was never ignored", async () => {
    failed(await call("restore_link_suggestion", { pairKey: "x|y" }), "NOT_FOUND");
  });
});

describe("annotations", () => {
  it("flags delete_link destructive and the suggestion tools idempotent", async () => {
    const tools = (await client.listTools()).tools;
    const hint = (n: string) => tools.find((t) => t.name === n)?.annotations;
    expect(hint("delete_link")?.destructiveHint).toBe(true);
    expect(hint("ignore_link_suggestion")?.idempotentHint).toBe(true);
    expect(hint("restore_link_suggestion")?.idempotentHint).toBe(true);
    expect(hint("create_link")?.readOnlyHint).toBe(false);
  });
});

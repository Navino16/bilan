import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { buildMcpServer } from "@/server/mcp/server";
import { mcpLimiterKey } from "@/server/mcp/context";
import { createAccount } from "@/server/services/accounts";
import {
  cleanupMcpFixture,
  createMcpFixture,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpwacc";
const IBAN = "FR7630006000011234567890189";
const now = new Date();

let f: McpFixture;
let client: Client;
let close: () => Promise<void>;
let withIban = "";
let sharedWrite = "";

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
const accountCount = () => db.bankAccount.count({ where: { ownerId: f.memberId } });

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
  withIban = (await createAccount({ name: "Has IBAN", type: "CHECKING", iban: IBAN }, f.memberId))
    .id;
  sharedWrite = (
    await db.bankAccount.create({
      data: { ownerId: f.ownerId, name: "Shared W", type: "CHECKING" },
    })
  ).id;
  await db.accountShare.create({
    data: {
      accountId: sharedWrite,
      groupId: f.groupId,
      permission: "WRITE",
      allowAiAssistants: true,
      createdById: f.ownerId,
    },
  });

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

describe("account tools over MCP", () => {
  it("creates an account owned by the caller", async () => {
    const created = ok(
      await call("create_account", {
        name: "Savings",
        type: "SAVINGS",
        bankName: "Bank",
        color: "#112233",
        icon: "🏦",
        initialBalance: 250.5,
      }),
    );
    expect(created).toEqual({ ok: true, id: expect.any(String) });
    const row = await db.bankAccount.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({
      ownerId: f.memberId,
      name: "Savings",
      type: "SAVINGS",
      bankName: "Bank",
      color: "#112233",
      icon: "🏦",
      ibanEnc: null,
    });
    expect(Number(row.initialBalance)).toBe(250.5);
    await stamped("account.created", created.id);
  });

  it("updates an account and keeps its stored IBAN", async () => {
    const before = await db.bankAccount.findUniqueOrThrow({ where: { id: withIban } });
    expect(before.ibanEnc).not.toBeNull();
    const res = await call("update_account", { id: withIban, name: "Renamed", type: "CHECKING" });
    expect(ok(res)).toEqual({ ok: true, id: withIban });
    expect(JSON.stringify(res)).not.toContain(IBAN);
    const after = await db.bankAccount.findUniqueOrThrow({ where: { id: withIban } });
    expect(after).toMatchObject({
      name: "Renamed",
      ibanEnc: before.ibanEnc,
      ibanHash: before.ibanHash,
    });
    await stamped("account.updated", withIban);
  });

  it("patches: omitted fields are kept, null clears", async () => {
    const id = ok(
      await call("create_account", {
        name: "Livret A",
        type: "SAVINGS",
        bankName: "Bank",
        icon: "🏦",
        color: "#112233",
        initialBalance: 250.5,
      }),
    ).id;
    ok(await call("update_account", { id, name: "Livret B" }));
    let row = await db.bankAccount.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      name: "Livret B",
      type: "SAVINGS",
      bankName: "Bank",
      icon: "🏦",
      color: "#112233",
    });
    expect(Number(row.initialBalance)).toBe(250.5);
    ok(await call("update_account", { id, icon: null, bankName: null, initialBalance: null }));
    row = await db.bankAccount.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      icon: null,
      bankName: null,
      name: "Livret B",
      type: "SAVINGS",
      color: "#112233",
    });
    expect(Number(row.initialBalance)).toBe(0);
    await stamped("account.updated", id);
  });

  it("refuses to leave SAVINGS while a mirror is configured", async () => {
    const id = ok(await call("create_account", { name: "Mirrored", type: "SAVINGS" })).id;
    await db.bankAccount.update({
      where: { id },
      data: { mirrorPattern: "X", mirrorSources: { create: { sourceAccountId: withIban } } },
    });
    const res = await call("update_account", { id, type: "CHECKING" });
    failed(res, "INVALID_INPUT");
    expect((res.content as { text: string }[])[1]?.text).toBe("INVALID_MIRROR_ACTIVE");
    expect(await db.bankAccount.findUniqueOrThrow({ where: { id } })).toMatchObject({
      type: "SAVINGS",
      mirrorPattern: "X",
    });
    await db.savingsMirrorSource.deleteMany({ where: { savingsAccountId: id } });
  });

  it("rejects an iban key and writes nothing", async () => {
    const count = await accountCount();
    failed(
      await call("create_account", { name: "X", type: "CHECKING", iban: IBAN }),
      "INVALID_INPUT",
    );
    failed(
      await call("update_account", { id: withIban, name: "Hacked", type: "CHECKING", iban: "" }),
      "INVALID_INPUT",
    );
    expect(await accountCount()).toBe(count);
    expect((await db.bankAccount.findUniqueOrThrow({ where: { id: withIban } })).name).not.toBe(
      "Hacked",
    );
  });

  it("rejects invalid fields", async () => {
    const count = await accountCount();
    failed(await call("create_account", { name: "X", type: "NOPE" }), "INVALID_INPUT");
    failed(
      await call("create_account", { name: "X", type: "CHECKING", color: "red" }),
      "INVALID_INPUT",
    );
    failed(await call("create_account", { name: " ", type: "CHECKING" }), "INVALID_INPUT");
    expect(await accountCount()).toBe(count);
  });

  it("archives and unarchives an account", async () => {
    const id = ok(await call("create_account", { name: "Old", type: "CHECKING" })).id;
    expect(ok(await call("archive_account", { id }))).toEqual({ ok: true, id });
    expect((await db.bankAccount.findUniqueOrThrow({ where: { id } })).archived).toBe(true);
    await stamped("account.archived", id);
    expect(ok(await call("unarchive_account", { id }))).toEqual({ ok: true, id });
    expect((await db.bankAccount.findUniqueOrThrow({ where: { id } })).archived).toBe(false);
    await stamped("account.unarchived", id);
  });

  it("refuses to change another user's account shared with WRITE + AI", async () => {
    for (const [name, args] of [
      ["update_account", { id: sharedWrite, name: "Mine", type: "CHECKING" }],
      ["archive_account", { id: sharedWrite }],
    ] as const) {
      failed(await call(name, args), "FORBIDDEN");
    }
    expect(await db.bankAccount.findUniqueOrThrow({ where: { id: sharedWrite } })).toMatchObject({
      name: "Shared W",
      archived: false,
    });
  });

  it("answers NOT_FOUND for an unknown or invisible account", async () => {
    failed(await call("archive_account", { id: "nope" }), "NOT_FOUND");
    failed(await call("unarchive_account", { id: "nope" }), "NOT_FOUND");
    failed(await call("update_account", { id: "nope", name: "X", type: "CHECKING" }), "NOT_FOUND");
    failed(await call("archive_account", { id: f.accounts.sharedPlain }), "NOT_FOUND");
  });

  it("serialises the tool schemas", async () => {
    const { tools } = await client.listTools();
    for (const name of ["create_account", "update_account"]) {
      const props = tools.find((t) => t.name === name)!.inputSchema.properties;
      expect(props, name).toHaveProperty("initialBalance");
      expect(props, name).not.toHaveProperty("iban");
    }
    const by = (n: string) => tools.find((t) => t.name === n)!.annotations;
    expect(by("archive_account")?.destructiveHint).toBe(true);
    expect(by("unarchive_account")?.idempotentHint).toBe(true);
  });
});

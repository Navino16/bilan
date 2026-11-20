import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { buildMcpServer } from "@/server/mcp/server";
import { mcpLimiterKey } from "@/server/mcp/context";
import {
  cleanupMcpFixture,
  createMcpFixture,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpwcat";
const now = new Date();

let f: McpFixture;
let client: Client;
let close: () => Promise<void>;
let otherCategory = "";

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
const stamped = async (action: string, entityId: string) => {
  const rows = await db.auditLog.findMany({ where: { userId: f.memberId, action, entityId } });
  expect(rows.length, action).toBeGreaterThan(0);
  for (const r of rows) expect(r.metadata).toMatchObject({ via: "mcp", client: { kind: "token" } });
};
const categoryCount = () =>
  db.category.count({ where: { OR: [{ userId: f.memberId }, { groupId: f.groupId }] } });

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
  otherCategory = (await db.category.create({ data: { userId: f.ownerId, name: "Private" } })).id;

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
  await db.category.deleteMany({ where: { userId: f.ownerId } });
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

describe("category tools over MCP", () => {
  it("creates and updates a personal category", async () => {
    const created = ok(
      await call("create_category", {
        name: "Pets",
        color: "var(--cat-leisure)",
        icon: "🐶",
        shiftDays: 3,
        savings: false,
      }),
    );
    expect(created).toEqual({ ok: true, id: expect.any(String) });
    const row = await db.category.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ userId: f.memberId, groupId: null, name: "Pets", shiftDays: 3 });
    await stamped("category.created", created.id);

    const child = ok(
      await call("create_category", { name: "Vet", color: "#aabbcc", parentId: created.id }),
    );
    expect((await db.category.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBe(
      created.id,
    );

    expect(
      ok(await call("update_category", { id: created.id, name: "Animals", color: "#112233" })),
    ).toEqual({ ok: true, id: created.id });
    expect(await db.category.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      name: "Animals",
      color: "#112233",
    });
    await stamped("category.updated", created.id);
  });

  it("keeps omitted fields on update and clears them with null", async () => {
    const parent = ok(await call("create_category", { name: "Home" }));
    const created = ok(
      await call("create_category", {
        name: "Rent",
        color: "#123456",
        icon: "🏠",
        parentId: parent.id,
        shiftDays: 4,
        savings: true,
        neutral: true,
      }),
    );
    const full = {
      color: "#123456",
      icon: "🏠",
      parentId: parent.id,
      shiftDays: 4,
      savings: true,
      neutral: true,
    };

    ok(await call("update_category", { id: created.id, name: "Housing" }));
    expect(await db.category.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      name: "Housing",
      ...full,
    });

    ok(await call("update_category", { id: created.id, color: null, icon: null }));
    expect(await db.category.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      name: "Housing",
      ...full,
      color: null,
      icon: null,
    });

    ok(
      await call("update_category", {
        id: created.id,
        parentId: null,
        shiftDays: null,
        savings: null,
        neutral: null,
      }),
    );
    expect(await db.category.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      name: "Housing",
      color: null,
      icon: null,
      parentId: null,
      shiftDays: null,
      savings: false,
      neutral: false,
    });

    const inherits = ok(await call("create_category", { name: "Inherits" }));
    ok(await call("update_category", { id: inherits.id, name: "Still inherits" }));
    expect((await db.category.findUniqueOrThrow({ where: { id: inherits.id } })).color).toBeNull();
    failed(await call("create_category", { name: "X", icon: "  " }), "INVALID_INPUT");
    failed(await call("create_category", { name: "X", color: null }), "INVALID_INPUT");
  });

  it("lets a household admin create a household category and refuses a plain member", async () => {
    const before = await categoryCount();
    const refused = await call("create_category", {
      name: "Shared",
      color: "#112233",
      groupId: f.groupId,
    });
    failed(refused, "FORBIDDEN");
    expect(await categoryCount()).toBe(before);

    await db.groupMember.updateMany({
      where: { groupId: f.groupId, userId: f.memberId },
      data: { role: "ADMIN" },
    });
    try {
      const created = ok(
        await call("create_category", { name: "Shared", color: "#112233", groupId: f.groupId }),
      );
      const row = await db.category.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({ groupId: f.groupId, userId: null });
      await stamped("category.created", created.id);
    } finally {
      await db.groupMember.updateMany({
        where: { groupId: f.groupId, userId: f.memberId },
        data: { role: "MEMBER" },
      });
    }
  });

  it("refuses to update a household category as a plain member", async () => {
    failed(
      await call("update_category", { id: f.categoryId, name: "Hijacked", color: "#112233" }),
      "FORBIDDEN",
    );
    expect((await db.category.findUniqueOrThrow({ where: { id: f.categoryId } })).name).not.toBe(
      "Hijacked",
    );
  });

  it("rejects a parent from another scope with INVALID_PARENT", async () => {
    const before = await categoryCount();
    for (const parentId of [otherCategory, f.categoryId]) {
      const res = await call("create_category", { name: "Orphan", color: "#112233", parentId });
      failed(res, "INVALID_INPUT");
      expect(detailOf(res)).toBe("INVALID_PARENT");
    }
    expect(await categoryCount()).toBe(before);
  });

  it("refuses to update another user's category", async () => {
    const res = await call("update_category", {
      id: otherCategory,
      name: "Mine",
      color: "#112233",
    });
    expect(res.isError).toBe(true);
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(textOf(res));
    expect((await db.category.findUniqueOrThrow({ where: { id: otherCategory } })).name).toBe(
      "Private",
    );
  });

  it("rejects an invalid color or shiftDays and unknown keys", async () => {
    const before = await categoryCount();
    failed(await call("create_category", { name: "X", color: "red" }), "INVALID_INPUT");
    failed(
      await call("create_category", { name: "X", color: "#112233", shiftDays: 99 }),
      "INVALID_INPUT",
    );
    failed(
      await call("create_category", { name: "X", color: "#112233", bogus: 1 }),
      "INVALID_INPUT",
    );
    failed(
      await call("update_category", { id: f.categoryId, name: "X", color: "red" }),
      "INVALID_INPUT",
    );
    expect(await categoryCount()).toBe(before);
  });

  it("serialises both tool schemas", async () => {
    const { tools } = await client.listTools();
    for (const name of ["create_category", "update_category"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.properties).toHaveProperty("color");
    }
    expect(tools.find((t) => t.name === "update_category")!.annotations?.idempotentHint).toBe(true);
    expect(
      tools.find((t) => t.name === "update_category")!.inputSchema.properties,
    ).not.toHaveProperty("groupId");
  });
});

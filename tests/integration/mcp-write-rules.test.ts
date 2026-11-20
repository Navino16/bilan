import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { buildMcpServer } from "@/server/mcp/server";
import { mcpLimiterKey, type McpPrincipal } from "@/server/mcp/context";
import {
  cleanupMcpFixture,
  createMcpFixture,
  expense,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpwrule";
const now = new Date();

let f: McpFixture;
let client: Client;
let close: () => Promise<void>;
let mine = "";
let foreignCategory = "";
let foreignGroup = "";

const principal = (): McpPrincipal => ({
  ...mcpPrincipal(f.memberId),
  scopes: ["bilan:read", "bilan:write"],
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
  return rows;
};
const ruleCount = () =>
  db.categorizationRule.count({ where: { OR: [{ userId: f.memberId }, { groupId: f.groupId }] } });

async function connect(p: McpPrincipal) {
  const server = buildMcpServer(p);
  const c = new Client({ name: "bilan-test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await c.connect(clientSide);
  return {
    client: c,
    close: async () => {
      await c.close();
      await server.close();
    },
  };
}

beforeAll(async () => {
  f = await createMcpFixture(PREFIX, now);
  mine = (await db.category.create({ data: { userId: f.memberId, name: "Mine" } })).id;
  foreignGroup = (
    await db.group.create({ data: { name: `${PREFIX} other`, createdById: f.ownerId } })
  ).id;
  await db.groupMember.create({
    data: { groupId: foreignGroup, userId: f.ownerId, role: "OWNER" },
  });
  foreignCategory = (await db.category.create({ data: { groupId: foreignGroup, name: "Theirs" } }))
    .id;
  ({ client, close } = await connect(principal()));
});

afterEach(() => mcpWriteLimiter.reset(mcpLimiterKey(principal())));

afterAll(async () => {
  await close();
  await db.auditLog.deleteMany({ where: { userId: { in: [f.ownerId, f.memberId] } } });
  await db.categorizationRule.deleteMany({
    where: { OR: [{ userId: f.memberId }, { groupId: f.groupId }] },
  });
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

describe("rule tools over MCP", () => {
  it("creates, updates, retargets, toggles and deletes a personal rule", async () => {
    const created = ok(
      await call("create_rule", { pattern: "CAFE", matchType: "CONTAINS", categoryId: mine }),
    );
    expect(created).toEqual({ ok: true, id: expect.any(String) });
    expect(
      await db.categorizationRule.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      userId: f.memberId,
      groupId: null,
      pattern: "CAFE",
      caseSensitive: false,
      priority: 100,
      categoryId: mine,
    });
    await stamped("rule.created", created.id);

    ok(
      await call("update_rule", {
        id: created.id,
        pattern: "COFFEE",
        matchType: "STARTS_WITH",
        caseSensitive: true,
        priority: 300,
        categoryId: mine,
      }),
    );
    expect(
      await db.categorizationRule.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      pattern: "COFFEE",
      matchType: "STARTS_WITH",
      caseSensitive: true,
      priority: 300,
    });
    await stamped("rule.updated", created.id);

    ok(await call("retarget_rule", { id: created.id, categoryId: f.categoryId }));
    expect(
      await db.categorizationRule.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({ pattern: "COFFEE", priority: 300, categoryId: f.categoryId });
    expect((await stamped("rule.updated", created.id)).length).toBe(2);

    ok(await call("toggle_rule", { id: created.id, enabled: false }));
    expect(
      (await db.categorizationRule.findUniqueOrThrow({ where: { id: created.id } })).enabled,
    ).toBe(false);
    await stamped("rule.disabled", created.id);
    ok(await call("toggle_rule", { id: created.id, enabled: true }));
    await stamped("rule.enabled", created.id);

    ok(await call("delete_rule", { id: created.id }));
    expect(await db.categorizationRule.findUnique({ where: { id: created.id } })).toBeNull();
    await stamped("rule.deleted", created.id);
  });

  it("keeps omitted fields on update_rule and resets caseSensitive and priority with null", async () => {
    const id = ok(
      await call("create_rule", {
        pattern: "BAKERY",
        matchType: "STARTS_WITH",
        caseSensitive: true,
        priority: 37,
        categoryId: mine,
      }),
    ).id;
    const rule = () => db.categorizationRule.findUniqueOrThrow({ where: { id } });

    ok(await call("update_rule", { id, pattern: "BOULANGERIE" }));
    expect(await rule()).toMatchObject({
      pattern: "BOULANGERIE",
      matchType: "STARTS_WITH",
      caseSensitive: true,
      priority: 37,
      categoryId: mine,
    });

    ok(await call("update_rule", { id, caseSensitive: null, priority: null }));
    expect(await rule()).toMatchObject({
      pattern: "BOULANGERIE",
      matchType: "STARTS_WITH",
      caseSensitive: false,
      priority: 100,
      categoryId: mine,
    });
    await db.categorizationRule.delete({ where: { id } });
  });

  it("rejects an invalid regex with INVALID_REGEX", async () => {
    const before = await ruleCount();
    const res = await call("create_rule", { pattern: "(", matchType: "REGEX", categoryId: mine });
    failed(res, "INVALID_INPUT");
    expect(detailOf(res)).toBe("INVALID_REGEX");
    expect(await ruleCount()).toBe(before);
  });

  it("refuses a household rule to a plain member, leaving it unchanged", async () => {
    const rule = await db.categorizationRule.create({
      data: {
        pattern: "MARKET",
        matchType: "CONTAINS",
        categoryId: f.categoryId,
        groupId: f.groupId,
      },
    });
    const before = await ruleCount();
    failed(
      await call("create_rule", {
        pattern: "X",
        matchType: "CONTAINS",
        categoryId: f.categoryId,
        groupId: f.groupId,
      }),
      "FORBIDDEN",
    );
    expect(await ruleCount()).toBe(before);
    failed(
      await call("update_rule", {
        id: rule.id,
        pattern: "HIJACKED",
        matchType: "CONTAINS",
        categoryId: f.categoryId,
      }),
      "FORBIDDEN",
    );
    failed(await call("retarget_rule", { id: rule.id, categoryId: mine }), "FORBIDDEN");
    failed(await call("toggle_rule", { id: rule.id, enabled: false }), "FORBIDDEN");
    failed(await call("delete_rule", { id: rule.id }), "FORBIDDEN");
    failed(await call("apply_rules", { ruleIds: [rule.id] }), "FORBIDDEN");
    expect(await db.categorizationRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject(
      { pattern: "MARKET", categoryId: f.categoryId, enabled: true },
    );
    await db.categorizationRule.delete({ where: { id: rule.id } });
  });

  it("rejects a category of a household the user isn't in with INVALID_CATEGORY", async () => {
    const before = await ruleCount();
    const res = await call("create_rule", {
      pattern: "X",
      matchType: "CONTAINS",
      categoryId: foreignCategory,
    });
    failed(res, "INVALID_INPUT");
    expect(detailOf(res)).toBe("INVALID_CATEGORY");
    expect(await ruleCount()).toBe(before);
  });

  it("rejects out-of-range priority, unknown match type and unknown keys", async () => {
    const before = await ruleCount();
    const base = { pattern: "X", matchType: "CONTAINS", categoryId: mine };
    failed(await call("create_rule", { ...base, priority: 10001 }), "INVALID_INPUT");
    failed(await call("create_rule", { ...base, matchType: "FUZZY" }), "INVALID_INPUT");
    failed(await call("create_rule", { ...base, bogus: 1 }), "INVALID_INPUT");
    failed(await call("apply_rules", { ruleIds: [] }), "INVALID_INPUT");
    expect(await ruleCount()).toBe(before);
  });

  it("previews and applies only on the MCP write set, skipping manual rows", async () => {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 12, 12));
    const manual = await expense(f.accounts.own, day, -5, f.categoryId);
    await db.transaction.update({ where: { id: manual }, data: { manuallyCategorized: true } });
    const rule = ok(
      await call("create_rule", { pattern: "SHOP", matchType: "CONTAINS", categoryId: mine }),
    ).id;
    await db.auditLog.deleteMany({ where: { userId: f.memberId, action: "rule.applied" } });

    const preview = ok(await call("preview_rules_application", { ruleIds: [rule] }));
    expect(preview).toMatchObject({ moving: 1, manual: 1 });
    expect(await db.transaction.count({ where: { categoryId: mine } })).toBe(0);

    expect(ok(await call("apply_rules", { ruleIds: [rule] }))).toEqual({
      ok: true,
      reclassified: 1,
    });
    const categoryOf = async (id: string) =>
      (await db.transaction.findUniqueOrThrow({ where: { id } })).categoryId;
    expect(await categoryOf(f.expenses.own)).toBe(mine);
    for (const id of [f.expenses.sharedPlain, f.expenses.sharedAi, manual]) {
      expect(await categoryOf(id)).toBe(f.categoryId);
    }
    const applied = await stamped("rule.applied", rule);
    expect(applied).toHaveLength(1);
    expect(applied[0].metadata).toMatchObject({ reclassified: 1 });
  });

  it("applies on an account shared with WRITE and AI assistants allowed", async () => {
    const target = (await db.category.create({ data: { userId: f.memberId, name: "Shops" } })).id;
    const share = { accountId: f.accounts.sharedPlain, groupId: f.groupId };
    await db.accountShare.update({
      where: { accountId_groupId: share },
      data: { allowAiAssistants: true },
    });
    try {
      const rule = ok(
        await call("create_rule", { pattern: "SHOP", matchType: "CONTAINS", categoryId: target }),
      ).id;
      ok(await call("apply_rules", { ruleIds: [rule] }));
      const categoryOf = async (id: string) =>
        (await db.transaction.findUniqueOrThrow({ where: { id } })).categoryId;
      expect(await categoryOf(f.expenses.sharedPlain)).toBe(target);
      expect(await categoryOf(f.expenses.own)).toBe(target);
      expect(await categoryOf(f.expenses.sharedAi)).toBe(f.categoryId);
    } finally {
      await db.accountShare.update({
        where: { accountId_groupId: share },
        data: { allowAiAssistants: false },
      });
    }
  });

  it("lists preview_rules_application but not apply_rules to a read-only client", async () => {
    const ro = await connect(mcpPrincipal(f.memberId));
    try {
      const names = (await ro.client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("preview_rules_application");
      expect(names).not.toContain("apply_rules");
      expect(names).not.toContain("create_rule");
    } finally {
      await ro.close();
    }
  });

  it("serialises the tool schemas with their hints", async () => {
    const { tools } = await client.listTools();
    const tool = (name: string) => {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      return t!;
    };
    for (const name of ["create_rule", "update_rule"]) {
      expect(tool(name).inputSchema.properties).toHaveProperty("priority");
    }
    expect(tool("update_rule").inputSchema.properties).not.toHaveProperty("groupId");
    expect(tool("toggle_rule").annotations?.idempotentHint).toBe(true);
    expect(tool("retarget_rule").annotations?.idempotentHint).toBe(true);
    expect(tool("delete_rule").annotations?.destructiveHint).toBe(true);
    expect(tool("apply_rules").annotations?.destructiveHint).toBe(true);
    expect(tool("preview_rules_application").annotations?.readOnlyHint).toBe(true);
  });
});

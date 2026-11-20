import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { buildMcpServer } from "@/server/mcp/server";
import { mcpLimiterKey, type McpPrincipal } from "@/server/mcp/context";
import { listMcpActivity } from "@/server/mcp/activity";
import { loadAliases, renameMerchant, renameAliasGroup } from "@/server/services/merchants";
import {
  getExceptionalRule,
  getLinkSuggestionSettings,
  updateExceptionalRule,
  updateLinkSuggestionSettings,
} from "@/server/services/users/preferences";
import {
  cleanupMcpFixture,
  createMcpFixture,
  mcpPrincipal,
  type McpFixture,
} from "./support/mcp-fixtures";

const PREFIX = "mcpwset";
const now = new Date();

let f: McpFixture;
let client: Client;
let close: () => Promise<void>;

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
const rows = (action: string) =>
  db.auditLog.findMany({ where: { userId: f.memberId, action }, orderBy: { createdAt: "asc" } });
const stamped = async (action: string, entityId: string) => {
  const found = (await rows(action)).filter((r) => r.entityId === entityId);
  expect(found.length, action).toBeGreaterThan(0);
  for (const r of found)
    expect(r.metadata).toMatchObject({ via: "mcp", client: { kind: "token" } });
  return found;
};
const auditCount = () => db.auditLog.count({ where: { userId: f.memberId } });

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
  ({ client, close } = await connect(principal()));
});

afterEach(() => mcpWriteLimiter.reset(mcpLimiterKey(principal())));

afterAll(async () => {
  await close();
  await db.auditLog.deleteMany({ where: { userId: { in: [f.ownerId, f.memberId] } } });
  await db.merchantAlias.deleteMany({ where: { userId: f.memberId } });
  await db.userPreference.deleteMany({ where: { userId: f.memberId } });
  await cleanupMcpFixture(PREFIX);
  await db.$disconnect();
});

describe("merchant tools over MCP", () => {
  it("renames by key and by group, resets a name and removes an alias", async () => {
    ok(await call("rename_merchant", { key: "CARTE LIDL 12", name: "Lidl" }));
    expect((await loadAliases(f.memberId)).get("CARTE LIDL 12")).toBe("Lidl");
    await stamped("merchant.renamed", "Lidl");

    ok(await call("rename_merchant", { key: "LIDL PARIS", name: "Lidl" }));
    ok(await call("rename_merchant", { from: "Lidl", name: "Lidl Market" }));
    const aliases = await loadAliases(f.memberId);
    expect(aliases.get("CARTE LIDL 12")).toBe("Lidl Market");
    expect(aliases.get("LIDL PARIS")).toBe("Lidl Market");
    const [group] = await stamped("merchant.renamed", "Lidl Market");
    expect(group.metadata).toMatchObject({ from: "Lidl" });

    ok(await call("remove_merchant_alias", { key: "lidl paris" }));
    expect((await loadAliases(f.memberId)).has("LIDL PARIS")).toBe(false);
    await stamped("merchant.alias_removed", "LIDL PARIS");

    ok(await call("reset_merchant_name", { name: "Lidl Market" }));
    expect((await loadAliases(f.memberId)).size).toBe(0);
    await stamped("merchant.reset", "Lidl Market");
  });

  it("refuses both or neither of key and from, writing nothing", async () => {
    const before = await auditCount();
    failed(await call("rename_merchant", { key: "A", from: "B", name: "C" }), "INVALID_INPUT");
    failed(await call("rename_merchant", { name: "C" }), "INVALID_INPUT");
    expect(await auditCount()).toBe(before);
    expect((await loadAliases(f.memberId)).size).toBe(0);
  });

  it("answers NOT_FOUND for an unknown alias", async () => {
    const before = await auditCount();
    failed(await call("reset_merchant_name", { name: "Nowhere" }), "NOT_FOUND");
    failed(await call("remove_merchant_alias", { key: "NOWHERE" }), "NOT_FOUND");
    failed(await call("rename_merchant", { from: "Nowhere", name: "X" }), "NOT_FOUND");
    expect(await auditCount()).toBe(before);
  });
});

describe("preference tools over MCP", () => {
  it("updates the link settings and the exceptional rule", async () => {
    const link = ok(await call("update_link_settings", { windowDays: 7, minAmount: 12.5 }));
    expect(link).toMatchObject({ ok: true, settings: { windowDays: 7, minAmount: 12.5 } });
    expect(await getLinkSuggestionSettings(f.memberId)).toEqual({ windowDays: 7, minAmount: 12.5 });
    await stamped("preferences.link_settings_updated", f.memberId);

    const exc = ok(await call("update_exceptional_rule", { minAmount: 80, factor: 2.5 }));
    expect(exc).toMatchObject({ ok: true, settings: { minAmount: 80, factor: 2.5 } });
    expect(await getExceptionalRule(f.memberId)).toEqual({ minAmount: 80, factor: 2.5 });
    await stamped("preferences.exceptional_updated", f.memberId);
  });

  it("rejects out-of-range values, leaving the settings unchanged", async () => {
    const before = await auditCount();
    failed(
      await call("update_link_settings", { windowDays: 100000, minAmount: 1 }),
      "INVALID_INPUT",
    );
    failed(await call("update_exceptional_rule", { minAmount: 1, factor: 999 }), "INVALID_INPUT");
    expect(await getLinkSuggestionSettings(f.memberId)).toEqual({ windowDays: 7, minAmount: 12.5 });
    expect(await getExceptionalRule(f.memberId)).toEqual({ minAmount: 80, factor: 2.5 });
    expect(await auditCount()).toBe(before);
  });

  it("keeps the stored locale of an existing row", async () => {
    await db.userPreference.update({ where: { userId: f.memberId }, data: { locale: "en" } });
    ok(await call("update_link_settings", { windowDays: 9, minAmount: 0 }));
    expect(
      (await db.userPreference.findUniqueOrThrow({ where: { userId: f.memberId } })).locale,
    ).toBe("en");
  });
});

describe("audit of app-side edits and the activity list", () => {
  it("audits the same service calls without via, and lists only the MCP ones", async () => {
    await db.auditLog.deleteMany({ where: { userId: f.memberId } });
    await renameMerchant(f.memberId, "APP KEY", "App Name");
    await renameAliasGroup(f.memberId, "App Name", "App Name 2");
    await updateLinkSuggestionSettings(f.memberId, { windowDays: 5, minAmount: 1 }, "fr");
    await updateExceptionalRule(f.memberId, { minAmount: 10, factor: 2 }, "fr");
    for (const r of await db.auditLog.findMany({ where: { userId: f.memberId } }))
      expect(r.metadata).not.toHaveProperty("via");
    expect(await rows("merchant.renamed")).toHaveLength(2);
    expect(await listMcpActivity(f.memberId)).toEqual([]);

    ok(await call("rename_merchant", { from: "App Name 2", name: "Mcp Name" }));
    ok(await call("update_link_settings", { windowDays: 6, minAmount: 2 }));
    const activity = await listMcpActivity(f.memberId);
    expect(activity.map((a) => a.action).sort()).toEqual([
      "merchant.renamed",
      "preferences.link_settings_updated",
    ]);
    expect(activity.find((a) => a.action === "merchant.renamed")?.target).toEqual({
      text: "Mcp Name",
      href: null,
    });
    expect(
      activity.find((a) => a.action === "preferences.link_settings_updated")?.target,
    ).toBeNull();
  });
});

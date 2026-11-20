import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { db } from "@/server/db";
import { mcpWriteLimiter } from "@/server/auth/rate-limit";
import { buildMcpServer } from "@/server/mcp/server";
import { mcpLimiterKey, type McpPrincipal } from "@/server/mcp/context";
import { listMcpActivity } from "@/server/mcp/activity";
import { hashMerchantKey } from "@/server/services/transactions/secure-fields";
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
    await stamped("merchant.renamed", hashMerchantKey("CARTE LIDL 12"));

    ok(await call("rename_merchant", { key: "LIDL PARIS", name: "Lidl" }));
    ok(await call("rename_merchant", { from: "Lidl", name: "Lidl Market" }));
    const aliases = await loadAliases(f.memberId);
    expect(aliases.get("CARTE LIDL 12")).toBe("Lidl Market");
    expect(aliases.get("LIDL PARIS")).toBe("Lidl Market");
    await stamped("merchant.renamed", hashMerchantKey("CARTE LIDL 12"));

    ok(await call("remove_merchant_alias", { key: "lidl paris" }));
    expect((await loadAliases(f.memberId)).has("LIDL PARIS")).toBe(false);
    await stamped("merchant.alias_removed", hashMerchantKey("LIDL PARIS"));

    ok(await call("reset_merchant_name", { name: "Lidl Market" }));
    expect((await loadAliases(f.memberId)).size).toBe(0);
    await stamped("merchant.reset", hashMerchantKey("CARTE LIDL 12"));
  });

  it("keeps merchant names and keys out of the audit rows and resolves the live name", async () => {
    ok(await call("rename_merchant", { key: "SECRETSHOP 42", name: "Secret Shop" }));
    ok(await call("rename_merchant", { from: "Secret Shop", name: "Hidden Store" }));
    const logged = await db.auditLog.findMany({
      where: { userId: f.memberId, entity: "MerchantAlias" },
    });
    expect(logged.length).toBeGreaterThanOrEqual(2);
    for (const r of logged) {
      const text = JSON.stringify([r.entityId, r.metadata]).toLowerCase();
      for (const secret of ["secretshop", "secret shop", "hidden store"])
        expect(text).not.toContain(secret);
    }
    const live = (await listMcpActivity(f.memberId)).find(
      (a) => a.entityId === hashMerchantKey("SECRETSHOP 42"),
    );
    expect(live?.target).toEqual({ text: "Hidden Store", href: null });

    ok(await call("reset_merchant_name", { name: "Hidden Store" }));
    const after = (await listMcpActivity(f.memberId)).filter(
      (a) => a.entityId === hashMerchantKey("SECRETSHOP 42"),
    );
    expect(after.length).toBeGreaterThan(0);
    for (const a of after) expect(a.target).toBeNull();
  });

  it("removes an alias whose key is 200 characters long", async () => {
    const key = "K".repeat(200);
    ok(await call("rename_merchant", { key, name: "Long Key" }));
    ok(await call("remove_merchant_alias", { key }));
    await stamped("merchant.alias_removed", hashMerchantKey(key));
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
    expect(await rows("preferences.link_settings_updated")).toHaveLength(1);
    expect(await rows("preferences.exceptional_updated")).toHaveLength(1);
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

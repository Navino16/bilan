import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";

// The Server Actions read the session through next/headers.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { changePasswordLimiter } from "@/server/auth/rate-limit";
import { appSettings } from "@/server/services/settings/app-settings";
import { getMcpEnabled } from "@/server/services/users/preferences";
import { RECENT_SIGN_IN_MS } from "@/server/services/users/step-up";
import { createMcpToken, listMcpTokens } from "@/server/mcp/tokens";
import {
  createMcpTokenAction,
  revokeMcpTokenAction,
  revokeOAuthGrantAction,
  setMcpEnabledAction,
} from "@/server/transport/actions/mcp";
import { listOAuthGrants } from "@/server/mcp/oauth-grants";
import { snapshotSetting } from "./support/app-setting-snapshot";

vi.setConfig({ testTimeout: 20_000 });

const tag = `mcp-actions-${Date.now()}`;
const email = `${tag}@bilan.local`;
const password = "mcp-actions-password-123";
const otherId = `${tag}-other`;
const readInput = { name: "Claude Code", scope: "read", expiresInDays: "never" };

let userId: string;
let restoreSetting: () => Promise<void>;

async function signIn(): Promise<void> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  request.headers = new Headers({ cookie, "x-forwarded-for": "203.0.113.7" });
}

async function ageSessions(): Promise<void> {
  const stale = new Date(Date.now() - RECENT_SIGN_IN_MS - 60_000);
  await db.session.updateMany({ where: { userId }, data: { createdAt: stale } });
}

async function setInstance(enabled: boolean): Promise<void> {
  await appSettings.set("mcp_enabled", enabled, userId);
}

beforeAll(async () => {
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "MCP" } })).user.id;
  await db.user.create({ data: { id: otherId, email: `${otherId}@bilan.local` } });
  restoreSetting = await snapshotSetting("mcp_enabled");
});

beforeEach(async () => {
  changePasswordLimiter.reset(userId);
  await db.mcpToken.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  await db.userPreference.deleteMany({ where: { userId } });
  await db.auditLog.deleteMany({ where: { userId } });
  await signIn();
});

afterAll(async () => {
  changePasswordLimiter.reset(userId);
  await restoreSetting();
  await db.auditLog.deleteMany({
    where: { OR: [{ userId: { in: [userId, otherId] } }, { entityId: "mcp_enabled" }] },
  });
  await db.mcpToken.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  await db.verification.deleteMany({ where: { value: userId } });
  await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await db.$disconnect();
});

describe("setMcpEnabledAction", () => {
  it("refuses to turn MCP on while the instance switch is off", async () => {
    await setInstance(false);
    expect(await setMcpEnabledAction(true, "fr")).toEqual({
      ok: false,
      error: "INSTANCE_DISABLED",
    });
    expect(await getMcpEnabled(userId)).toBe(false);
  });

  it("turns MCP on and off once the instance allows it, audited", async () => {
    await setInstance(true);
    expect(await setMcpEnabledAction(true, "fr")).toEqual({ ok: true });
    expect(await getMcpEnabled(userId)).toBe(true);
    await setInstance(false);
    expect(await setMcpEnabledAction(false, "fr")).toEqual({ ok: true });
    expect(await getMcpEnabled(userId)).toBe(false);
    const audits = await db.auditLog.findMany({
      where: { userId, action: { in: ["mcp.enabled", "mcp.disabled"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual(["mcp.enabled", "mcp.disabled"]);
  });

  it("rejects a non-boolean value", async () => {
    await setInstance(true);
    expect(await setMcpEnabledAction("yes" as unknown as boolean, "fr")).toEqual({
      ok: false,
      error: "FAILED",
    });
    expect(await getMcpEnabled(userId)).toBe(false);
  });
});

describe("createMcpTokenAction", () => {
  it("creates a token right after sign-in, without asking for the password", async () => {
    const res = await createMcpTokenAction(readInput);
    expect(res).toMatchObject({ ok: true });
    const token = res.ok ? res.token : "";
    expect(token.startsWith("bilan_pat_")).toBe(true);
    const [row] = await listMcpTokens(userId);
    expect(row).toMatchObject({ name: "Claude Code", scope: "read", expiresAt: null });
    expect(token.startsWith(row.prefix)).toBe(true);
  });

  it("asks an older session for the password, then creates the token with it", async () => {
    await ageSessions();
    expect(await createMcpTokenAction(readInput)).toEqual({
      ok: false,
      error: "REAUTH_REQUIRED",
      method: "PASSWORD",
    });
    expect(await createMcpTokenAction(readInput, "wrong-password")).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
    });
    expect(await listMcpTokens(userId)).toHaveLength(0);
    const failed = await db.auditLog.findMany({
      where: { userId, action: "mcp.token.create_failed" },
    });
    expect(failed.map((a) => a.metadata)).toEqual([{ reason: "bad_password" }]);

    const res = await createMcpTokenAction(readInput, password);
    expect(res).toMatchObject({ ok: true });
    expect(res.ok && res.token.startsWith("bilan_pat_")).toBe(true);
    expect(await listMcpTokens(userId)).toHaveLength(1);
  });

  it("sets the expiry from the chosen number of days", async () => {
    const before = Date.now();
    const res = await createMcpTokenAction({ name: "Codex", scope: "write", expiresInDays: "30" });
    expect(res).toMatchObject({ ok: true });
    const [row] = await listMcpTokens(userId);
    expect(row.scope).toBe("write");
    const days = (row.expiresAt!.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(30);
    expect(days).toBeLessThan(30.01);
  });

  it("reports invalid fields before asking for the password", async () => {
    await ageSessions();
    expect(await createMcpTokenAction({ name: "  ", scope: "admin", expiresInDays: "7" })).toEqual({
      ok: false,
      error: "INVALID",
      fieldErrors: { name: "REQUIRED", scope: "INVALID", expiresInDays: "INVALID" },
    });
    expect(
      await createMcpTokenAction({ ...readInput, name: "x".repeat(81) }, password),
    ).toMatchObject({ ok: false, error: "INVALID", fieldErrors: { name: "TOO_LONG" } });
    expect(await listMcpTokens(userId)).toHaveLength(0);
  });
});

describe("revokeMcpTokenAction", () => {
  it("revokes one of the user's tokens", async () => {
    const { id } = await createMcpToken(userId, { name: "Mine", scope: "read" });
    expect(await revokeMcpTokenAction(id)).toEqual({ ok: true });
    expect(await listMcpTokens(userId)).toHaveLength(0);
  });

  it("answers NOT_FOUND for another user's token and leaves it active", async () => {
    const { id } = await createMcpToken(otherId, { name: "Theirs", scope: "read" });
    expect(await revokeMcpTokenAction(id)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await listMcpTokens(otherId)).toHaveLength(1);
  });

  it("answers NOT_FOUND for a malformed id", async () => {
    expect(await revokeMcpTokenAction(42 as unknown as string)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});

describe("revokeOAuthGrantAction", () => {
  const clientIds = [`${tag}-mine`, `${tag}-theirs`];

  async function grant(clientId: string, owner: string): Promise<void> {
    const now = new Date();
    await db.oauthClient.upsert({
      where: { clientId },
      update: {},
      create: {
        id: clientId,
        clientId,
        name: clientId,
        redirectUris: JSON.stringify(["http://127.0.0.1:43123/callback"]),
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.oauthConsent.create({
      data: {
        id: `${clientId}-${owner}`,
        clientId,
        userId: owner,
        scopes: JSON.stringify(["bilan:read"]),
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  afterAll(async () => {
    await db.oauthClient.deleteMany({ where: { clientId: { in: clientIds } } });
  });

  it("revokes one of the user's clients", async () => {
    await grant(clientIds[0], userId);
    expect(await revokeOAuthGrantAction(clientIds[0])).toEqual({ ok: true });
    expect(await listOAuthGrants(userId)).toHaveLength(0);
  });

  it("answers NOT_FOUND for another user's client and leaves it connected", async () => {
    await grant(clientIds[1], otherId);
    expect(await revokeOAuthGrantAction(clientIds[1])).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await listOAuthGrants(otherId)).toHaveLength(1);
  });

  it("answers NOT_FOUND for an over-long or malformed id", async () => {
    expect(await revokeOAuthGrantAction("x".repeat(300))).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await revokeOAuthGrantAction(42 as unknown as string)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});

describe("unexpected revoke failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["token", () => vi.spyOn(db.mcpToken, "updateMany"), () => revokeMcpTokenAction("any-id")],
    [
      "OAuth client",
      () => vi.spyOn(db.oauthClient, "findUnique"),
      () => revokeOAuthGrantAction("any-id"),
    ],
  ] as const)("logs the error and answers FAILED for a %s", async (_label, spy, run) => {
    spy().mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run()).toEqual({ ok: false, error: "FAILED" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[bilan]"), "Error");
  });
});

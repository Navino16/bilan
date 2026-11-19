import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const notify = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/mail/security-notifications", () => ({
  notifySecurityEvent: notify,
}));
type Mail = { to: string; subject: string; text: string };
const sent = vi.hoisted(() => [] as Mail[]);
vi.mock("@/server/services/mail/mailer", () => ({
  sendMail: async (mail: Mail) => {
    sent.push(mail);
    return { delivered: true };
  },
}));
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { appSettings } from "@/server/services/settings/app-settings";
import { changePassword } from "@/server/services/users/password";
import { revokeOtherSessions } from "@/server/services/users/sessions";
import { setMcpEnabled, PreferenceInputError } from "@/server/services/users/preferences";
import {
  MCP_TOKEN_PREFIX,
  createMcpToken,
  listMcpTokens,
  principalFromToken,
  revokeAllMcpTokens,
  revokeMcpToken,
} from "@/server/mcp/tokens";

const stamp = Date.now();
const email = `mcptok+${stamp}@bilan.local`;
const otherEmail = `mcptok-other+${stamp}@bilan.local`;
const password = "original-strong-password-1";
const newPassword = "brand-new-strong-password-2";
let userId: string;
let otherId: string;

async function signIn(): Promise<Headers> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie, "x-forwarded-for": "203.0.113.9" });
}

const enable = () => setMcpEnabled(userId, true, "en");
const mk = (scope: "read" | "write" = "read") => createMcpToken(userId, { name: "t", scope });

beforeAll(async () => {
  const auth = await getAuth();
  userId = (await auth.api.signUpEmail({ body: { email, password, name: "Mcp Tok" } })).user.id;
  otherId = (await auth.api.signUpEmail({ body: { email: otherEmail, password, name: "Other" } }))
    .user.id;
  await db.userPreference.updateMany({ where: { userId }, data: { locale: "en" } });
  await enable();
  await setMcpEnabled(otherId, true, "en");
  await appSettings.set("mcp_enabled", true, userId);
});

afterEach(async () => {
  await db.mcpToken.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  await db.user.update({ where: { id: userId }, data: { banned: false } });
  await enable();
  await appSettings.set("mcp_enabled", true, userId);
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  await db.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
  await db.$disconnect();
});

describe("create / list / revoke", () => {
  it("creates a bilan_pat_ token stored only as a hash, and audits it", async () => {
    const { id, token, prefix } = await createMcpToken(
      userId,
      { name: "Claude", scope: "write" },
      { ipAddress: "203.0.113.7", userAgent: "vitest", via: "password" },
    );
    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBe(MCP_TOKEN_PREFIX.length + 43);
    expect(prefix).toBe(token.slice(0, 16));
    const row = await db.mcpToken.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).not.toContain(token);
    expect(row.scope).toBe("write");
    const audits = await db.auditLog.findMany({
      where: { userId, action: "mcp.token.created", entityId: id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ ipAddress: "203.0.113.7", userAgent: "vitest" });
    expect(audits[0].metadata).toMatchObject({ name: "Claude", scope: "write", via: "password" });
  });

  it("lists only the user's non-revoked tokens, without secrets", async () => {
    const a = await mk();
    const b = await mk();
    await createMcpToken(otherId, { name: "x", scope: "read" });
    await revokeMcpToken(userId, b.id);
    const list = await listMcpTokens(userId);
    expect(list.map((t) => t.id)).toEqual([a.id]);
    expect(Object.keys(list[0]).sort()).toEqual(
      ["createdAt", "expired", "expiresAt", "id", "lastUsedAt", "name", "prefix", "scope"].sort(),
    );
  });

  it("flags the tokens past their expiry", async () => {
    const lapsed = await mk();
    const live = await createMcpToken(userId, {
      name: "t",
      scope: "read",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.mcpToken.update({
      where: { id: lapsed.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const list = await listMcpTokens(userId);
    expect(Object.fromEntries(list.map((t) => [t.id, t.expired]))).toEqual({
      [lapsed.id]: true,
      [live.id]: false,
    });
  });

  it("revokes only own tokens", async () => {
    const mine = await mk();
    const theirs = await createMcpToken(otherId, { name: "x", scope: "read" });
    await expect(revokeMcpToken(userId, theirs.id)).rejects.toThrow("NOT_FOUND");
    await expect(revokeMcpToken(userId, "nope")).rejects.toThrow("NOT_FOUND");
    await revokeMcpToken(userId, mine.id);
    expect(await principalFromToken(mine.token)).toBeNull();
    expect(await principalFromToken(theirs.token)).not.toBeNull();
    expect(
      await db.auditLog.count({
        where: { userId, action: "mcp.token.revoked", entityId: mine.id },
      }),
    ).toBe(1);
  });

  it("revokeAllMcpTokens revokes every token and audits the reason", async () => {
    const a = await mk();
    const b = await mk("write");
    const other = await createMcpToken(otherId, { name: "x", scope: "read" });
    expect(await revokeAllMcpTokens(userId, "password")).toBe(2);
    expect(await principalFromToken(a.token)).toBeNull();
    expect(await principalFromToken(b.token)).toBeNull();
    expect(await principalFromToken(other.token)).not.toBeNull();
    const audit = await db.auditLog.findFirstOrThrow({
      where: { userId, action: "mcp.token.revoked_all" },
    });
    expect(audit.metadata).toMatchObject({ reason: "password" });
    expect(await revokeAllMcpTokens(userId, "sessions")).toBe(0);
    expect(
      await db.auditLog.count({
        where: {
          userId,
          action: "mcp.token.revoked_all",
          metadata: { path: "$.reason", equals: "sessions" },
        },
      }),
    ).toBe(0);
  });
});

describe("validation", () => {
  const fieldErrors = async (input: Parameters<typeof createMcpToken>[1]) => {
    try {
      await createMcpToken(userId, input);
    } catch (e) {
      if (e instanceof PreferenceInputError) return e.fieldErrors;
      throw e;
    }
    return null;
  };

  it("rejects bad input with field errors", async () => {
    expect(await fieldErrors({ name: "  ", scope: "read" })).toEqual({ name: "REQUIRED" });
    expect(await fieldErrors({ name: "x".repeat(81), scope: "read" })).toEqual({
      name: "TOO_LONG",
    });
    expect(await fieldErrors({ name: "ok", scope: "admin" as never })).toEqual({
      scope: "INVALID",
    });
    expect(
      await fieldErrors({ name: "ok", scope: "read", expiresAt: new Date(Date.now() - 1000) }),
    ).toEqual({ expiresAt: "PAST" });
    expect(await db.mcpToken.count({ where: { userId } })).toBe(0);
  });
});

describe("principalFromToken", () => {
  it("maps scopes and client, and rejects unknown tokens", async () => {
    const r = await mk("read");
    const w = await mk("write");
    expect(await principalFromToken(r.token)).toEqual({
      userId,
      scopes: ["bilan:read"],
      client: { kind: "token", id: r.id, name: "t" },
    });
    expect((await principalFromToken(w.token))?.scopes).toEqual(["bilan:read", "bilan:write"]);
    expect(await principalFromToken("bilan_pat_unknown")).toBeNull();
    expect(await principalFromToken("")).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const { id, token } = await mk();
    await db.mcpToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await principalFromToken(token)).toBeNull();
  });

  it("updates lastUsedAt at most once a minute", async () => {
    const { id, token } = await mk();
    await principalFromToken(token);
    const first = (await db.mcpToken.findUniqueOrThrow({ where: { id } })).lastUsedAt;
    expect(first).not.toBeNull();
    await principalFromToken(token);
    expect((await db.mcpToken.findUniqueOrThrow({ where: { id } })).lastUsedAt).toEqual(first);
    const old = new Date(Date.now() - 61_000);
    await db.mcpToken.update({ where: { id }, data: { lastUsedAt: old } });
    await principalFromToken(token);
    const after = (await db.mcpToken.findUniqueOrThrow({ where: { id } })).lastUsedAt!;
    expect(after.getTime()).toBeGreaterThan(old.getTime() + 30_000);
  });

  it("is off with the instance switch and survives it coming back", async () => {
    const { token } = await mk();
    await appSettings.set("mcp_enabled", false, userId);
    expect(await principalFromToken(token)).toBeNull();
    await appSettings.set("mcp_enabled", true, userId);
    expect(await principalFromToken(token)).not.toBeNull();
  });

  it("survives a user opt-out then opt-in", async () => {
    const { token } = await mk();
    await setMcpEnabled(userId, false, "en");
    expect(await principalFromToken(token)).toBeNull();
    await enable();
    expect(await principalFromToken(token)).not.toBeNull();
  });

  it("fails while the user is disabled, without revoking", async () => {
    const { token } = await mk();
    await db.user.update({ where: { id: userId }, data: { banned: true } });
    expect(await principalFromToken(token)).toBeNull();
    await db.user.update({ where: { id: userId }, data: { banned: false } });
    expect(await principalFromToken(token)).not.toBeNull();
  });
});

describe("credential lifecycle", () => {
  const passwordRevocations = () =>
    db.auditLog.count({
      where: {
        userId,
        action: "mcp.token.revoked_all",
        metadata: { path: "$.reason", equals: "password" },
      },
    });

  it("a password change revokes every token", async () => {
    const a = await mk();
    const b = await mk("write");
    const headers = await signIn();
    const before = await passwordRevocations();
    const res = await changePassword(headers, {
      currentPassword: password,
      newPassword,
      revokeOtherSessions: false,
    });
    expect(res.ok).toBe(true);
    expect(await principalFromToken(a.token)).toBeNull();
    expect(await principalFromToken(b.token)).toBeNull();
    expect(await passwordRevocations()).toBe(before + 1);
    // restore for the following tests
    const back = await changePassword(await signInWith(newPassword), {
      currentPassword: newPassword,
      newPassword: password,
      revokeOtherSessions: false,
    });
    expect(back.ok).toBe(true);
    // No token left to revoke: no audit row.
    expect(await passwordRevocations()).toBe(before + 1);
  });

  it("a password reset revokes every token", async () => {
    const a = await mk();
    const auth = await getAuth();
    const appUrl = process.env.APP_URL!.replace(/\/$/, "");
    sent.length = 0;
    await auth.api.requestPasswordReset({ body: { email, redirectTo: `${appUrl}/en/reset` } });
    const mail = await vi.waitFor(() => {
      const m = sent.find((x) => x.to === email && /reset your password/.test(x.subject));
      if (!m) throw new Error("reset mail not sent yet");
      return m;
    });
    const link = mail.text.split("\n").find((l) => l.startsWith(`${appUrl}/en/reset/`));
    const token = decodeURIComponent(link!.split("/").pop()!);
    await auth.api.resetPassword({ body: { newPassword: "reset-strong-password-3", token } });
    expect(await principalFromToken(a.token)).toBeNull();
    await auth.api.requestPasswordReset({ body: { email, redirectTo: `${appUrl}/en/reset` } });
  });

  it("revokeOtherSessions revokes every token", async () => {
    const a = await mk();
    const headers = await signInAny();
    const res = await revokeOtherSessions(headers);
    expect(res.ok).toBe(true);
    expect(await principalFromToken(a.token)).toBeNull();
  });
});

async function signInWith(pw: string): Promise<Headers> {
  const auth = await getAuth();
  const res = await auth.api.signInEmail({ body: { email, password: pw }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie, "x-forwarded-for": "203.0.113.9" });
}

async function signInAny(): Promise<Headers> {
  for (const pw of [password, "reset-strong-password-3", newPassword]) {
    try {
      return await signInWith(pw);
    } catch {
      /* try next */
    }
  }
  throw new Error("cannot sign in");
}

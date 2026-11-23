import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { getAuth } from "@/server/auth";
import { createSignupToken, consumeSignupToken } from "@/server/services/signup-tokens";

const actorId = "reg_mode_actor";

beforeAll(async () => {
  await db.session.deleteMany();
  await db.authAccount.deleteMany();
  await db.adminSignupToken.deleteMany();
  await db.user.deleteMany({ where: { email: { contains: "reg-mode" } } });
  await db.user.deleteMany({ where: { id: actorId } });
  await db.user.create({ data: { id: actorId, email: `reg-mode-actor@bilan.local` } });
});

afterAll(async () => {
  await db.adminSignupToken.deleteMany();
  await db.user.deleteMany({ where: { email: { contains: "reg-mode" } } });
  await db.user.deleteMany({ where: { id: actorId } });
  await db.$disconnect();
});

// Mirrors registerAction's mode branching (the action itself needs a request
// context, so the gate logic is exercised here against the real services).
async function tryRegister(email: string, mode: string, adminToken?: string) {
  if (mode === "DISABLED") return { ok: false, error: "DISABLED" as const };
  if (mode === "INVITE_ONLY") {
    if (!adminToken) return { ok: false, error: "TOKEN_REQUIRED" as const };
    const c = await consumeSignupToken(adminToken);
    if (!c.ok) return { ok: false, error: "BAD_TOKEN" as const };
  }
  const auth = await getAuth();
  await auth.api.signUpEmail({ body: { email, password: "p".repeat(12), name: "T" } });
  return { ok: true as const };
}

describe("registration modes", () => {
  it("OPEN allows signup without a token", async () => {
    const r = await tryRegister(`reg-mode-open+${Date.now()}@bilan.local`, "OPEN");
    expect(r.ok).toBe(true);
  });

  it("INVITE_ONLY rejects without a token", async () => {
    const r = await tryRegister(`reg-mode-io-no+${Date.now()}@bilan.local`, "INVITE_ONLY");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("TOKEN_REQUIRED");
  });

  it("INVITE_ONLY rejects an invalid token", async () => {
    const r = await tryRegister(`reg-mode-io-bad+${Date.now()}@bilan.local`, "INVITE_ONLY", "nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("BAD_TOKEN");
  });

  it("INVITE_ONLY allows signup with a valid admin token", async () => {
    const tok = await createSignupToken({ description: "io", maxUses: 1, createdById: actorId });
    const r = await tryRegister(
      `reg-mode-io-ok+${Date.now()}@bilan.local`,
      "INVITE_ONLY",
      tok.token,
    );
    expect(r.ok).toBe(true);
  });

  it("DISABLED rejects every signup", async () => {
    const r = await tryRegister(`reg-mode-dis+${Date.now()}@bilan.local`, "DISABLED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("DISABLED");
  });
});

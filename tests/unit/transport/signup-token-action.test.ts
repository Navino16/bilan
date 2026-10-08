import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/auth/permissions", () => ({
  getCurrentUser: async () => ({ id: "admin", email: "admin@bilan.local" }),
  hasPermission: async () => true,
}));
vi.mock("@/server/services/signup-tokens", () => ({
  createSignupToken: async () => {
    throw new Error("db down");
  },
  deleteSignupToken: async () => false,
  revokeSignupToken: async () => false,
}));
vi.mock("@/server/services/audit", () => ({ logEvent: vi.fn() }));

const { createSignupTokenAction } = await import("@/server/transport/actions/admin");

describe("createSignupTokenAction", () => {
  it("returns FAILED instead of throwing when the insert fails (#163)", async () => {
    const fd = new FormData();
    fd.set("description", "x");
    fd.set("maxUses", "5");
    fd.set("expiresInDays", "7");
    expect(await createSignupTokenAction(null, fd)).toEqual({ ok: false, error: "FAILED" });
  });
});

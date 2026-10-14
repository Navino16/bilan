import { describe, it, expect, vi, beforeEach } from "vitest";

const changePassword = vi.fn();
const verifyPassword = vi.fn();
const findCredential = vi.fn();
vi.mock("@/server/auth/permissions", () => ({
  requireSession: async () => ({ id: "u1", email: "u1@bilan.local" }),
}));
vi.mock("@/server/http/auth-headers", () => ({ authHeaders: async () => new Headers() }));
vi.mock("@/server/auth/rate-limit", () => {
  const open = { consume: () => ({ allowed: true }) };
  return {
    changePasswordLimiter: open,
    registerLimiter: open,
    resetLimiter: open,
    loginLimiter: open,
  };
});
vi.mock("@/server/services/users/password", () => ({ changePassword }));
vi.mock("@/server/services/settings/app-settings", () => ({
  appSettings: { get: async () => null },
  getMinPasswordLength: async () => 12,
}));
vi.mock("@/server/services/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/server/auth", () => ({ getAuth: async () => ({ api: { verifyPassword } }) }));
vi.mock("@/server/db", () => ({ db: { authAccount: { findFirst: findCredential } } }));
vi.mock("@/server/services/users/lifecycle", () => ({
  deleteOwnAccount: vi.fn(),
  UserAdminError: class extends Error {},
}));

const { changePasswordAction } = await import("@/server/transport/actions/auth");
const { deleteAccountAction } = await import("@/server/transport/actions/account-data");

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => vi.clearAllMocks());

describe("changePasswordAction server errors (#227)", () => {
  const input = form({
    currentPassword: "wrong-password",
    newPassword: "new-password-1234",
    confirmPassword: "new-password-1234",
    revokeOtherSessions: "true",
  });

  it("puts a wrong current password on the current-password field", async () => {
    changePassword.mockResolvedValue({ ok: false, error: "BAD_PASSWORD" });
    expect(await changePasswordAction(null, input)).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
      fieldErrors: { currentPassword: "BAD_PASSWORD" },
    });
  });

  it("puts an unchanged password on the new-password field", async () => {
    changePassword.mockResolvedValue({ ok: false, error: "SAME_PASSWORD" });
    expect(await changePasswordAction(null, input)).toMatchObject({
      fieldErrors: { newPassword: "SAME_PASSWORD" },
    });
  });

  it("checks the new password length on its field before calling the service", async () => {
    const withNew = (pw: string) =>
      form({
        currentPassword: "old-password-123",
        newPassword: pw,
        confirmPassword: pw,
        revokeOtherSessions: "true",
      });
    expect(await changePasswordAction(null, withNew("short-pw"))).toEqual({
      ok: false,
      error: "PASSWORD_TOO_SHORT",
      fieldErrors: { newPassword: "PASSWORD_TOO_SHORT" },
    });
    expect(await changePasswordAction(null, withNew("x".repeat(129)))).toEqual({
      ok: false,
      error: "PASSWORD_TOO_LONG",
      fieldErrors: { newPassword: "PASSWORD_TOO_LONG" },
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("keeps errors without a field as a form alert", async () => {
    changePassword.mockResolvedValue({ ok: false, error: "FAILED" });
    expect(await changePasswordAction(null, input)).toEqual({ ok: false, error: "FAILED" });
  });
});

describe("deleteAccountAction server errors (#227)", () => {
  it("puts a wrong password on the password field", async () => {
    findCredential.mockResolvedValue({ id: "acc" });
    verifyPassword.mockRejectedValue(new Error("INVALID_PASSWORD"));
    expect(await deleteAccountAction(null, form({ password: "nope" }))).toEqual({
      ok: false,
      error: "BAD_PASSWORD",
      fieldErrors: { password: "BAD_PASSWORD" },
    });
  });

  it("reports a missing password once, on the field", async () => {
    findCredential.mockResolvedValue({ id: "acc" });
    expect(await deleteAccountAction(null, form({}))).toEqual({
      ok: false,
      error: "REQUIRED",
      fieldErrors: { password: "REQUIRED" },
    });
  });

  it("puts a mismatching e-mail on the confirmation field (SSO-only account)", async () => {
    findCredential.mockResolvedValue(null);
    expect(await deleteAccountAction(null, form({ confirmEmail: "other@bilan.local" }))).toEqual({
      ok: false,
      error: "BAD_CONFIRM",
      fieldErrors: { confirmEmail: "BAD_CONFIRM" },
    });
  });
});

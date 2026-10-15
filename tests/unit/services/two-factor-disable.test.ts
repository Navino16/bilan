import { describe, it, expect, vi, beforeEach } from "vitest";
import { APIError } from "better-auth/api";

const api = vi.hoisted(() => ({
  verifyTOTP: vi.fn(),
  verifyBackupCode: vi.fn(),
  disableTwoFactor: vi.fn(),
}));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ getAuth: async () => ({ api }) }));
vi.mock("@/server/db", () => ({
  db: { user: { findUnique: async () => ({ twoFactorEnabled: true }) } },
}));
vi.mock("@/server/services/users/password", () => ({ isCurrentPassword: async () => true }));
vi.mock("@/server/services/audit", () => ({ logEvent }));

const { disableTwoFactor } = await import("@/server/services/users/two-factor");

const disable = (code = "123456") => disableTwoFactor(new Headers(), "user_1", "pw", code);
const badCodeAudited = () =>
  logEvent.mock.calls.some(
    ([e]) => (e as { metadata?: { reason?: string } }).metadata?.reason === "bad_code",
  );

describe("disableTwoFactor code check (#243)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    ["an invalid code (401)", new APIError("UNAUTHORIZED", { code: "INVALID_CODE" })],
    ["a missing TOTP setup (400)", new APIError("BAD_REQUEST", { code: "TOTP_NOT_ENABLED" })],
    ["a backup-code conflict (409)", new APIError("CONFLICT")],
    ["a concurrent backup-code use", { code: "P2025", meta: { modelName: "TwoFactor" } }],
  ])("reports %s as a bad code", async (_label, err) => {
    api.verifyTOTP.mockRejectedValueOnce(err);
    expect(await disable()).toEqual({ ok: false, error: "BAD_CODE" });
    expect(badCodeAudited()).toBe(true);
    expect(api.disableTwoFactor).not.toHaveBeenCalled();
  });

  it.each([
    ["a throttle (429)", new APIError("TOO_MANY_REQUESTS")],
    ["a server error (500)", new APIError("INTERNAL_SERVER_ERROR")],
    ["a database failure", new Error("connection lost")],
  ])("reports %s as a failure, not a bad code", async (_label, err) => {
    api.verifyBackupCode.mockRejectedValueOnce(err);
    expect(await disable("abcde-fghij")).toEqual({ ok: false, error: "FAILED" });
    expect(badCodeAudited()).toBe(false);
    expect(api.disableTwoFactor).not.toHaveBeenCalled();
  });
});

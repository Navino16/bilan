import { describe, it, expect, vi, beforeEach } from "vitest";
import { APIError } from "better-auth/api";

const api = vi.hoisted(() => ({
  verifyTOTP: vi.fn(),
  verifyBackupCode: vi.fn(),
  disableTwoFactor: vi.fn(),
  generateBackupCodes: vi.fn(),
  viewBackupCodes: vi.fn(),
}));
const twoFactorRows = vi.hoisted(() => ({ count: 1 }));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ getAuth: async () => ({ api }) }));
vi.mock("@/server/db", () => ({
  db: {
    user: { findUnique: async () => ({ twoFactorEnabled: true }) },
    twoFactor: { count: async () => twoFactorRows.count },
  },
}));
vi.mock("@/server/services/users/password", () => ({ isCurrentPassword: async () => true }));
vi.mock("@/server/services/audit", () => ({ logEvent }));

const { countBackupCodes, disableTwoFactor, regenerateBackupCodes } =
  await import("@/server/services/users/two-factor");

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

describe("regenerateBackupCodes (#256)", () => {
  const regenerate = (code = "123456") =>
    regenerateBackupCodes(new Headers(), "user_1", "pw", code);
  const audited = (action: string) =>
    logEvent.mock.calls.some(([e]) => (e as { action: string }).action === action);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("keeps the current codes when the second factor is refused", async () => {
    api.verifyBackupCode.mockRejectedValueOnce(new APIError("UNAUTHORIZED"));
    expect(await regenerate("abcde-fghij")).toEqual({ ok: false, error: "BAD_CODE" });
    expect(badCodeAudited()).toBe(true);
    expect(api.generateBackupCodes).not.toHaveBeenCalled();
  });

  it("returns the new codes and audits the regeneration", async () => {
    api.verifyTOTP.mockResolvedValueOnce({});
    api.generateBackupCodes.mockResolvedValueOnce({ backupCodes: ["aaaaa-bbbbb"] });
    expect(await regenerate()).toEqual({ ok: true, data: { backupCodes: ["aaaaa-bbbbb"] } });
    expect(audited("auth.2fa.backup_codes_regenerated")).toBe(true);
  });

  it("reports a generation failure without auditing a regeneration", async () => {
    api.verifyTOTP.mockResolvedValueOnce({});
    api.generateBackupCodes.mockRejectedValueOnce(new Error("connection lost"));
    expect(await regenerate()).toEqual({ ok: false, error: "FAILED" });
    expect(audited("auth.2fa.backup_codes_regenerated")).toBe(false);
  });
});

describe("countBackupCodes (#256)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    twoFactorRows.count = 1;
  });

  it("is null without a two-factor setup", async () => {
    twoFactorRows.count = 0;
    expect(await countBackupCodes("user_1")).toBeNull();
    expect(api.viewBackupCodes).not.toHaveBeenCalled();
  });

  it("counts the unused codes", async () => {
    api.viewBackupCodes.mockResolvedValueOnce({ backupCodes: ["a", "b"] });
    expect(await countBackupCodes("user_1")).toBe(2);
  });

  it("logs an unreadable set instead of passing it off as no setup", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    api.viewBackupCodes.mockRejectedValueOnce(new Error("bad key"));
    expect(await countBackupCodes("user_1")).toBeNull();
    expect(error).toHaveBeenCalledWith("[bilan] backup code count failed", expect.any(Error));
  });
});

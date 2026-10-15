import { beforeEach, describe, it, expect, vi } from "vitest";

const setMany = vi.fn();
vi.mock("@/server/auth/permissions", () => ({
  requirePermission: async () => ({ id: "admin", email: "admin@bilan.local" }),
  hasPermission: async () => true,
}));
vi.mock("@/server/services/settings/app-settings", () => ({
  appSettings: { setMany },
  getAppName: async () => "Bilan",
  SECURITY_SETTING_KEYS: new Set(["min_password_length"]),
}));

const { setAppSettingsAction } = await import("@/server/transport/actions/settings");

describe("setAppSettingsAction field errors (#165)", () => {
  beforeEach(() => setMany.mockReset());

  it("reports every invalid field of the card and writes nothing", async () => {
    const fd = new FormData();
    fd.set("s:app_name", " ");
    fd.set("s:min_password_length", "3");
    fd.set("s:registration_mode", "OPEN");
    expect(await setAppSettingsAction(null, fd)).toEqual({
      ok: false,
      error: "INVALID",
      fieldErrors: { "s:app_name": "REQUIRED", "s:min_password_length": "OUT_OF_RANGE" },
    });
    expect(setMany).not.toHaveBeenCalled();
  });

  it("reports a non-integer min password length as out of range (#227)", async () => {
    const fd = new FormData();
    fd.set("s:min_password_length", "12.5");
    expect(await setAppSettingsAction(null, fd)).toMatchObject({
      fieldErrors: { "s:min_password_length": "OUT_OF_RANGE" },
    });
  });

  it("reports an app name over 40 characters as too long and writes nothing (#224)", async () => {
    const fd = new FormData();
    fd.set("s:app_name", "a".repeat(41));
    expect(await setAppSettingsAction(null, fd)).toEqual({
      ok: false,
      error: "INVALID",
      fieldErrors: { "s:app_name": "TOO_LONG" },
    });
    expect(setMany).not.toHaveBeenCalled();
  });

  it("saves a trimmed 40-character app name (#224)", async () => {
    const name = "b".repeat(40);
    const fd = new FormData();
    fd.set("s:app_name", `  ${name} `);
    expect(await setAppSettingsAction(null, fd)).toEqual({ ok: true });
    expect(setMany).toHaveBeenCalledWith([["app_name", name]], "admin");
  });
});

import { describe, it, expect, vi } from "vitest";

const setMany = vi.fn();
vi.mock("@/server/auth/permissions", () => ({
  requirePermission: async () => ({ id: "admin", email: "admin@bilan.local" }),
}));
vi.mock("@/server/services/settings/app-settings", () => ({
  appSettings: { setMany },
  getAppName: async () => "Bilan",
}));

const { setAppSettingsAction } = await import("@/server/transport/actions/settings");

describe("setAppSettingsAction field errors (#165)", () => {
  it("reports every invalid field of the card and writes nothing", async () => {
    const fd = new FormData();
    fd.set("s:app_name", " ");
    fd.set("s:min_password_length", "3");
    fd.set("s:registration_mode", "OPEN");
    expect(await setAppSettingsAction(null, fd)).toEqual({
      ok: false,
      error: "INVALID",
      fieldErrors: { "s:app_name": "REQUIRED", "s:min_password_length": "INVALID" },
    });
    expect(setMany).not.toHaveBeenCalled();
  });
});

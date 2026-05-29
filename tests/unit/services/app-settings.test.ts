import { describe, it, expect, beforeEach, vi } from "vitest";
import { AppSettingsService } from "@/server/services/settings/app-settings";

describe("AppSettingsService", () => {
  const findUnique = vi.fn();
  const upsert = vi.fn();
  const db = { appSetting: { findUnique, upsert } } as never;
  let svc: AppSettingsService;

  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    svc = new AppSettingsService(db, { ttlMs: 60_000 });
  });

  it("returns the value and caches it", async () => {
    findUnique.mockResolvedValueOnce({ key: "registration_mode", value: "OPEN" });
    expect(await svc.get("registration_mode")).toBe("OPEN");
    expect(await svc.get("registration_mode")).toBe("OPEN");
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns null when the key is missing", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await svc.get("missing")).toBeNull();
  });

  it("invalidates a key after set()", async () => {
    findUnique.mockResolvedValueOnce({ key: "k", value: 1 });
    await svc.get("k");
    upsert.mockResolvedValueOnce({});
    await svc.set("k", 2, "user_1");
    findUnique.mockResolvedValueOnce({ key: "k", value: 2 });
    expect(await svc.get("k")).toBe(2);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

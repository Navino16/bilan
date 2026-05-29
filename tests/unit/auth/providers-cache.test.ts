import { describe, it, expect, vi, beforeEach } from "vitest";
import { DynamicProviderCache } from "@/server/auth/providers";

describe("DynamicProviderCache", () => {
  let now = 0;
  const findMany = vi.fn();
  const db = { authProvider: { findMany } } as never;
  beforeEach(() => {
    now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    findMany.mockReset();
  });

  it("loads enabled providers and caches them", async () => {
    findMany.mockResolvedValueOnce([{ id: "p1", key: "google", enabled: true, type: "oidc" }]);
    const cache = new DynamicProviderCache(db, { ttlMs: 60_000 });
    const first = await cache.get();
    const second = await cache.get();
    expect(first).toEqual(second);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expiration", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "p1", key: "g", enabled: true, type: "oidc" }]);
    const cache = new DynamicProviderCache(db, { ttlMs: 100 });
    await cache.get();
    now += 200;
    const second = await cache.get();
    expect(second.length).toBe(1);
  });

  it("invalidate() forces a re-fetch on the next call", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "p1", key: "g", enabled: true, type: "oidc" }]);
    const cache = new DynamicProviderCache(db, { ttlMs: 60_000 });
    await cache.get();
    cache.invalidate();
    const second = await cache.get();
    expect(second.length).toBe(1);
  });
});

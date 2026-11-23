import { test, expect } from "@playwright/test";

// The manifest and service worker are static, unauthenticated assets. SW
// registration itself is production-only (RegisterSw bails in dev) — here we
// assert the files are served with the right shape, not that they register.
test.describe("pwa", () => {
  test("serves a valid web app manifest", async ({ page }) => {
    const res = await page.request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/application\/(manifest\+json|json)/);
    const manifest = await res.json();
    expect(manifest.name).toBe("Bilan");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  test("serves the service worker as JavaScript", async ({ page }) => {
    const res = await page.request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/javascript/);
  });
});

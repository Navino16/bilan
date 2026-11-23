import { test, expect } from "@playwright/test";

test.describe("security headers", () => {
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Playwright WebKit doesn't deliver taps in this env (project-wide skip)",
  );

  test("responses carry the hardened CSP + framing/sniffing headers", async ({ page }) => {
    const res = await page.goto("/fr/login");
    expect(res).toBeTruthy();
    const h = res!.headers();
    const csp = h["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
  });

  test("API responses carry them too, and the session JSON isn't cached (#243)", async ({
    request,
  }) => {
    const res = await request.get("/api/auth/get-session");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["cache-control"]).toBe("no-store");
    expect((await request.get("/api/auth/list-sessions")).status()).toBe(404);
  });

  test.describe("authenticated pages render without CSP violations", () => {
    test.use({ storageState: "tests/e2e/.auth/owner.json" });

    test("dashboard, transactions and insights raise no CSP console errors", async ({ page }) => {
      const violations: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" && /content security policy/i.test(m.text())) {
          violations.push(m.text());
        }
      });
      for (const path of ["/fr/dashboard", "/fr/transactions", "/fr/insights"]) {
        await page.goto(path, { waitUntil: "domcontentloaded", timeout: 90_000 });
      }
      expect(violations).toEqual([]);
    });
  });
});

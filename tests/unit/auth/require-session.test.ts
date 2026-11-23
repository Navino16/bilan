import { describe, it, expect, vi, beforeEach } from "vitest";

const requestHeaders = new Headers();

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  forbidden: () => {
    throw new Error("FORBIDDEN");
  },
}));
vi.mock("@/server/auth", () => ({
  getAuth: async () => ({ api: { getSession: async () => null } }),
}));

const { requireSession } = await import("@/server/auth/permissions");

describe("requireSession without a valid session", () => {
  beforeEach(() => requestHeaders.delete("x-bilan-path"));

  it("keeps the requested page as callbackUrl (stale cookie deep link)", async () => {
    requestHeaders.set("x-bilan-path", "/en/transactions?month=2026-09");
    await expect(requireSession()).rejects.toThrow(
      "REDIRECT /en/login?callbackUrl=%2Fen%2Ftransactions%3Fmonth%3D2026-09",
    );
  });

  it("ignores an unsafe path", async () => {
    requestHeaders.set("x-bilan-path", "//evil.example/fr/dashboard");
    await expect(requireSession()).rejects.toThrow(/^REDIRECT \/login$/);
  });

  it("falls back to the bare login without the header", async () => {
    await expect(requireSession()).rejects.toThrow(/^REDIRECT \/login$/);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));

import { mailLocale, pickMailLocale } from "@/server/services/mail/locale";

describe("mail locale (#245)", () => {
  it("prefers the recipient's stored locale, else the triggering page's", () => {
    expect(pickMailLocale("en", "fr")).toBe("en");
    expect(pickMailLocale(null, "en")).toBe("en");
    expect(pickMailLocale("de", "en")).toBe("en");
  });

  it("reads the stored preference of a known user", async () => {
    const db = (locale: string | null) =>
      ({
        userPreference: { findUnique: async () => (locale ? { locale } : null) },
      }) as unknown as Parameters<typeof mailLocale>[2];
    expect(await mailLocale("u1", "fr", db("en"))).toBe("en");
    expect(await mailLocale("u1", "en", db(null))).toBe("en");
  });
});

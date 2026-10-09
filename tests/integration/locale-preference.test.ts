import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/server/auth/permissions", () => ({
  getCurrentUser: async () => session.user,
}));

import { db } from "@/server/db";
import { syncPreferredLocale } from "@/server/services/users/preferences";
import { syncLocaleAction } from "@/server/transport/actions/preferences";

const userId = "locale_pref_user";

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.create({ data: { id: userId, email: "locale-pref@bilan.local" } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

const prefLocale = async () => (await db.userPreference.findUnique({ where: { userId } }))?.locale;

describe("language switch → UserPreference.locale (#214)", () => {
  it("syncPreferredLocale creates, updates, and skips a no-op write", async () => {
    expect(await syncPreferredLocale(userId, "en")).toBe(true);
    expect(await prefLocale()).toBe("en");
    expect(await syncPreferredLocale(userId, "en")).toBe(false);
    expect(await syncPreferredLocale(userId, "fr")).toBe(true);
    expect(await prefLocale()).toBe("fr");
  });

  it("the switcher action saves a signed-in user's choice only", async () => {
    session.user = null;
    await syncLocaleAction("en");
    expect(await prefLocale()).toBe("fr");

    session.user = { id: userId };
    await syncLocaleAction("de");
    expect(await prefLocale()).toBe("fr");
    await syncLocaleAction("en");
    expect(await prefLocale()).toBe("en");
  });
});

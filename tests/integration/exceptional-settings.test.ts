import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "xset_owner" } }));
vi.mock("@/server/auth/permissions", async (original) => ({
  ...(await original<typeof import("@/server/auth/permissions")>()),
  requireSession: async () => session.user,
}));

import { db } from "@/server/db";
import {
  getExceptionalRule,
  PreferenceInputError,
  updateExceptionalRule,
} from "@/server/services/users/preferences";
import { updateExceptionalSettingsAction } from "@/server/transport/actions/preferences";

const owner = "xset_owner";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: `${owner}@bilan.local` } });
});

beforeEach(async () => {
  await db.userPreference.deleteMany({ where: { userId: owner } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("exceptional expense rule", () => {
  it("defaults to 50 € and twice the average, with or without a preference row", async () => {
    expect(await getExceptionalRule(owner)).toEqual({ minAmount: 50, factor: 2 });
    await db.userPreference.create({ data: { userId: owner, locale: "fr" } });
    expect(await getExceptionalRule(owner)).toEqual({ minAmount: 50, factor: 2 });
  });

  it("stores the rule, keeping the existing locale", async () => {
    await db.userPreference.create({ data: { userId: owner, locale: "en" } });
    await updateExceptionalRule(owner, { minAmount: "120", factor: "1,5" }, "fr");
    expect(await getExceptionalRule(owner)).toEqual({ minAmount: 120, factor: 1.5 });
    const pref = await db.userPreference.findUniqueOrThrow({ where: { userId: owner } });
    expect(pref.locale).toBe("en");
  });

  it("rejects values outside what the service accepts", async () => {
    await expect(
      updateExceptionalRule(owner, { minAmount: 50, factor: 0.5 }, "fr"),
    ).rejects.toBeInstanceOf(PreferenceInputError);
  });
});

describe("updateExceptionalSettingsAction", () => {
  it("saves the signed-in user's rule", async () => {
    const r = await updateExceptionalSettingsAction(
      null,
      form({ minAmount: "75", factor: "3", locale: "en" }),
    );
    expect(r).toEqual({ ok: true });
    expect(await getExceptionalRule(owner)).toEqual({ minAmount: 75, factor: 3 });
  });

  it("returns field errors without saving", async () => {
    const r = await updateExceptionalSettingsAction(
      null,
      form({ minAmount: "", factor: "11", locale: "fr" }),
    );
    expect(r).toMatchObject({
      ok: false,
      fieldErrors: { minAmount: "REQUIRED", factor: "FACTOR_RANGE" },
    });
    expect(await db.userPreference.count({ where: { userId: owner } })).toBe(0);
  });
});

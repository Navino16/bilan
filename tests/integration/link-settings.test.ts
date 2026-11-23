import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "lset_owner" } }));
vi.mock("@/server/auth/permissions", () => ({
  requireSession: async () => session.user,
}));

import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { suggestPairs } from "@/server/services/links";
import {
  getLinkSuggestionSettings,
  PreferenceInputError,
  updateLinkSuggestionSettings,
} from "@/server/services/users/preferences";
import { updateLinkSettingsAction } from "@/server/transport/actions/links";

const owner = "lset_owner";
let accountId: string;

async function tx(date: string, amount: number): Promise<string> {
  const s = buildSecureFields({ label: "FRAIS", rawLabel: "FRAIS" });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(date),
      amount,
      type: "OTHER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      createdById: owner,
    },
  });
  return row.id;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: `${owner}@bilan.local` } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
});

beforeEach(async () => {
  await db.userPreference.deleteMany({ where: { userId: owner } });
  await db.transaction.deleteMany({ where: { accountId } });
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("link suggestion settings", () => {
  it("defaults to a 30-day window and no minimum without a preference row", async () => {
    expect(await getLinkSuggestionSettings(owner)).toEqual({ windowDays: 30, minAmount: 0 });
  });

  it("stores the settings, keeping the given locale on a new row and the existing one after", async () => {
    await updateLinkSuggestionSettings(owner, { windowDays: 7, minAmount: 12.5 }, "en");
    expect(await getLinkSuggestionSettings(owner)).toEqual({ windowDays: 7, minAmount: 12.5 });
    await updateLinkSuggestionSettings(owner, { windowDays: "0", minAmount: "0" }, "fr");
    const pref = await db.userPreference.findUniqueOrThrow({ where: { userId: owner } });
    expect(pref.locale).toBe("en");
    expect(pref.linkWindowDays).toBe(0);
  });

  it("rejects values outside what the service accepts", async () => {
    await expect(
      updateLinkSuggestionSettings(owner, { windowDays: 400, minAmount: 0 }, "fr"),
    ).rejects.toBeInstanceOf(PreferenceInputError);
    await expect(
      updateLinkSuggestionSettings(owner, { windowDays: 3, minAmount: -1 }, "fr"),
    ).rejects.toMatchObject({ fieldErrors: { minAmount: "TOO_SMALL" } });
  });

  it("drives suggestPairs: the window and the minimum amount filter pairs", async () => {
    const small = [await tx("2026-03-01", -10), await tx("2026-03-03", 10)];
    const far = [await tx("2026-03-01", -500), await tx("2026-03-21", 500)];
    const keys = async () => (await suggestPairs(owner)).map((p) => p.key).sort();

    expect(await keys()).toEqual([small.sort().join("|"), far.sort().join("|")].sort());
    await updateLinkSuggestionSettings(owner, { windowDays: 5, minAmount: 0 }, "fr");
    expect(await keys()).toEqual([small.sort().join("|")]);
    await updateLinkSuggestionSettings(owner, { windowDays: 30, minAmount: 100 }, "fr");
    expect(await keys()).toEqual([far.sort().join("|")]);
  });
});

describe("updateLinkSettingsAction", () => {
  it("saves the signed-in user's settings", async () => {
    const r = await updateLinkSettingsAction(
      null,
      form({ windowDays: "10", minAmount: "1 000,50", locale: "en" }),
    );
    expect(r).toEqual({ ok: true });
    expect(await getLinkSuggestionSettings(owner)).toEqual({ windowDays: 10, minAmount: 1000.5 });
    expect((await db.userPreference.findUniqueOrThrow({ where: { userId: owner } })).locale).toBe(
      "en",
    );
  });

  it("returns field errors without saving", async () => {
    const r = await updateLinkSettingsAction(
      null,
      form({ windowDays: "999", minAmount: "", locale: "fr" }),
    );
    expect(r).toMatchObject({
      ok: false,
      fieldErrors: { windowDays: "OUT_OF_RANGE", minAmount: "REQUIRED" },
    });
    expect(await db.userPreference.count({ where: { userId: owner } })).toBe(0);
  });
});

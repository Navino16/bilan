import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { syncAutoPeriodDates } from "@/server/services/transactions/period-date";

const owner = "period_owner";
let accountId: string;
let sal: string;
let plain: string;

async function insert(
  date: string,
  categoryId: string | null,
  extra: { periodDate?: string; periodManual?: boolean } = {},
): Promise<string> {
  const s = buildSecureFields({ label: "VIR SALAIRE", rawLabel: "VIR SALAIRE" });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(date),
      ...(extra.periodDate ? { periodDate: new Date(extra.periodDate) } : {}),
      periodManual: extra.periodManual ?? false,
      amount: 2000,
      type: "TRANSFER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      categoryId,
      createdById: owner,
    },
  });
  return row.id;
}

async function periodDay(id: string): Promise<string> {
  const row = await db.transaction.findUniqueOrThrow({ where: { id } });
  return row.periodDate.toISOString().slice(0, 10);
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "period-owner@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  sal = (await db.category.create({ data: { userId: owner, name: "Salaire", shiftDays: 5 } })).id;
  plain = (await db.category.create({ data: { userId: owner, name: "Divers" } })).id;
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("periodDate column", () => {
  it("defaults to the transaction date", async () => {
    const id = await insert("2026-10-31T00:00:00.000Z", sal);
    expect(await periodDay(id)).toBe("2026-10-31");
  });
});

describe("syncAutoPeriodDates", () => {
  it("shifts the last N days of the month to the 1st of the next one", async () => {
    const cases: [string, string][] = [
      ["2026-10-31", "2026-11-01"],
      ["2026-10-27", "2026-11-01"],
      ["2026-10-26", "2026-10-26"],
      ["2027-02-24", "2027-03-01"],
      ["2027-02-23", "2027-02-23"],
      ["2026-12-30", "2027-01-01"],
    ];
    const ids = await Promise.all(cases.map(([day]) => insert(`${day}T00:00:00.000Z`, sal)));
    await syncAutoPeriodDates({ categoryIds: [sal] });
    for (const [i, [, expected]] of cases.entries()) {
      expect(await periodDay(ids[i])).toBe(expected);
    }
  });

  it("leaves a manual assignment alone", async () => {
    const id = await insert("2026-10-31T00:00:00.000Z", sal, {
      periodDate: "2026-10-31T00:00:00.000Z",
      periodManual: true,
    });
    await syncAutoPeriodDates({ ids: [id] });
    expect(await periodDay(id)).toBe("2026-10-31");
  });

  it("puts rows without the option back on their real date", async () => {
    const other = await insert("2026-10-31T00:00:00.000Z", plain, {
      periodDate: "2026-11-01T00:00:00.000Z",
    });
    const none = await insert("2026-10-31T00:00:00.000Z", null, {
      periodDate: "2026-11-01T00:00:00.000Z",
    });
    await syncAutoPeriodDates({ ids: [other, none] });
    expect(await periodDay(other)).toBe("2026-10-31");
    expect(await periodDay(none)).toBe("2026-10-31");
  });

  it("does nothing on an empty scope", async () => {
    expect(await syncAutoPeriodDates({ ids: [] })).toBe(0);
    expect(await syncAutoPeriodDates({ categoryIds: [] })).toBe(0);
  });
});

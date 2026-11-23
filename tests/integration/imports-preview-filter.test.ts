import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildPreview } from "@/server/services/imports/preview";
import {
  buildSecureFields,
  computeExternalIds,
} from "@/server/services/transactions/secure-fields";
import type { NormalizedRow } from "@/server/services/imports/types";

const owner = "pfilter_owner";

const row = (iso: string, amount: number, rawLabel: string): NormalizedRow => ({
  date: new Date(`${iso}T00:00:00.000Z`),
  amount,
  rawLabel,
});

let accountId: string;

async function seedExisting(r: NormalizedRow) {
  const secure = buildSecureFields({ label: r.rawLabel, rawLabel: r.rawLabel });
  await db.transaction.create({
    data: {
      accountId,
      date: r.date,
      amount: r.amount,
      type: "CARD",
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      merchantKeyHash: secure.merchantKeyHash,
      externalId: computeExternalIds([r])[0],
      createdById: owner,
    },
  });
}

async function cleanup() {
  const accounts = await db.bankAccount.findMany({
    where: { ownerId: owner },
    select: { id: true },
  });
  const ids = accounts.map((a) => a.id);
  await db.transaction.deleteMany({ where: { accountId: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.categorizationRule.deleteMany({ where: { userId: owner } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: owner, email: "pfilter-owner@bilan.local" } });
  const cat = await db.category.create({ data: { name: "Courses", userId: owner } });
  await db.categorizationRule.create({
    data: { pattern: "GROCER", matchType: "CONTAINS", categoryId: cat.id, userId: owner },
  });
  const acc = await db.bankAccount.create({
    data: { ownerId: owner, name: "Courant", type: "CHECKING" },
  });
  accountId = acc.id;
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("import preview filter", () => {
  it("pages the uncategorized rows, leaving out already-imported ones", async () => {
    const already = row("2026-06-01", -9, "CB ALREADY THERE");
    await seedExisting(already);
    const rows = [
      ...Array.from({ length: 55 }, (_, i) =>
        row("2026-06-02", -(i + 1), i % 2 ? `CB GROCER ${i}` : `CB OTHER ${i}`),
      ),
      already,
    ];

    const all = await buildPreview(accountId, rows, owner);
    expect(all.viewRows).toBe(56);
    expect(all.autoCategorizedCount).toBe(27);
    expect(all.uncategorizedCount).toBe(28);

    const p = await buildPreview(accountId, rows, owner, 0, { filter: "uncategorized" });
    expect(p.viewRows).toBe(28);
    expect(p.totalRows).toBe(56);
    expect(p.rows).toHaveLength(28);
    expect(p.rows.every((r) => r.rawLabel.startsWith("CB OTHER"))).toBe(true);
    expect(p.rows.every((r) => r.suggestedCategoryId === null && !r.isDuplicate)).toBe(true);
  });

  it("keeps the probable view and clamps a page past the filtered view", async () => {
    await seedExisting(row("2026-07-01", -3, "CB EARLIER"));
    const rows = [row("2026-07-01", -3, "CB GROCER LATER"), row("2026-07-02", -4, "CB OTHER")];

    const p = await buildPreview(accountId, rows, owner, 5, { filter: "probable" });
    expect(p.rows.map((r) => r.rawLabel)).toEqual(["CB GROCER LATER"]);
    expect(p.viewRows).toBe(1);
    expect(p.page).toBe(0);
  });
});

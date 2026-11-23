import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { getInsights } from "@/server/services/dashboard/insights";
import { createLink } from "@/server/services/links";
import { renameMerchant } from "@/server/services/merchants";
import { comparisonFor, monthPeriod } from "@/lib/period";

const owner = "recurring_owner";
let accountId: string;

async function tx(
  date: string,
  amount: number,
  label: string,
  categoryId: string | null,
  type = "DIRECT_DEBIT",
): Promise<string> {
  const s = buildSecureFields({ label, rawLabel: label });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(`${date}T00:00:00.000Z`),
      amount,
      type,
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      merchantKeyHash: s.merchantKeyHash,
      categoryId,
      createdById: owner,
    },
  });
  return row.id;
}

async function cleanup() {
  await db.merchantAlias.deleteMany({ where: { userId: owner } });
  await db.transactionLink.deleteMany({ where: { createdById: owner } });
  await db.transaction.deleteMany({ where: { account: { ownerId: owner } } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: owner, email: "recurring-owner@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  const cat = async (name: string, data: { savings?: boolean; neutral?: boolean } = {}) =>
    (await db.category.create({ data: { userId: owner, name, color: "#11aa11", ...data } })).id;
  const subs = await cat("Abonnements");
  const saved = await cat("Épargne", { savings: true });
  const internal = await cat("Virement interne", { neutral: true });

  await tx("2026-01-03", -500, "CB DARTY", null, "CARD");
  for (const m of ["06", "07", "08", "09"]) {
    await tx(`2026-${m}-08`, -13.49, "CB NETFLIX.COM", subs, "CARD");
    // Savings and neutral rows are not spending, even when they come back every month.
    await tx(`2026-${m}-10`, -150, "PRLV AMUNDI", saved);
    await tx(`2026-${m}-12`, -400, "RETRAIT COMPTE JOINT", internal, "OTHER");
    // Refunded every month: the balanced link drops out.
    const paid = await tx(`2026-${m}-15`, -30, "CB SALLE DE SPORT", subs, "CARD");
    const back = await tx(`2026-${m}-20`, 30, "REMB SALLE DE SPORT", subs, "OTHER");
    await createLink({ transactionIds: [paid, back], userId: owner });
  }
  await tx("2026-09-25", -15.99, "PRLV FREE MOBILE", subs);
  await tx("2026-07-25", -15.99, "PRLV FREE TELECOM", subs);
  await tx("2026-08-25", -15.99, "PRLV FREE TELECOM", subs);
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("getInsights recurring payments", () => {
  const later = new Date("2026-12-15T00:00:00.000Z");

  it("finds the monthly spending over the 6 months ending at the period, savings, neutral and linked rows left out", async () => {
    const period = monthPeriod(2026, 9);
    const { recurring } = await getInsights(
      owner,
      period,
      comparisonFor(period, "prev", later),
      later,
    );
    expect(recurring.payments.map((p) => [p.label, p.usual, p.count, p.flags])).toEqual([
      ["NETFLIX.COM", 13.49, 4, []],
    ]);
    expect(recurring.monthly).toBe(13.49);
    expect(recurring.window.from).toEqual(new Date("2026-04-01T00:00:00.000Z"));
    expect(recurring.window.to).toEqual(monthPeriod(2026, 9).to);
  });

  it("flags a series that missed its month as stopped, judged at the period's end", async () => {
    const period = monthPeriod(2026, 11);
    const { recurring } = await getInsights(
      owner,
      period,
      comparisonFor(period, "prev", later),
      later,
    );
    expect(recurring.payments.map((p) => [p.label, p.flags])).toEqual([
      ["NETFLIX.COM", ["stopped"]],
    ]);
    expect(recurring.monthly).toBe(0);
  });

  it("groups the merchants sharing an alias", async () => {
    await renameMerchant(owner, "FREE MOBILE", "Free");
    await renameMerchant(owner, "FREE TELECOM", "Free");
    const period = monthPeriod(2026, 9);
    const { recurring } = await getInsights(
      owner,
      period,
      comparisonFor(period, "prev", later),
      later,
    );
    expect(recurring.payments.map((p) => [p.label, p.search, p.count])).toEqual([
      ["Free", "FREE MOBILE", 3],
      ["NETFLIX.COM", "NETFLIX.COM", 4],
    ]);
  });
});

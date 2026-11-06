import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { getInsights } from "@/server/services/dashboard/insights";
import { createLink } from "@/server/services/links";
import { comparisonFor, monthPeriod } from "@/lib/period";

const owner = "exceptional_owner";
let accountId: string;

async function tx(
  date: string,
  amount: number,
  label: string,
  categoryId: string | null,
  type = "CARD",
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
  await db.transactionLink.deleteMany({ where: { createdById: owner } });
  await db.transaction.deleteMany({ where: { account: { ownerId: owner } } });
  await db.category.deleteMany({ where: { userId: owner, parentId: { not: null } } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
}

let upkeep: string;
let fuel: string;
let tech: string;

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: owner, email: "exceptional-owner@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  const cat = async (
    name: string,
    data: { parentId?: string; savings?: boolean; neutral?: boolean } = {},
  ) => (await db.category.create({ data: { userId: owner, name, color: "#11aa11", ...data } })).id;
  const transport = await cat("Transport");
  fuel = await cat("Carburant", { parentId: transport });
  upkeep = await cat("Entretien", { parentId: transport });
  tech = await cat("High-tech");
  const insurance = await cat("Assurance");
  const saved = await cat("Épargne", { savings: true });
  const internal = await cat("Virement interne", { neutral: true });

  for (const m of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
    await tx(`2026-${m}-05`, -60, "CB TOTAL", fuel);
  }
  await tx("2026-10-05", -60, "CB TOTAL", fuel);
  await tx("2026-10-21", -90, "CB ESSO", fuel);
  await tx("2026-10-12", -300, "CB NORAUTO", upkeep);
  // Recurring: well above its category's average, but paid every month.
  for (const m of ["07", "08", "09", "10"]) {
    await tx(`2026-${m}-15`, -70, "PRLV MAAF AUTO", insurance, "DIRECT_DEBIT");
  }
  // Partly refunded: the link nets it to 150 €.
  const paid = await tx("2026-10-03", -250, "CB DARTY", tech);
  const back = await tx("2026-10-09", 100, "REMB DARTY", tech, "OTHER");
  await createLink({ transactionIds: [paid, back], userId: owner });
  // Fully refunded: drops out.
  const fnac = await tx("2026-10-04", -200, "CB FNAC", tech);
  const fnacBack = await tx("2026-10-08", 200, "REMB FNAC", tech, "OTHER");
  await createLink({ transactionIds: [fnac, fnacBack], userId: owner });
  await tx("2026-10-10", -100, "VIR M DUPONT", null, "TRANSFER");
  await tx("2026-10-11", -500, "PRLV AMUNDI", saved, "DIRECT_DEBIT");
  await tx("2026-10-12", -400, "RETRAIT COMPTE JOINT", internal, "OTHER");
});

afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe("getInsights exceptional expenses", () => {
  const later = new Date("2026-12-15T00:00:00.000Z");
  const insights = (period = monthPeriod(2026, 10)) =>
    getInsights(owner, period, comparisonFor(period, "prev", later), later);

  it("lists the period's expenses above their category's average, recurring, refunded, transfer, savings and neutral rows left out", async () => {
    const { exceptional } = await insights();
    expect(exceptional.expenses.map((e) => [e.label, e.amount, e.average, e.categoryId])).toEqual([
      // Entretien has one month of history: judged against Transport, (60×9 + 150 + 300) / 10.
      ["NORAUTO", 300, 99, upkeep],
      ["DARTY", 150, 15, tech],
      // Carburant: (60×9 + 150) / 10.
      ["ESSO", 90, 69, fuel],
    ]);
    expect(exceptional.expenses[0].date).toEqual(new Date("2026-10-12T00:00:00.000Z"));
    expect(exceptional.total).toBe(540);
    // Counted spending: 60 + 90 + 300 + 70 + 150 + 100.
    expect(exceptional.share).toBeCloseTo(540 / 770);
  });

  it("finds nothing in the first month, its own average", async () => {
    const { exceptional } = await insights(monthPeriod(2026, 1));
    expect(exceptional.expenses).toEqual([]);
  });
});

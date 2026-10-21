import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { reindexSearchTokens } from "@/server/services/transactions/reindex";
import { createLink } from "@/server/services/links";
import { loadRows } from "@/server/services/dashboard";
import { getMerchantDirectory, merchantRowsOf, renameMerchant } from "@/server/services/merchants";
import { topMerchants } from "@/lib/insights";

const owner = "mdir_owner";
let accountId = "";
let savings = "";
let food = "";
let shops = "";

async function tx(
  label: string,
  amount: number,
  date: string,
  opts: { categoryId?: string; type?: string; hashed?: boolean; account?: string } = {},
) {
  const { tokens, merchantKeyHash, ...fields } = buildSecureFields({ label, rawLabel: label });
  void tokens;
  const row = await db.transaction.create({
    data: {
      accountId: opts.account ?? accountId,
      date: new Date(date),
      amount,
      type: opts.type ?? "CARD",
      categoryId: opts.categoryId ?? null,
      ...fields,
      merchantKeyHash: opts.hashed === false ? null : merchantKeyHash,
    },
  });
  return row.id;
}

// The directory before #296: every visible row decrypted, links collapsed, then grouped.
async function rowByRowDirectory() {
  const all = { from: new Date(0), to: new Date(Date.UTC(9999, 11, 31)), year: null, month: null };
  const { rows } = await loadRows([accountId, savings], all, { withLabels: true });
  return topMerchants(merchantRowsOf(rows), Infinity);
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "mdir-owner@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  savings = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Livret", type: "SAVINGS" } })
  ).id;
  food = (await db.category.create({ data: { name: "Food", userId: owner } })).id;
  shops = (await db.category.create({ data: { name: "Shops", userId: owner } })).id;

  await tx("CB LIDL 10/01/25", -40, "2025-01-10", { categoryId: food });
  await tx("CB LIDL 05/03/26", -60, "2026-03-05", { categoryId: food });
  await tx("CB Lidl 05/03/26", -12.5, "2026-03-05", { categoryId: shops });
  await tx("CARTE 07/03/26 MONOPRIX CB*4521", -25, "2026-03-07", { categoryId: food });
  await tx("CB MONOPRIX", -15, "2026-03-09", { hashed: false });
  await tx("CB Crème Brûlée", -8, "2026-02-01");
  await tx("CB CREME BRULEE", -9, "2026-02-02", { hashed: false });
  await tx("VIR SEPA LOYER", -900, "2026-03-01", { type: "TRANSFER" });
  await tx("CB FNAC", 30, "2026-03-02");
  await tx("12/03", -4, "2026-03-12");
  // Balanced pair (purchase and refund): it drops out of the directory.
  const buy = await tx("CB DARTY", -199, "2026-01-15");
  const refund = await tx("CB DARTY", 199, "2026-01-20");
  await createLink({ transactionIds: [buy, refund], userId: owner });
  // Unbalanced pair: it counts once, for its net amount.
  const order = await tx("CB AMAZON", -80, "2026-02-10", { categoryId: shops });
  const partial = await tx("CB AMAZON", 30, "2026-02-12", { account: savings });
  await createLink({ transactionIds: [order, partial], userId: owner });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("merchant directory (#296)", () => {
  it("matches the row-by-row directory", async () => {
    const expected = await rowByRowDirectory();
    expect(expected.map((m) => m.label)).toEqual(
      expect.arrayContaining(["LIDL", "MONOPRIX", "AMAZON"]),
    );
    expect(await getMerchantDirectory(owner)).toEqual({ renamed: [], others: expected });
  });

  it("keeps a renamed merchant's totals", async () => {
    await renameMerchant(owner, "LIDL", "Supermarché");
    const { renamed } = await getMerchantDirectory(owner);
    const lidl = (await rowByRowDirectory()).find((m) => m.label === "LIDL")!;
    expect(renamed).toEqual([
      { ...lidl, label: "Supermarché", alias: "Supermarché", keys: ["LIDL"] },
    ]);
    await db.merchantAlias.deleteMany({ where: { userId: owner } });
  });

  it("is filled in by the search reindex", async () => {
    await db.transaction.updateMany({ where: { accountId }, data: { merchantKeyHash: null } });
    await reindexSearchTokens({ accountId });
    expect(await db.transaction.count({ where: { accountId, merchantKeyHash: null } })).toBe(0);
    expect((await getMerchantDirectory(owner)).others).toEqual(await rowByRowDirectory());
  });
});

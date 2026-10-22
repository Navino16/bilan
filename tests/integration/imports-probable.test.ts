import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { buildPreview } from "@/server/services/imports/preview";
import { insertRows } from "@/server/services/imports/commit";
import {
  buildSecureFields,
  computeExternalIds,
} from "@/server/services/transactions/secure-fields";
import type { NormalizedRow } from "@/server/services/imports/types";

const owner = "probable_owner";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const row = (iso: string, amount: number, rawLabel: string): NormalizedRow => ({
  date: day(iso),
  amount,
  rawLabel,
});

async function newAccount(): Promise<string> {
  const acc = await db.bankAccount.create({
    data: { ownerId: owner, name: "Courant", type: "CHECKING" },
  });
  return acc.id;
}

// An imported row carries its dedup key; `manual` leaves externalId null like a hand-entered one.
async function seedExisting(accountId: string, r: NormalizedRow, opts: { manual?: boolean } = {}) {
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
      externalId: opts.manual ? null : computeExternalIds([r])[0],
      createdById: owner,
    },
  });
}

async function newBatch(accountId: string): Promise<string> {
  const b = await db.importBatch.create({
    data: { accountId, source: "CSV", status: "REVIEW", createdById: owner },
  });
  return b.id;
}

async function labelsOf(accountId: string): Promise<string[]> {
  const txs = await db.transaction.findMany({
    where: { accountId },
    select: { rawLabelEnc: true },
  });
  return txs.map((t) => decrypt(t.rawLabelEnc, dataKey)).sort();
}

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "probable-owner@bilan.local" } });
});

afterAll(async () => {
  const accounts = await db.bankAccount.findMany({
    where: { ownerId: owner },
    select: { id: true },
  });
  const ids = accounts.map((a) => a.id);
  await db.transaction.deleteMany({ where: { accountId: { in: ids } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("probable duplicates", () => {
  it("flags a same-day same-amount row with another label", async () => {
    const accountId = await newAccount();
    await seedExisting(accountId, row("2026-04-12", -12.4, "CB SHOP PARIS 12/04"));
    const p = await buildPreview(
      accountId,
      [row("2026-04-12", -12.4, "CB SHOP PARIS"), row("2026-04-12", -7, "CB BAKERY")],
      owner,
    );
    expect(p.rows[0].probableOf).toBe("CB SHOP PARIS 12/04");
    expect(p.rows[0].isDuplicate).toBe(false);
    expect(p.rows[1].probableOf).toBeNull();
    expect(p.probableCount).toBe(1);
    expect(p.duplicateCount).toBe(0);
  });

  it("matches one-to-one", async () => {
    const accountId = await newAccount();
    await seedExisting(accountId, row("2026-04-12", -5, "CB COFFEE"));
    const p = await buildPreview(
      accountId,
      [row("2026-04-12", -5, "CB COFFEE SHOP 1"), row("2026-04-12", -5, "CB COFFEE SHOP 2")],
      owner,
    );
    expect(p.probableCount).toBe(1);
    expect(p.rows.map((r) => r.probableOf)).toEqual(["CB COFFEE", null]);
  });

  it("ignores existing rows claimed by a certain duplicate", async () => {
    const accountId = await newAccount();
    await seedExisting(accountId, row("2026-04-12", -5, "CB A"));
    const p = await buildPreview(
      accountId,
      [row("2026-04-12", -5, "CB A"), row("2026-04-12", -5, "CB B")],
      owner,
    );
    expect(p.rows[0].isDuplicate).toBe(true);
    expect(p.rows[0].probableOf).toBeNull();
    expect(p.rows[1].probableOf).toBeNull();
    expect(p.probableCount).toBe(0);
  });

  it("counts a manual transaction (no externalId) as a candidate", async () => {
    const accountId = await newAccount();
    await seedExisting(accountId, row("2026-04-12", 30, "Remboursement Paul"), { manual: true });
    const p = await buildPreview(accountId, [row("2026-04-12", 30, "VIR PAUL DUPONT")], owner);
    expect(p.rows[0].probableOf).toBe("Remboursement Paul");
    expect(p.probableCount).toBe(1);
  });

  it("pages the probable-only view", async () => {
    const accountId = await newAccount();
    const rows = Array.from({ length: 60 }, (_, i) => row("2026-05-03", -(i + 1), `CB ROW ${i}`));
    for (const i of [10, 30, 55]) {
      await seedExisting(accountId, row("2026-05-03", -(i + 1), `OLD ${i}`));
    }
    const all = await buildPreview(accountId, rows, owner);
    expect(all.viewRows).toBe(60);
    expect(all.probableCount).toBe(3);

    const p = await buildPreview(accountId, rows, owner, 0, { probableOnly: true });
    expect(p.rows.map((r) => r.rawLabel)).toEqual(["CB ROW 10", "CB ROW 30", "CB ROW 55"]);
    expect(p.rows.map((r) => r.probableOf)).toEqual(["OLD 10", "OLD 30", "OLD 55"]);
    expect(p.viewRows).toBe(3);
    expect(p.totalRows).toBe(60);
    expect(p.probableCount).toBe(3);
    expect(p.page).toBe(0);
  });

  it("skips unseen probable duplicates at commit", async () => {
    const accountId = await newAccount();
    await seedExisting(accountId, row("2026-04-12", -12.4, "CB SHOP PARIS 12/04"));
    const rows = [row("2026-04-12", -12.4, "CB SHOP PARIS"), row("2026-04-13", -3, "CB METRO")];
    const [probableId] = computeExternalIds(rows);
    const opts = { autoCategorize: false };

    const excludedWins = await insertRows(
      { batchId: await newBatch(accountId), accountId },
      rows,
      { id: owner },
      { ...opts, excludedIds: [probableId], includedProbableIds: [probableId] },
    );
    expect(excludedWins.imported).toBe(1);
    expect(await labelsOf(accountId)).toEqual(["CB METRO", "CB SHOP PARIS 12/04"]);

    const unseen = await insertRows(
      { batchId: await newBatch(accountId), accountId },
      rows,
      { id: owner },
      opts,
    );
    expect(unseen.imported).toBe(0);
    expect(unseen.skipped).toBe(2); // the probable row + CB METRO, now certain
    expect(await labelsOf(accountId)).toEqual(["CB METRO", "CB SHOP PARIS 12/04"]);

    const ticked = await insertRows(
      { batchId: await newBatch(accountId), accountId },
      rows,
      { id: owner },
      { ...opts, includedProbableIds: [probableId] },
    );
    expect(ticked.imported).toBe(1);
    expect(ticked.skipped).toBe(1);
    expect(await labelsOf(accountId)).toEqual(["CB METRO", "CB SHOP PARIS", "CB SHOP PARIS 12/04"]);
  });
});

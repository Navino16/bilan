import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { hmacForSearch } from "@/server/crypto/hmac";
import { searchKey } from "@/server/crypto/keys";
import {
  createTransaction,
  listTransactions,
  updateTransaction,
} from "@/server/services/transactions";
import { buildSearchTokens } from "@/server/services/transactions/secure-fields";
import { reindexSearchTokens } from "@/server/services/transactions/reindex";
import { createCsvBatch, previewCsvBatch, commitCsvBatch } from "@/server/services/imports";

const owner = "srch_owner";
let accountId: string;
let lidlId: string;

const labelsFor = async (search: string) =>
  (await listTransactions(owner, { search })).items.map((i) => i.label).sort();

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "srch-owner@bilan.local" } });
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  lidlId = (
    await createTransaction(
      { accountId, date: "2026-02-01", amount: -12, type: "CARD", label: "Lidl Express" },
      { id: owner },
    )
  ).id;
  await createTransaction(
    { accountId, date: "2026-02-02", amount: -30, type: "CARD", label: "Leclerc Drive" },
    { id: owner },
  );
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.importBatch.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("word-prefix search (#192)", () => {
  it("matches a word from its first 3 letters, never from its middle", async () => {
    expect(await labelsFor("lid")).toEqual(["Lidl Express"]);
    expect(await labelsFor("LIDL")).toEqual(["Lidl Express"]);
    expect(await labelsFor("idl")).toEqual([]);
    expect(await labelsFor("lidlx")).toEqual([]);
  });

  it("keeps multi-word AND semantics on prefixes", async () => {
    expect(await labelsFor("lid exp")).toEqual(["Lidl Express"]);
    expect(await labelsFor("lec dri")).toEqual(["Leclerc Drive"]);
    expect(await labelsFor("lid dri")).toEqual([]);
  });

  it("re-indexes prefixes when a label is edited", async () => {
    const { id } = await createTransaction(
      { accountId, date: "2026-02-03", amount: -8, type: "CARD", label: "Boulangerie Paul" },
      { id: owner },
    );
    await updateTransaction(id, { label: "Fromagerie Lucie" }, { id: owner });
    expect(await labelsFor("froma")).toEqual(["Fromagerie Lucie"]);
    expect(await labelsFor("boul")).toEqual([]);
    await db.transaction.delete({ where: { id } });
  });

  it("indexes prefixes on imported rows", async () => {
    const batch = await createCsvBatch(
      {
        accountId,
        filename: "prefix.csv",
        text: "Date;Libellé;Débit;Crédit\n05/03/2026;CB INTERMARCHE SUPER;41,10;",
      },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    const row = await db.transaction.findFirstOrThrow({
      where: { importBatchId: batch.id },
      include: { searchTokens: true },
    });
    const tokens = row.searchTokens.map((t) => t.tokenHash);
    for (const p of ["int", "interm", "intermarche", "sup", "super"]) {
      expect(tokens).toContain(hmacForSearch(p, searchKey));
    }
    expect(await labelsFor("inter sup")).toEqual(["CB INTERMARCHE SUPER"]);
  });

  it("finds a long word from a query cut to the 12-char cap", async () => {
    const { id } = await createTransaction(
      { accountId, date: "2026-02-04", amount: 25, type: "TRANSFER", label: "Remboursement Secu" },
      { id: owner },
    );
    expect(await labelsFor("remboursement")).toEqual(["Remboursement Secu"]);
    expect(await labelsFor("remboursements")).toEqual(["Remboursement Secu"]);
    await db.transaction.delete({ where: { id } });
  });

  it("rebuilds an account's index from the encrypted labels, idempotently", async () => {
    await db.transactionSearchToken.deleteMany({ where: { transactionId: lidlId } });
    await db.transactionSearchToken.create({
      data: { transactionId: lidlId, tokenHash: hmacForSearch("stale", searchKey) },
    });
    expect(await labelsFor("lid")).toEqual([]);

    const progress: number[] = [];
    const first = await reindexSearchTokens({
      accountId,
      batchSize: 1,
      onProgress: ({ done }) => progress.push(done),
    });
    const total = await db.transaction.count({ where: { accountId } });
    expect(first.transactions).toBe(total);
    expect(progress).toEqual(Array.from({ length: total }, (_, i) => i + 1));

    const stored = await db.transactionSearchToken.findMany({ where: { transactionId: lidlId } });
    expect(stored.map((t) => t.tokenHash).sort()).toEqual(
      buildSearchTokens("Lidl Express", "Lidl Express").sort(),
    );
    expect(await labelsFor("lid")).toEqual(["Lidl Express"]);
    expect(await labelsFor("stale")).toEqual([]);

    const second = await reindexSearchTokens({ accountId });
    expect(second.tokensBefore).toBe(first.tokensAfter);
    expect(second.tokensAfter).toBe(first.tokensAfter);
  });

  it("aborts without touching the batch when a stored labelHash doesn't match", async () => {
    const before = await db.transactionSearchToken.count({ where: { transactionId: lidlId } });
    const { labelHash } = await db.transaction.findUniqueOrThrow({ where: { id: lidlId } });
    await db.transaction.update({ where: { id: lidlId }, data: { labelHash: "not-this-key" } });
    try {
      await expect(reindexSearchTokens({ accountId })).rejects.toThrow(/labelHash mismatch/);
      expect(await db.transactionSearchToken.count({ where: { transactionId: lidlId } })).toBe(
        before,
      );
    } finally {
      await db.transaction.update({ where: { id: lidlId }, data: { labelHash } });
    }
  });

  it("rewrites both equality hashes with rehash, as after a normalization change", async () => {
    await db.transaction.update({
      where: { id: lidlId },
      data: { labelHash: "old-normalization", rawLabelHash: "old-normalization" },
    });
    await reindexSearchTokens({ accountId, rehash: true });
    const row = await db.transaction.findUniqueOrThrow({ where: { id: lidlId } });
    expect(row.labelHash).toBe(hmacForSearch("Lidl Express", searchKey));
    expect(row.rawLabelHash).toBe(hmacForSearch("Lidl Express", searchKey));
    expect(await labelsFor("lid")).toEqual(["Lidl Express"]);
    await expect(reindexSearchTokens({ accountId })).resolves.toMatchObject({
      transactions: await db.transaction.count({ where: { accountId } }),
    });
  });
});

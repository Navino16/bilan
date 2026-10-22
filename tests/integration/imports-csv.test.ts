import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import {
  createCsvBatch,
  previewCsvBatch,
  commitCsvBatch,
  getCommitProgress,
  ImportAccessError,
} from "@/server/services/imports";

const owner = "imp_owner";
const stranger = "imp_stranger";
let accountId: string;

const CSV = `Date;Libellé;Débit;Crédit
05/03/2026;CB CARREFOUR CITY;82,37;
06/03/2026;VIR SEPA SALAIRE;;2450,00`;
// Same shape as CSV with rows of its own, so a test isn't refused as a re-import. A committed
// copy also needs its own year: same day + amount is a probable duplicate.
const freshCsv = (tag: string, year = 2026) =>
  CSV.replace(/(CARREFOUR CITY|SALAIRE)/g, `$1 ${tag}`).replace(/2026/g, String(year));

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "imp-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "imp-stranger@bilan.local" } });
  const acc = await db.bankAccount.create({
    data: { ownerId: owner, name: "Courant", type: "CHECKING" },
  });
  accountId = acc.id;
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.importBatch.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("CSV import pipeline", () => {
  it("rejects creating a batch on an account the actor cannot write", async () => {
    await expect(
      createCsvBatch({ accountId, filename: "x.csv", text: CSV }, { id: stranger }),
    ).rejects.toBeInstanceOf(ImportAccessError);
  });

  it("previews with a detected mapping and per-row suggestions", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "march.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    expect(preview.totalRows).toBe(2);
    expect(preview.mapping.date).toBe("Date");
    expect(preview.mapping.debit).toBe("Débit");
    expect(preview.preview[0].amount).toBe(-82.37);
    expect(preview.preview[1].amount).toBe(2450);
  });

  it("commits rows: encrypts labels, writes tokens, sets counters and status", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "march2.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    const summary = await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    expect(summary.importedRows).toBe(2);
    expect(summary.skippedRows).toBe(0);

    const rows = await db.transaction.findMany({
      where: { importBatchId: batch.id },
      include: { searchTokens: true },
    });
    expect(rows).toHaveLength(2);
    const carrefour = rows.find((r) => decrypt(r.rawLabelEnc, dataKey).includes("CARREFOUR"))!;
    expect(carrefour.rawLabelEnc).not.toContain("CARREFOUR");
    expect(carrefour.searchTokens.length).toBeGreaterThan(0);
    expect(Number(carrefour.amount)).toBe(-82.37);

    const updated = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.importedRows).toBe(2);
  });

  it("refuses a re-import of the same file: nothing to import, the batch stays in review", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "march3.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    expect(preview.duplicateCount).toBe(2);
    expect(preview.preview.every((r) => r.isDuplicate)).toBe(true);
    await expect(commitCsvBatch(batch.id, preview.mapping, { id: owner })).rejects.toThrow(
      "NOTHING_TO_IMPORT",
    );
    const after = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.status).toBe("REVIEW");
  });

  it("refuses a commit whose rows were all unchecked", async () => {
    const csv = `Date;Libellé;Débit;Crédit
12/04/2026;CB ALL OFF;3,00;`;
    const batch = await createCsvBatch(
      { accountId, filename: "off.csv", text: csv },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    await expect(
      commitCsvBatch(
        batch.id,
        preview.mapping,
        { id: owner },
        { excludedIds: preview.preview.map((r) => r.externalId) },
      ),
    ).rejects.toThrow("NOTHING_TO_IMPORT");
  });

  it("flags a probable duplicate and imports it once ticked", async () => {
    const head = "Date;Libellé;Débit;Crédit\n";
    const first = await createCsvBatch(
      { accountId, filename: "p1.csv", text: `${head}10/06/2031;CB SHOP ONE;5,00;` },
      { id: owner },
    );
    await commitCsvBatch(first.id, (await previewCsvBatch(first.id, owner)).mapping, {
      id: owner,
    });

    const text = `${head}10/06/2031;CB SHOP ONE 10/06;5,00;\n11/06/2031;CB METRO;2,00;`;
    const batch = await createCsvBatch({ accountId, filename: "p2.csv", text }, { id: owner });
    const preview = await previewCsvBatch(batch.id, owner);
    expect(preview.probableCount).toBe(1);
    expect(preview.viewRows).toBe(2);
    expect(preview.preview[0].probableOf).toBe("CB SHOP ONE");

    const only = await previewCsvBatch(batch.id, owner, preview.mapping, 0, {
      probableOnly: true,
    });
    expect(only.viewRows).toBe(1);
    expect(only.totalRows).toBe(2);
    expect(only.preview.map((r) => r.rawLabel)).toEqual(["CB SHOP ONE 10/06"]);

    const probableId = preview.preview[0].externalId;
    const ticked = await commitCsvBatch(
      batch.id,
      preview.mapping,
      { id: owner },
      { includedProbableIds: [probableId] },
    );
    expect(ticked.importedRows).toBe(2);
  });

  it("skips a probable duplicate at commit when it isn't ticked", async () => {
    const head = "Date;Libellé;Débit;Crédit\n";
    const seed = await createCsvBatch(
      { accountId, filename: "q1.csv", text: `${head}10/06/2033;CB SHOP TWO;5,00;` },
      { id: owner },
    );
    await commitCsvBatch(seed.id, (await previewCsvBatch(seed.id, owner)).mapping, {
      id: owner,
    });
    const text = `${head}10/06/2033;CB SHOP TWO 10/06;5,00;\n11/06/2033;CB METRO;2,00;`;
    const batch = await createCsvBatch({ accountId, filename: "q2.csv", text }, { id: owner });
    const preview = await previewCsvBatch(batch.id, owner);
    expect(preview.probableCount).toBe(1);
    const summary = await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    expect(summary.importedRows).toBe(1);
    expect(summary.skippedRows).toBe(1);
  });

  it("pages the preview, counting over every row", async () => {
    const lines = Array.from(
      { length: 120 },
      (_, i) => `${String(1 + (i % 28)).padStart(2, "0")}/01/2024;CB PAGE ${i};${i + 1},00;`,
    );
    const text = `Date;Libellé;Débit;Crédit\n${lines.join("\n")}`;
    const batch = await createCsvBatch({ accountId, filename: "pages.csv", text }, { id: owner });
    const first = await previewCsvBatch(batch.id, owner);
    expect(first.totalRows).toBe(120);
    expect(first.pageSize).toBe(50);
    expect(first.preview).toHaveLength(50);
    expect(first.preview[0].rawLabel).toBe("CB PAGE 0");

    const last = await previewCsvBatch(batch.id, owner, first.mapping, 2);
    expect(last.page).toBe(2);
    expect(last.preview.map((r) => r.rawLabel)).toEqual(
      Array.from({ length: 20 }, (_, i) => `CB PAGE ${100 + i}`),
    );
    const clamped = await previewCsvBatch(batch.id, owner, first.mapping, 99);
    expect(clamped.page).toBe(2);
  });

  it("commits more rows than one insert chunk, each with its search tokens", async () => {
    const lines = Array.from(
      { length: 1203 },
      (_, i) => `${String(1 + (i % 28)).padStart(2, "0")}/02/2024;CB CHUNK ROW${i};1,00;`,
    );
    const text = `Date;Libellé;Débit;Crédit\n${lines.join("\n")}`;
    const batch = await createCsvBatch({ accountId, filename: "chunks.csv", text }, { id: owner });
    const preview = await previewCsvBatch(batch.id, owner);
    const summary = await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    expect(summary.importedRows).toBe(1203);

    const rows = await db.transaction.findMany({
      where: { importBatchId: batch.id },
      select: { _count: { select: { searchTokens: true } } },
    });
    expect(rows).toHaveLength(1203);
    expect(rows.every((r) => r._count.searchTokens > 0)).toBe(true);
    expect(await getCommitProgress(batch.id, owner)).toEqual({
      status: "COMPLETED",
      importedRows: 1203,
    });
    await expect(getCommitProgress(batch.id, stranger)).rejects.toThrow("FORBIDDEN");
  });

  it("honours per-row edits: category override + excluded row", async () => {
    const cat = await db.category.create({ data: { userId: owner, name: "Courses" } });
    const csv = `Date;Libellé;Débit;Crédit
10/04/2026;CB EDIT KEEP;11,11;
11/04/2026;CB EDIT DROP;22,22;`;
    const batch = await createCsvBatch(
      { accountId, filename: "edit.csv", text: csv },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    const keep = preview.preview.find((r) => r.rawLabel === "CB EDIT KEEP")!;
    const drop = preview.preview.find((r) => r.rawLabel === "CB EDIT DROP")!;

    const summary = await commitCsvBatch(
      batch.id,
      preview.mapping,
      { id: owner },
      { overrides: { [keep.externalId]: cat.id }, excludedIds: [drop.externalId] },
    );
    expect(summary.importedRows).toBe(1);

    const rows = await db.transaction.findMany({ where: { importBatchId: batch.id } });
    expect(rows).toHaveLength(1);
    expect(decrypt(rows[0].rawLabelEnc, dataKey)).toBe("CB EDIT KEEP");
    expect(rows[0].categoryId).toBe(cat.id);
    expect(rows[0].manuallyCategorized).toBe(true);
  });

  it("drops an override category the actor does not own (IDOR guard)", async () => {
    const foreign = await db.category.create({ data: { userId: stranger, name: "Stranger cat" } });
    const csv = `Date;Libellé;Débit;Crédit\n12/04/2026;CB IDOR ${Date.now()};5,00;`;
    const batch = await createCsvBatch(
      { accountId, filename: "idor.csv", text: csv },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    const row = preview.preview[0];

    await commitCsvBatch(
      batch.id,
      preview.mapping,
      { id: owner },
      { autoCategorize: false, overrides: { [row.externalId]: foreign.id } },
    );
    const tx = await db.transaction.findFirstOrThrow({ where: { importBatchId: batch.id } });
    expect(tx.categoryId).toBeNull(); // foreign category dropped
    expect(tx.manuallyCategorized).toBe(false);
  });

  it("counts a hit on the matched rule for each auto-categorized imported row", async () => {
    const cat = await db.category.create({ data: { userId: owner, name: "Hits" } });
    const tag = `H${Date.now()}`;
    const hit = await db.categorizationRule.create({
      data: { pattern: `${tag}MATCH`, matchType: "CONTAINS", categoryId: cat.id, userId: owner },
    });
    const idle = await db.categorizationRule.create({
      data: { pattern: `${tag}IDLE`, matchType: "CONTAINS", categoryId: cat.id, userId: owner },
    });
    const csv = `Date;Libellé;Débit;Crédit
01/05/2026;CB ${tag}MATCH ONE;1,00;
02/05/2026;CB ${tag}MATCH TWO;2,00;
03/05/2026;CB ${tag}MATCH FORCED;3,00;
04/05/2026;CB ${tag}MATCH DROPPED;4,00;
06/05/2026;CB ${tag}MATCH CLEARED;6,00;
05/05/2026;CB OTHER ${tag};5,00;`;
    const batch = await createCsvBatch(
      { accountId, filename: "hits.csv", text: csv },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    expect((await db.categorizationRule.findUniqueOrThrow({ where: { id: hit.id } })).hits).toBe(0);

    const byLabel = (l: string) => preview.preview.find((r) => r.rawLabel.includes(l))!.externalId;
    await commitCsvBatch(
      batch.id,
      preview.mapping,
      { id: owner },
      {
        overrides: { [byLabel("FORCED")]: cat.id, [byLabel("CLEARED")]: "" },
        excludedIds: [byLabel("DROPPED")],
      },
    );
    const hits = async (id: string) =>
      (await db.categorizationRule.findUniqueOrThrow({ where: { id } })).hits;
    expect(await hits(hit.id)).toBe(2);
    expect(await hits(idle.id)).toBe(0);
    const cleared = await db.transaction.findMany({ where: { importBatchId: batch.id } });
    const clearedRow = cleared.find((r) => decrypt(r.rawLabelEnc, dataKey).includes("CLEARED"))!;
    expect(clearedRow.categoryId).toBeNull();
    expect(clearedRow.manuallyCategorized).toBe(true);

    // Re-import: duplicates add nothing, only the previously excluded row counts.
    const again = await createCsvBatch(
      { accountId, filename: "hits2.csv", text: csv },
      { id: owner },
    );
    const p2 = await previewCsvBatch(again.id, owner);
    await commitCsvBatch(again.id, p2.mapping, { id: owner });
    expect(await hits(hit.id)).toBe(3);

    const off = await createCsvBatch(
      {
        accountId,
        filename: "hits3.csv",
        text: `Date;Libellé;Débit;Crédit\n07/05/2026;CB ${tag}MATCH OFF;7,00;`,
      },
      { id: owner },
    );
    const p3 = await previewCsvBatch(off.id, owner);
    await commitCsvBatch(off.id, p3.mapping, { id: owner }, { autoCategorize: false });
    expect(await hits(hit.id)).toBe(3);
  });

  it("re-previews with an edited mapping and commits exactly what it showed", async () => {
    const csv = `Quand;Texte;Somme;Nature
07/03/2026;BOULANGERIE;-3,10;Carte
07/03/2026;BOULANGERIE;-3,10;Carte
08/03/2026;;-1,00;Carte
pas une date;X;-1,00;Carte`;
    const batch = await createCsvBatch(
      { accountId, filename: "remap.csv", text: csv },
      { id: owner },
    );
    const mapping = { date: "Quand", label: "Texte", amount: "Somme", type: "Nature" };
    const p = await previewCsvBatch(batch.id, owner, mapping);
    expect(p.totalRows).toBe(2);
    expect(p.preview.map((r) => r.type)).toEqual(["CARD", "CARD"]);
    expect(new Set(p.preview.map((r) => r.externalId)).size).toBe(2);
    expect(p.rejectedCount).toBe(2);
    expect(p.rejected.map((r) => [r.row, r.reason])).toEqual([
      [4, "LABEL"],
      [5, "DATE"],
    ]);
    await expect(
      previewCsvBatch(batch.id, owner, { date: "Quand", label: "Texte" }),
    ).rejects.toMatchObject({ message: "INVALID_MAPPING" });

    expect(p.mapping).toEqual({ ...mapping, decimal: ",", dateOrder: "DMY" });
    const summary = await commitCsvBatch(batch.id, p.mapping, { id: owner });
    expect(summary).toMatchObject({ importedRows: 2, skippedRows: 0, rejectedRows: 2 });
    await expect(previewCsvBatch(batch.id, owner, mapping)).rejects.toMatchObject({
      message: "NOT_COMMITTABLE",
    });
  });

  it("guesses an ambiguous decimal mark, and commits the one the user previewed (#187)", async () => {
    const tag = `DEC${Date.now()}`;
    const csv = `Date;Libellé;Montant
01/06/2026;CB ${tag} A;-1.234
02/06/2026;CB ${tag} B;45,500`;
    const batch = await createCsvBatch(
      { accountId, filename: "decimal.csv", text: csv },
      { id: owner },
    );
    const guessed = await previewCsvBatch(batch.id, owner);
    expect(guessed.mapping.decimal).toBe(",");
    expect(guessed.decimalGuessed).toBe(true);
    expect(guessed.preview.map((r) => r.amount)).toEqual([-1234, 45.5]);

    const confirmed = await previewCsvBatch(batch.id, owner, guessed.mapping);
    expect(confirmed.decimalGuessed).toBe(false);
    expect(confirmed.preview.map((r) => r.amount)).toEqual([-1234, 45.5]);

    const dot = await previewCsvBatch(batch.id, owner, { ...guessed.mapping, decimal: "." });
    expect(dot.decimalGuessed).toBe(false);
    expect(dot.mapping.decimal).toBe(".");
    expect(dot.preview.map((r) => r.amount)).toEqual([-1.23, 45500]);

    const summary = await commitCsvBatch(batch.id, dot.mapping, { id: owner });
    expect(summary.importedRows).toBe(2);
    const rows = await db.transaction.findMany({
      where: { importBatchId: batch.id },
      orderBy: { date: "asc" },
    });
    expect(rows.map((r) => Number(r.amount))).toEqual([-1.23, 45500]);
  });

  it("detects month-first dates, lets the mapping override it, and commits them (#245)", async () => {
    const tag = `MDY${Date.now()}`;
    const csv = `Date;Libellé;Montant
10/03/2026;CB ${tag} A;-1,00
12/25/2026;CB ${tag} B;-2,00`;
    const batch = await createCsvBatch(
      { accountId, filename: "mdy.csv", text: csv },
      { id: owner },
    );
    const monthFirst = await previewCsvBatch(batch.id, owner);
    expect(monthFirst.mapping.dateOrder).toBe("MDY");
    expect(monthFirst.dateOrderGuessed).toBe(false);
    expect(monthFirst.rejectedCount).toBe(0);
    expect(monthFirst.preview.map((r) => r.date.slice(0, 10)).sort()).toEqual([
      "2026-10-03",
      "2026-12-25",
    ]);

    const dayFirst = await previewCsvBatch(batch.id, owner, {
      ...monthFirst.mapping,
      dateOrder: "DMY",
    });
    expect(dayFirst.mapping.dateOrder).toBe("DMY");
    expect(dayFirst.preview.map((r) => r.date.slice(0, 10))).toEqual(["2026-03-10"]);
    expect(dayFirst.rejected.map((r) => r.reason)).toEqual(["DATE"]);
    const bad = { ...dayFirst.mapping, dateOrder: "YMD" } as unknown as typeof dayFirst.mapping;
    await expect(previewCsvBatch(batch.id, owner, bad)).rejects.toMatchObject({
      message: "INVALID_MAPPING",
    });

    await commitCsvBatch(batch.id, monthFirst.mapping, { id: owner });
    const rows = await db.transaction.findMany({
      where: { importBatchId: batch.id },
      orderBy: { date: "asc" },
    });
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-10-03",
      "2026-12-25",
    ]);
  });

  it("flags ambiguous dates as guessed until the user picks an order (#255)", async () => {
    const tag = `AMB${Date.now()}`;
    const csv = `Date;Libellé;Montant
03/10/2026;CB ${tag} A;-1,00
04/11/2026;CB ${tag} B;-2,00`;
    const batch = await createCsvBatch(
      { accountId, filename: "ambiguous.csv", text: csv },
      { id: owner },
    );
    const guessed = await previewCsvBatch(batch.id, owner);
    expect(guessed.mapping.dateOrder).toBe("DMY");
    expect(guessed.dateOrderGuessed).toBe(true);

    const confirmed = await previewCsvBatch(batch.id, owner, guessed.mapping);
    expect(confirmed.dateOrderGuessed).toBe(false);
    expect(confirmed.preview.map((r) => r.date.slice(0, 10)).sort()).toEqual([
      "2026-10-03",
      "2026-11-04",
    ]);
  });

  it("doesn't flag a decimal mark that an amount settles", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "settled.csv", text: freshCsv("SETTLED") },
      { id: owner },
    );
    const p = await previewCsvBatch(batch.id, owner);
    expect(p.mapping.decimal).toBe(",");
    expect(p.decimalGuessed).toBe(false);
  });

  it("rejects an invalid or missing decimal mark, or a missing date order", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "badmark.csv", text: freshCsv("BADMARK") },
      { id: owner },
    );
    const { mapping } = await previewCsvBatch(batch.id, owner);
    const bad = { ...mapping, decimal: ";" } as unknown as typeof mapping;
    await expect(previewCsvBatch(batch.id, owner, bad)).rejects.toMatchObject({
      message: "INVALID_MAPPING",
    });
    await expect(commitCsvBatch(batch.id, bad, { id: owner })).rejects.toMatchObject({
      message: "INVALID_MAPPING",
    });
    const unset = { ...mapping, decimal: undefined };
    await expect(commitCsvBatch(batch.id, unset, { id: owner })).rejects.toMatchObject({
      message: "INVALID_MAPPING",
    });
    const noOrder = { ...mapping, dateOrder: undefined };
    await expect(commitCsvBatch(batch.id, noOrder, { id: owner })).rejects.toMatchObject({
      message: "INVALID_MAPPING",
    });
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe(
      "REVIEW",
    );
  });

  it("trims the raw CSV text from metadata once committed", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "trim.csv", text: freshCsv("TRIM", 2031) },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    const row = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(row.metadata).toEqual({
      fileSizeBytes: Buffer.byteLength(freshCsv("TRIM", 2031)),
      accountIds: [accountId],
    });
  });

  it("refuses to commit a batch twice", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "twice.csv", text: freshCsv("TWICE", 2032) },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    await expect(commitCsvBatch(batch.id, preview.mapping, { id: owner })).rejects.toThrow(
      "NOT_COMMITTABLE",
    );
    const row = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(row.status).toBe("COMPLETED");
  });
});

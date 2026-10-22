import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { insertRows, finalizeBatch, type CommitOptions, type InsertTotals } from "./commit";
import { buildPreview, PREVIEW_PAGE_SIZE } from "./preview";
// Static import → pdfjs stays externalized (next.config serverExternalPackages),
// so the pdfjs worker resolves. Only the PDF route imports this module, so the CSV
// path never loads pdfjs.
import { parsePdf, type BankKey } from "./pdf";
import { assertImportTarget, loadBatch, withCommitClaim } from "./index";
import { ImportAccessError } from "./errors";
import type { CommitSummary, PreviewRow } from "./types";

type PdfMetaRow = { date: string; amount: number; rawLabel: string };
type PdfMetaProduct = { key: string; rows: PdfMetaRow[] };
export type PdfPreviewProduct = {
  key: string;
  totalRows: number;
  duplicateCount: number;
  probableCount: number;
  viewRows: number;
  autoCategorizedCount: number;
  preview: PreviewRow[];
  page: number;
  pageSize: number;
};
export type PdfPreview = {
  batchId: string;
  source: "PDF";
  filename: string | null;
  fileSizeBytes: number | null;
  bank: BankKey | null;
  products: PdfPreviewProduct[];
};

export async function createPdfBatch(
  input: { accountId: string; filename: string; buffer: Buffer },
  actor: { id: string },
): Promise<{ id: string; bank: BankKey | null }> {
  await assertImportTarget(actor.id, input.accountId);
  const { bank, products } = await parsePdf(input.buffer);
  const metaProducts: PdfMetaProduct[] = products.map((p) => ({
    key: p.key,
    rows: p.rows.map((r) => ({
      date: r.date.toISOString(),
      amount: r.amount,
      rawLabel: r.rawLabel,
    })),
  }));
  const total = metaProducts.reduce((n, p) => n + p.rows.length, 0);
  if (total === 0) throw new ImportAccessError("EMPTY");
  const batch = await db.importBatch.create({
    data: {
      accountId: input.accountId,
      source: "PDF",
      filename: input.filename,
      filenameHash: createHash("sha256").update(input.filename).digest("hex"),
      status: "REVIEW",
      totalRows: total,
      createdById: actor.id,
      metadata: { bank, products: metaProducts, fileSizeBytes: input.buffer.length } as never,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "import.created",
    entity: "ImportBatch",
    entityId: batch.id,
  });
  return { id: batch.id, bank };
}

function readPdfMeta(meta: unknown): {
  bank: BankKey | null;
  products: PdfMetaProduct[];
  fileSizeBytes: number | null;
} {
  const m = meta as {
    bank?: BankKey | null;
    products?: PdfMetaProduct[];
    fileSizeBytes?: number;
  } | null;
  return {
    bank: m?.bank ?? null,
    products: m?.products ?? [],
    fileSizeBytes: m?.fileSizeBytes ?? null,
  };
}

// `accounts` is the wizard's product → account choice: duplicates are what the
// commit will skip, so they're looked up in the account each product goes to.
export async function previewPdfBatch(
  batchId: string,
  userId: string,
  opts: {
    pages?: Record<string, number>;
    accounts?: Record<string, string>;
    probableOnly?: boolean;
  } = {},
): Promise<PdfPreview> {
  const batch = await loadBatch(batchId, userId);
  if (batch.source !== "PDF" || batch.status !== "REVIEW") {
    throw new ImportAccessError("NOT_COMMITTABLE");
  }
  for (const id of new Set(Object.values(opts.accounts ?? {}).filter(Boolean))) {
    await assertImportTarget(userId, id);
  }
  const { bank, products, fileSizeBytes } = readPdfMeta(batch.metadata);
  const previewed: PdfPreviewProduct[] = await Promise.all(
    products.map(async (p) => {
      const rows = p.rows.map((r) => ({
        date: new Date(r.date),
        amount: r.amount,
        rawLabel: r.rawLabel,
      }));
      const built = await buildPreview(
        opts.accounts?.[p.key] || batch.accountId,
        rows,
        userId,
        opts.pages?.[p.key] ?? 0,
        { probableOnly: opts.probableOnly },
      );
      return {
        key: p.key,
        totalRows: built.totalRows,
        duplicateCount: built.duplicateCount,
        probableCount: built.probableCount,
        viewRows: built.viewRows,
        autoCategorizedCount: built.autoCategorizedCount,
        preview: built.rows,
        page: built.page,
        pageSize: PREVIEW_PAGE_SIZE,
      };
    }),
  );
  return {
    batchId,
    source: "PDF",
    filename: batch.filename,
    fileSizeBytes,
    bank,
    products: previewed,
  };
}

// `mapping` is { [productKey]: accountId }; a product with no entry is ignored.
export async function commitPdfBatch(
  batchId: string,
  mapping: Record<string, string>,
  actor: { id: string },
  opts: CommitOptions = {},
): Promise<CommitSummary> {
  const batch = await loadBatch(batchId, actor.id);
  const { products } = readPdfMeta(batch.metadata);
  return withCommitClaim(batch.id, async () => {
    const totals: InsertTotals = { imported: 0, skipped: 0, total: 0, hitRuleIds: [] };
    const accountIds: string[] = [];
    for (const product of products) {
      const accountId = mapping[product.key];
      if (!accountId) continue; // ignored
      await assertImportTarget(actor.id, accountId);
      const rows = product.rows.map((r) => ({
        date: new Date(r.date),
        amount: r.amount,
        rawLabel: r.rawLabel,
      }));
      const r = await insertRows(
        { batchId: batch.id, accountId, progressOffset: totals.imported },
        rows,
        actor,
        opts,
      );
      totals.imported += r.imported;
      totals.skipped += r.skipped;
      totals.total += r.total;
      totals.hitRuleIds.push(...r.hitRuleIds);
      if (!accountIds.includes(accountId)) accountIds.push(accountId);
    }
    return finalizeBatch(batch.id, totals, actor, accountIds);
  });
}

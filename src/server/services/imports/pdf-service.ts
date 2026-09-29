import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { logEvent } from "@/server/services/audit";
import { insertRows, finalizeBatch, type CommitOptions } from "./commit";
import { buildPreview } from "./preview";
import { canCommit } from "@/lib/import-status";
// Static import → pdfjs/pdf-parse stay externalized (next.config serverExternalPackages),
// so the pdfjs worker resolves. Only the PDF route imports this module, so the CSV
// path never loads pdfjs.
import { parsePdf, type BankKey } from "./pdf";
import { loadBatch, ImportAccessError } from "./index";
import type { CommitSummary, PreviewRow } from "./types";

type PdfMetaRow = { date: string; amount: number; rawLabel: string };
type PdfMetaProduct = { key: string; rows: PdfMetaRow[] };
export type PdfPreviewProduct = {
  key: string;
  totalRows: number;
  duplicateCount: number;
  autoCategorizedCount: number;
  preview: PreviewRow[];
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
  if (!(await canWriteAccount(actor.id, input.accountId))) throw new ImportAccessError("FORBIDDEN");
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

export async function previewPdfBatch(batchId: string, userId: string): Promise<PdfPreview> {
  const batch = await loadBatch(batchId, userId);
  const { bank, products, fileSizeBytes } = readPdfMeta(batch.metadata);
  const previewed: PdfPreviewProduct[] = await Promise.all(
    products.map(async (p) => {
      const rows = p.rows.map((r) => ({
        date: new Date(r.date),
        amount: r.amount,
        rawLabel: r.rawLabel,
      }));
      const built = await buildPreview(batch.accountId, rows, userId);
      return {
        key: p.key,
        totalRows: built.totalRows,
        duplicateCount: built.duplicateCount,
        autoCategorizedCount: built.autoCategorizedCount,
        preview: built.rows,
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
  if (!canCommit(batch.status)) throw new ImportAccessError("NOT_COMMITTABLE");
  const { products } = readPdfMeta(batch.metadata);
  const totals = { imported: 0, skipped: 0, total: 0 };
  const accountIds: string[] = [];
  for (const product of products) {
    const accountId = mapping[product.key];
    if (!accountId) continue; // ignored
    if (!(await canWriteAccount(actor.id, accountId))) throw new ImportAccessError("FORBIDDEN");
    const rows = product.rows.map((r) => ({
      date: new Date(r.date),
      amount: r.amount,
      rawLabel: r.rawLabel,
    }));
    const r = await insertRows({ batchId: batch.id, accountId }, rows, actor, opts);
    totals.imported += r.imported;
    totals.skipped += r.skipped;
    totals.total += r.total;
    if (!accountIds.includes(accountId)) accountIds.push(accountId);
  }
  return finalizeBatch(batch.id, totals, actor, accountIds);
}

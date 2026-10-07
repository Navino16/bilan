import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { logEvent } from "@/server/services/audit";
import { csvMappingSchema, type CsvMappingInput } from "@/lib/validation/import";
import { parseCsv, detectMapping, mapRows } from "./csv-parse";
import { commitRows, type CommitOptions } from "./commit";
import { buildPreview, PREVIEW_PAGE_SIZE } from "./preview";
import { ImportAccessError } from "./errors";
import type { CsvMapping, ImportPreview, CommitSummary } from "./types";

// NOTE: the PDF service lives in `./pdf-service` (not here) so the CSV path never
// statically pulls in pdfjs/pdf-parse. pdfjs must stay an externalized server
// package (next.config `serverExternalPackages`) for its worker to resolve, which
// only holds for STATIC imports — so the PDF route imports pdf-service directly.

export { ImportAccessError };

// Creates a PARSING ImportBatch and stores the raw CSV text in `metadata.text`
// for the subsequent preview/commit. (MVP: text lives in the batch row; for very
// large files a blob store would be used — out of scope.)
export async function createCsvBatch(
  input: { accountId: string; filename: string; text: string; fileSizeBytes?: number },
  actor: { id: string },
): Promise<{ id: string }> {
  if (!(await canWriteAccount(actor.id, input.accountId))) throw new ImportAccessError("FORBIDDEN");
  const batch = await db.importBatch.create({
    data: {
      accountId: input.accountId,
      source: "CSV",
      filename: input.filename,
      filenameHash: createHash("sha256").update(input.filename).digest("hex"),
      status: "PARSING",
      createdById: actor.id,
      metadata: {
        text: input.text,
        fileSizeBytes: input.fileSizeBytes ?? Buffer.byteLength(input.text),
      } as never,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "import.created",
    entity: "ImportBatch",
    entityId: batch.id,
  });
  return { id: batch.id };
}

// Loads a batch and checks the actor can write its account. Shared with pdf-service.
export async function loadBatch(batchId: string, userId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportAccessError("NOT_FOUND");
  if (!(await canWriteAccount(userId, batch.accountId))) throw new ImportAccessError("FORBIDDEN");
  return batch;
}

const REJECTED_SHOWN = 5;

// Previews a batch with the detected mapping, or with `mapping` when the user
// edited it, so what is shown is exactly what a commit with it would import.
export async function previewCsvBatch(
  batchId: string,
  userId: string,
  mapping?: CsvMappingInput,
  page = 0,
): Promise<ImportPreview> {
  const batch = await loadBatch(batchId, userId);
  if (batch.source !== "CSV" || (batch.status !== "PARSING" && batch.status !== "REVIEW")) {
    throw new ImportAccessError("NOT_COMMITTABLE");
  }
  const meta = batch.metadata as { text?: string; fileSizeBytes?: number } | null;
  const { headers, rows } = parseCsv(meta?.text ?? "");
  let effective: CsvMapping = detectMapping(headers);
  if (mapping) {
    const parsed = csvMappingSchema.safeParse(mapping);
    if (!parsed.success) throw new ImportAccessError("INVALID_MAPPING");
    effective = parsed.data as CsvMapping;
  }
  const { rows: normalized, rejected } = mapRows(rows, effective);
  // Conditional, so a commit that started meanwhile is never pushed back to REVIEW.
  const { count } = await db.importBatch.updateMany({
    where: { id: batchId, status: { in: ["PARSING", "REVIEW"] } },
    data: { status: "REVIEW", totalRows: normalized.length },
  });
  if (count === 0) throw new ImportAccessError("NOT_COMMITTABLE");

  const p = await buildPreview(batch.accountId, normalized, userId, page);
  return {
    batchId,
    source: "CSV",
    filename: batch.filename,
    fileSizeBytes: meta?.fileSizeBytes ?? null,
    headers,
    mapping: effective,
    totalRows: p.totalRows,
    duplicateCount: p.duplicateCount,
    autoCategorizedCount: p.autoCategorizedCount,
    rejectedCount: rejected.length,
    rejected: rejected.slice(0, REJECTED_SHOWN),
    preview: p.rows,
    page: p.page,
    pageSize: PREVIEW_PAGE_SIZE,
  };
}

export async function commitCsvBatch(
  batchId: string,
  mapping: CsvMappingInput,
  actor: { id: string },
  opts: CommitOptions = {},
): Promise<CommitSummary> {
  const batch = await loadBatch(batchId, actor.id);
  const parsedMapping = csvMappingSchema.parse(mapping) as CsvMapping;
  const text = (batch.metadata as { text?: string } | null)?.text ?? "";
  const { rows } = parseCsv(text);
  const { rows: normalized, rejected } = mapRows(rows, parsedMapping);
  const summary = await withCommitClaim(batch.id, () =>
    commitRows({ id: batch.id, accountId: batch.accountId }, normalized, actor, opts),
  );
  return { ...summary, rejectedRows: rejected.length };
}

// The claim (REVIEW → COMMITTING) keeps a replayed commit, a discard or the purge off a
// batch mid-insert; a failed commit deletes its partial rows so the batch stays discardable.
export async function withCommitClaim<T>(batchId: string, run: () => Promise<T>): Promise<T> {
  const { count } = await db.importBatch.updateMany({
    where: { id: batchId, status: "REVIEW" },
    data: { status: "COMMITTING" },
  });
  if (count === 0) throw new ImportAccessError("NOT_COMMITTABLE");
  try {
    return await run();
  } catch (e) {
    await db.$transaction([
      db.transaction.deleteMany({ where: { importBatchId: batchId } }),
      db.importBatch.update({
        where: { id: batchId },
        data: { status: "REVIEW", importedRows: 0 },
      }),
    ]);
    throw e;
  }
}

export async function getBatchForUser(batchId: string, userId: string) {
  return loadBatch(batchId, userId);
}

// Rows written so far by a running commit (insertRows bumps importedRows per chunk).
export async function getCommitProgress(batchId: string, userId: string) {
  const batch = await db.importBatch.findUnique({
    where: { id: batchId },
    select: { accountId: true, status: true, importedRows: true },
  });
  if (!batch) throw new ImportAccessError("NOT_FOUND");
  if (!(await canWriteAccount(userId, batch.accountId))) throw new ImportAccessError("FORBIDDEN");
  return { status: batch.status, importedRows: batch.importedRows };
}

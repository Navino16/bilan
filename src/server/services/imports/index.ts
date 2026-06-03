import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { logEvent } from "@/server/services/audit";
import { csvMappingSchema, type CsvMappingInput } from "@/lib/validation/import";
import { parseCsv, detectMapping, mapRows } from "./csv-parse";
import { commitRows } from "./commit";
import { suggest } from "@/server/services/categorization";
import type { CsvMapping, ImportPreview, CommitSummary } from "./types";

export class ImportAccessError extends Error {}

// Creates a PARSING ImportBatch and stores the raw CSV text in `metadata.text`
// for the subsequent preview/commit. (MVP: text lives in the batch row; for very
// large files a blob store would be used — out of scope.)
export async function createCsvBatch(
  input: { accountId: string; filename: string; text: string },
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
      metadata: { text: input.text } as never,
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

async function loadBatch(batchId: string, userId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportAccessError("NOT_FOUND");
  if (!(await canWriteAccount(userId, batch.accountId))) throw new ImportAccessError("FORBIDDEN");
  return batch;
}

export async function previewCsvBatch(batchId: string, userId: string): Promise<ImportPreview> {
  const batch = await loadBatch(batchId, userId);
  const text = (batch.metadata as { text?: string } | null)?.text ?? "";
  const { headers, rows } = parseCsv(text);
  const mapping = detectMapping(headers);
  const normalized = mapRows(rows, mapping);
  await db.importBatch.update({
    where: { id: batchId },
    data: { status: "REVIEW", totalRows: normalized.length },
  });

  const preview = await Promise.all(
    normalized.slice(0, 50).map(async (r) => ({
      ...r,
      suggestedCategoryId: (await suggest(r.rawLabel, { userId })).categoryId,
    })),
  );
  return { batchId, headers, mapping, totalRows: normalized.length, preview };
}

export async function commitCsvBatch(
  batchId: string,
  mapping: CsvMappingInput,
  actor: { id: string },
): Promise<CommitSummary> {
  const batch = await loadBatch(batchId, actor.id);
  const parsedMapping = csvMappingSchema.parse(mapping) as CsvMapping;
  const text = (batch.metadata as { text?: string } | null)?.text ?? "";
  const { rows } = parseCsv(text);
  const normalized = mapRows(rows, parsedMapping);
  return commitRows({ id: batch.id, accountId: batch.accountId }, normalized, actor);
}

export async function getBatchForUser(batchId: string, userId: string) {
  return loadBatch(batchId, userId);
}

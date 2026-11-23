import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { computeExternalIds } from "@/server/services/transactions/secure-fields";
import type { BalanceAdjustment } from "@/lib/import-status";
import type { PreviewFilter } from "@/lib/validation/import";
import type { TransactionInput } from "@/lib/schemas/transaction";
import { insertRows, finalizeBatch, type CommitOptions, type InsertTotals } from "./commit";
import { buildPreview, PREVIEW_PAGE_SIZE } from "./preview";
import { findProbableDuplicates } from "./probable";
import { decodeOfx, parseOfx, type OfxStatement } from "./ofx/parse";
import { assertImportTarget, loadBatch, withCommitClaim } from "./index";
import { ImportAccessError } from "./errors";
import type { RejectedRow } from "./csv-parse";
import type { PdfPreviewProduct } from "./pdf-service";
import type { CommitSummary, NormalizedRow } from "./types";

export type { BalanceAdjustment };

type OfxMetaRow = {
  date: string;
  amount: number;
  rawLabel: string;
  type?: TransactionInput["type"];
  note?: string;
};
type OfxMetaProduct = Pick<OfxStatement, "key" | "kind" | "accountType" | "accountLast4"> & {
  rows: OfxMetaRow[];
  ledger: { amount: number; asOf: string } | null;
};

export type OfxBalance = {
  ledger: number;
  asOf: string; // ISO day
  base: number; // initialBalance + existing account transactions dated <= asOf
  defaultImport: number; // rows dated <= asOf the commit imports unless the user unticks them
  canAdjust: boolean;
};
export type OfxPreviewProduct = PdfPreviewProduct & {
  kind: OfxStatement["kind"];
  accountType: string | null;
  accountLast4: string;
  balance: OfxBalance | null; // null: no LEDGERBAL, or a CREDITCARD statement
};
export type OfxPreview = {
  batchId: string;
  source: "OFX";
  filename: string | null;
  fileSizeBytes: number | null;
  rejectedCount: number;
  rejected: RejectedRow[];
  products: OfxPreviewProduct[];
};

const DAY_MS = 86_400_000;
const REJECTED_SHOWN = 5;
const round2 = (x: number) => Math.round(x * 100) / 100;
const dayAfter = (day: Date) => new Date(Date.parse(day.toISOString().slice(0, 10)) + DAY_MS);

export async function createOfxBatch(
  input: { accountId: string; filename: string; buffer: Buffer },
  actor: { id: string },
): Promise<{ id: string }> {
  await assertImportTarget(actor.id, input.accountId);
  const statements = parseOfx(decodeOfx(input.buffer));
  const products: OfxMetaProduct[] = statements.map((s) => ({
    key: s.key,
    kind: s.kind,
    accountType: s.accountType,
    accountLast4: s.accountLast4,
    rows: s.rows.map((r) => ({
      date: r.date.toISOString(),
      amount: r.amount,
      rawLabel: r.rawLabel,
      type: r.type,
      ...(r.note ? { note: r.note } : {}),
    })),
    ledger: s.ledger ? { amount: s.ledger.amount, asOf: s.ledger.asOf.toISOString() } : null,
  }));
  const total = products.reduce((n, p) => n + p.rows.length, 0);
  if (total === 0) throw new ImportAccessError("EMPTY");
  const batch = await db.importBatch.create({
    data: {
      accountId: input.accountId,
      source: "OFX",
      filename: input.filename,
      filenameHash: createHash("sha256").update(input.filename).digest("hex"),
      status: "REVIEW",
      totalRows: total,
      createdById: actor.id,
      metadata: {
        products,
        rejected: statements.flatMap((s) => s.rejected),
        fileSizeBytes: input.buffer.length,
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

function readOfxMeta(meta: unknown): {
  products: OfxMetaProduct[];
  rejected: RejectedRow[];
  fileSizeBytes: number | null;
} {
  const m = meta as {
    products?: OfxMetaProduct[];
    rejected?: RejectedRow[];
    fileSizeBytes?: number;
  } | null;
  return {
    products: m?.products ?? [],
    rejected: m?.rejected ?? [],
    fileSizeBytes: m?.fileSizeBytes ?? null,
  };
}

const toRows = (p: OfxMetaProduct): NormalizedRow[] =>
  p.rows.map((r) => ({
    date: new Date(r.date),
    amount: r.amount,
    rawLabel: r.rawLabel,
    type: r.type,
    ...(r.note ? { note: r.note } : {}),
  }));

async function sumUpTo(accountId: string, asOf: Date): Promise<number> {
  const { _sum } = await db.transaction.aggregate({
    where: { accountId, date: { lt: dayAfter(asOf) } },
    _sum: { amount: true },
  });
  return Number(_sum.amount ?? 0);
}

// The file starts the account's history: adjusting a later one would hide missing operations.
// `excludeBatchId`: at commit, rows this import already inserted are not prior history.
async function startsHistory(
  accountId: string,
  rows: NormalizedRow[],
  excludeBatchId?: string,
): Promise<boolean> {
  if (rows.length === 0) return false;
  const first = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
  const earlier = await db.transaction.findFirst({
    where: {
      accountId,
      date: { lt: first },
      ...(excludeBatchId && {
        OR: [{ importBatchId: null }, { importBatchId: { not: excludeBatchId } }],
      }),
    },
    select: { id: true },
  });
  return !earlier;
}

// Same skips as insertRows (certain, probable and in-file duplicates), so the balance shown
// is what a commit without row edits produces.
async function defaultImportUpTo(
  accountId: string,
  rows: NormalizedRow[],
  asOf: Date,
): Promise<number> {
  const externalIds = computeExternalIds(rows);
  const existing = await db.transaction.findMany({
    where: { accountId, externalId: { in: externalIds } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map((e) => e.externalId!));
  const probable = await findProbableDuplicates(accountId, rows, externalIds, seen);
  const end = dayAfter(asOf).getTime();
  let sum = 0;
  for (const [i, externalId] of externalIds.entries()) {
    if (seen.has(externalId) || probable.has(i)) continue;
    seen.add(externalId);
    if (rows[i].date.getTime() < end) sum += rows[i].amount;
  }
  return round2(sum);
}

async function balanceOf(
  product: OfxMetaProduct,
  rows: NormalizedRow[],
  accountId: string,
  userId: string,
): Promise<OfxBalance | null> {
  if (product.kind !== "BANK" || !product.ledger) return null;
  const asOf = new Date(product.ledger.asOf);
  const [account, existing, defaultImport, starts] = await Promise.all([
    db.bankAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { ownerId: true, initialBalance: true },
    }),
    sumUpTo(accountId, asOf),
    defaultImportUpTo(accountId, rows, asOf),
    startsHistory(accountId, rows),
  ]);
  const ledger = product.ledger.amount;
  const base = round2(Number(account.initialBalance) + existing);
  return {
    ledger,
    asOf: product.ledger.asOf.slice(0, 10),
    base,
    defaultImport,
    canAdjust: account.ownerId === userId && starts && round2(ledger - base - defaultImport) !== 0,
  };
}

// `accounts` is the wizard's product → account choice: duplicates and the balance are
// computed against the account each product goes to.
export async function previewOfxBatch(
  batchId: string,
  userId: string,
  opts: {
    pages?: Record<string, number>;
    accounts?: Record<string, string>;
    filter?: PreviewFilter;
  } = {},
): Promise<OfxPreview> {
  const batch = await loadBatch(batchId, userId);
  if (batch.source !== "OFX" || batch.status !== "REVIEW") {
    throw new ImportAccessError("NOT_COMMITTABLE");
  }
  for (const id of new Set(Object.values(opts.accounts ?? {}).filter(Boolean))) {
    await assertImportTarget(userId, id);
  }
  const { products, rejected, fileSizeBytes } = readOfxMeta(batch.metadata);
  const previewed: OfxPreviewProduct[] = await Promise.all(
    products.map(async (p) => {
      const rows = toRows(p);
      const accountId = opts.accounts?.[p.key] || batch.accountId;
      const [built, balance] = await Promise.all([
        buildPreview(accountId, rows, userId, opts.pages?.[p.key] ?? 0, { filter: opts.filter }),
        balanceOf(p, rows, accountId, userId),
      ]);
      return {
        key: p.key,
        kind: p.kind,
        accountType: p.accountType,
        accountLast4: p.accountLast4,
        totalRows: built.totalRows,
        duplicateCount: built.duplicateCount,
        probableCount: built.probableCount,
        viewRows: built.viewRows,
        autoCategorizedCount: built.autoCategorizedCount,
        uncategorizedCount: built.uncategorizedCount,
        preview: built.rows,
        page: built.page,
        pageSize: PREVIEW_PAGE_SIZE,
        balance,
      };
    }),
  );
  return {
    batchId,
    source: "OFX",
    filename: batch.filename,
    fileSizeBytes,
    rejectedCount: rejected.length,
    rejected: rejected.slice(0, REJECTED_SHOWN),
    products: previewed,
  };
}

// Re-checked after the product's rows are in: a ticked key that no longer qualifies (e.g. an
// earlier transaction added since the preview) is dropped.
async function openingAdjustment(
  product: OfxMetaProduct,
  rows: NormalizedRow[],
  accountId: string,
  userId: string,
  batchId: string,
): Promise<BalanceAdjustment | null> {
  if (product.kind !== "BANK" || !product.ledger) return null;
  const account = await db.bankAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: { ownerId: true, initialBalance: true },
  });
  if (account.ownerId !== userId || !(await startsHistory(accountId, rows, batchId))) return null;
  const sum = await sumUpTo(accountId, new Date(product.ledger.asOf));
  return {
    accountId,
    previous: Number(account.initialBalance),
    set: round2(product.ledger.amount - sum),
  };
}

// `mapping` is { [productKey]: accountId }; a product with no entry is ignored.
// `adjustBalance` lists the product keys whose opening-balance adjustment was ticked.
export async function commitOfxBatch(
  batchId: string,
  mapping: Record<string, string>,
  actor: { id: string },
  opts: CommitOptions & { adjustBalance?: string[] } = {},
): Promise<CommitSummary> {
  const batch = await loadBatch(batchId, actor.id);
  if (batch.source !== "OFX") throw new ImportAccessError("NOT_COMMITTABLE");
  const { products, rejected } = readOfxMeta(batch.metadata);
  const { adjustBalance, ...commitOpts } = opts;
  const adjust = new Set(adjustBalance ?? []);
  const summary = await withCommitClaim(batch.id, async () => {
    const totals: InsertTotals = { imported: 0, skipped: 0, total: 0, hitRuleIds: [] };
    const accountIds: string[] = [];
    const toAdjust: { product: OfxMetaProduct; rows: NormalizedRow[]; accountId: string }[] = [];
    for (const product of products) {
      const accountId = mapping[product.key];
      if (!accountId) continue;
      await assertImportTarget(actor.id, accountId);
      const rows = toRows(product);
      const r = await insertRows(
        { batchId: batch.id, accountId, progressOffset: totals.imported },
        rows,
        actor,
        commitOpts,
      );
      totals.imported += r.imported;
      totals.skipped += r.skipped;
      totals.total += r.total;
      totals.hitRuleIds.push(...r.hitRuleIds);
      if (!accountIds.includes(accountId)) accountIds.push(accountId);
      if (adjust.has(product.key) && !toAdjust.some((a) => a.accountId === accountId)) {
        toAdjust.push({ product, rows, accountId });
      }
    }
    // Second pass: sibling products mapped to the same account must be inserted first.
    const balanceAdjustments: BalanceAdjustment[] = [];
    for (const { product, rows, accountId } of toAdjust) {
      const adjustment = await openingAdjustment(product, rows, accountId, actor.id, batch.id);
      if (adjustment) balanceAdjustments.push(adjustment);
    }
    return finalizeBatch(batch.id, totals, actor, accountIds, { balanceAdjustments });
  });
  return { ...summary, rejectedRows: rejected.length };
}

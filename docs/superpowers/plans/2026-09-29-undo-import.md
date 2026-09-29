# Undo a committed import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user undo a whole committed import (from the wizard summary or an "Imports récents" history on `/import`), and stop keeping raw bank data in `ImportBatch.metadata`.

**Architecture:** Pure status/metadata helpers in `src/lib/import-status.ts`; a new service `src/server/services/imports/revert.ts` (impact, revert, discard, history, purge); thin server actions in `src/server/transport/actions/imports.ts`; a token-guarded cron route; a client confirmation dialog shared by the wizard summary and a server-rendered history card.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma 7 + MariaDB adapter, next-intl, Base UI dialog (`@/components/ui/dialog`), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-undo-import-design.md`

## Global Constraints

- Code, tests, comments in English; UI strings in fr **and** en (`messages/fr.json` + `messages/en.json`, `import` namespace), edited together.
- Comments: only for complex code or a debatable decision, 1–3 lines, never restating the code.
- Statuses: `PARSING | REVIEW | COMPLETED | FAILED | REVERTED`; "uncommitted" = `PARSING | REVIEW | FAILED`. No migration (`status` is a `String`).
- `metadata` after commit/revert = `{ fileSizeBytes, bank?, accountIds }` only.
- Integration tests create their own users/accounts and clean up only their own rows (CI test DB is migrated but not seeded).
- Local test DB: `DATABASE_URL` from `.env` with `:3306/budget` → `:3307/budget_test`. Shorthand below: `TDB="$(grep ^DATABASE_URL .env | cut -d= -f2- | tr -d '"' | sed 's#:3306/budget#:3307/budget_test#')"`.
- Commits: 1-line English conventional, GPG-signed; check with `git log -1 --format='%G? %s'` (rtk prints "ok" even on failure).

## Review Focus

1. **Re-committing a finished batch** (double click, replayed request) must not re-finalize it with 0 rows → commit requires `REVIEW`, else 409 `NOT_COMMITTABLE` (Task 1).
2. **Two concurrent reverts** of the same batch must delete once and fail the second with `NOT_REVERTIBLE` → the status flip is claimed with `updateMany … where status = COMPLETED` inside the DB transaction (Task 2).
3. **A PDF batch spanning an account the actor can't write** must be refused as a whole, not partially reverted (Task 2).
4. **A link whose members all belong to the reverted batch**, and one keeping ≥ 2 members, must respectively vanish and survive (Task 2).
5. **Cancelling after the batch is already gone** (double cancel, purge ran) must be a silent no-op, not an error surfaced to the user (Task 3).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/import-status.ts` (new) | Status predicates, `trimBatchMetadata`. Pure. |
| `src/server/services/imports/commit.ts` | `finalizeBatch` trims metadata and records `accountIds`. |
| `src/server/services/imports/index.ts`, `pdf-service.ts` | Commit guard (`REVIEW` only). |
| `src/app/api/import/{csv,pdf}/[batchId]/commit/route.ts` | Map `NOT_COMMITTABLE` → 409. |
| `src/server/services/imports/revert.ts` (new) | `getRevertImpact`, `revertImport`, `discardBatch`, `listRecentImports`, `purgeStaleImports`. |
| `src/app/api/cron/purge-imports/route.ts` (new) | Cron purge of uncommitted batches > 24 h. |
| `src/server/transport/actions/imports.ts` (new) | `getRevertImpactAction`, `revertImportAction`, `discardImportAction`. |
| `src/components/import/revert-import-dialog.tsx` (new) | Client confirmation dialog (impact → confirm). |
| `src/components/import/import-history.tsx` (new) | Server "Imports récents" card. |
| `src/components/import/import-wizard.tsx` | Discard on cancel/re-upload, summary revert, `history` slot. |
| `src/app/[locale]/(authenticated)/import/page.tsx` | Loads the history, passes it to the wizard. |

---

### Task 1: Status helpers, metadata trimming, commit guard

**Files:**
- Create: `src/lib/import-status.ts`
- Modify: `src/server/services/imports/commit.ts` (`finalizeBatch`, `commitRows`)
- Modify: `src/server/services/imports/index.ts` (`commitCsvBatch`)
- Modify: `src/server/services/imports/pdf-service.ts` (`commitPdfBatch`)
- Modify: `src/app/api/import/csv/[batchId]/commit/route.ts`, `src/app/api/import/pdf/[batchId]/commit/route.ts`
- Modify: `messages/fr.json`, `messages/en.json` (`import.error.NOT_COMMITTABLE`)
- Test: `tests/unit/lib/import-status.test.ts` (new), `tests/integration/imports-csv.test.ts`

**Interfaces:**
- Produces: `UNCOMMITTED_STATUSES`, `canCommit(status)`, `canRevert(status)`, `canDiscard(status)`, `trimBatchMetadata(meta, accountIds)`, `type TrimmedMetadata`; `finalizeBatch(batchId, totals, actor, accountIds: string[])`.

- [ ] **Step 1: Write the failing unit test** — `tests/unit/lib/import-status.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { canCommit, canDiscard, canRevert, trimBatchMetadata } from "@/lib/import-status";

describe("import status guards", () => {
  it("commits only a batch in review", () => {
    expect(canCommit("REVIEW")).toBe(true);
    for (const s of ["PARSING", "COMPLETED", "REVERTED", "FAILED"]) expect(canCommit(s)).toBe(false);
  });

  it("reverts only a completed batch", () => {
    expect(canRevert("COMPLETED")).toBe(true);
    for (const s of ["PARSING", "REVIEW", "REVERTED", "FAILED"]) expect(canRevert(s)).toBe(false);
  });

  it("discards only uncommitted batches", () => {
    for (const s of ["PARSING", "REVIEW", "FAILED"]) expect(canDiscard(s)).toBe(true);
    for (const s of ["COMPLETED", "REVERTED"]) expect(canDiscard(s)).toBe(false);
  });
});

describe("trimBatchMetadata", () => {
  it("drops the raw CSV text", () => {
    expect(trimBatchMetadata({ text: "a;b", fileSizeBytes: 3 }, ["acc1"])).toEqual({
      fileSizeBytes: 3,
      accountIds: ["acc1"],
    });
  });

  it("drops the parsed PDF rows but keeps the bank", () => {
    const meta = { bank: "revolut", products: [{ key: "x", rows: [] }], fileSizeBytes: 9 };
    expect(trimBatchMetadata(meta, ["a", "b"])).toEqual({
      fileSizeBytes: 9,
      bank: "revolut",
      accountIds: ["a", "b"],
    });
  });

  it("tolerates missing metadata", () => {
    expect(trimBatchMetadata(null, [])).toEqual({ fileSizeBytes: null, accountIds: [] });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `npx vitest run tests/unit/lib/import-status.test.ts`

- [ ] **Step 3: Implement** — `src/lib/import-status.ts`

```ts
export const UNCOMMITTED_STATUSES = ["PARSING", "REVIEW", "FAILED"] as const;

export const canCommit = (status: string) => status === "REVIEW";
export const canRevert = (status: string) => status === "COMPLETED";
export const canDiscard = (status: string) =>
  (UNCOMMITTED_STATUSES as readonly string[]).includes(status);

export type TrimmedMetadata = {
  fileSizeBytes: number | null;
  bank?: string | null;
  accountIds: string[];
};

// Once committed, the raw payload (CSV text / parsed PDF rows) is plaintext bank
// data with no further use: only what the history needs is kept (spec §4).
export function trimBatchMetadata(meta: unknown, accountIds: string[]): TrimmedMetadata {
  const m = meta as { fileSizeBytes?: number; bank?: string | null } | null;
  return {
    fileSizeBytes: m?.fileSizeBytes ?? null,
    ...(m && "bank" in m ? { bank: m.bank ?? null } : {}),
    accountIds,
  };
}
```

- [ ] **Step 4: Run it — expect PASS**

- [ ] **Step 5: Write the failing integration tests** — append to the `describe` of `tests/integration/imports-csv.test.ts`

```ts
  it("trims the raw CSV text from metadata once committed", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "trim.csv", text: CSV },
      { id: owner },
    );
    const preview = await previewCsvBatch(batch.id, owner);
    await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    const row = await db.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(row.metadata).toEqual({ fileSizeBytes: Buffer.byteLength(CSV), accountIds: [accountId] });
  });

  it("refuses to commit a batch twice", async () => {
    const batch = await createCsvBatch(
      { accountId, filename: "twice.csv", text: CSV },
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
```

Note: rows of `CSV` are deduped against earlier tests of the file, so these assertions only look at metadata/status, not counters.

- [ ] **Step 6: Run — expect FAIL**

Run: `DATABASE_URL="$TDB" npx vitest run tests/integration/imports-csv.test.ts`

- [ ] **Step 7: Implement**

`src/server/services/imports/commit.ts` — `finalizeBatch` gains `accountIds` and writes the trimmed metadata:

```ts
import { trimBatchMetadata } from "@/lib/import-status";
// …
export async function finalizeBatch(
  batchId: string,
  totals: { imported: number; skipped: number; total: number },
  actor: { id: string },
  accountIds: string[],
): Promise<CommitSummary> {
  const { metadata } = await db.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: { metadata: true },
  });
  const updated = await db.importBatch.update({
    where: { id: batchId },
    data: {
      status: "COMPLETED",
      totalRows: totals.total,
      importedRows: totals.imported,
      skippedRows: totals.skipped,
      completedAt: new Date(),
      metadata: trimBatchMetadata(metadata, accountIds),
    },
  });
  // … audit + return unchanged
}
```

and `commitRows` passes `[batch.accountId]` as the 4th argument.

`src/server/services/imports/index.ts` — in `commitCsvBatch`, right after `loadBatch`:

```ts
  if (!canCommit(batch.status)) throw new ImportAccessError("NOT_COMMITTABLE");
```

(import `canCommit` from `@/lib/import-status`).

`src/server/services/imports/pdf-service.ts` — same guard after `loadBatch` in `commitPdfBatch`; collect the mapped accounts and pass them to finalize:

```ts
  const accountIds: string[] = [];
  for (const product of products) {
    const accountId = mapping[product.key];
    if (!accountId) continue;
    // … existing access check + insertRows …
    if (!accountIds.includes(accountId)) accountIds.push(accountId);
  }
  return finalizeBatch(batch.id, totals, actor, accountIds);
```

Both commit routes — replace the `ImportAccessError` branch:

```ts
    if (e instanceof ImportAccessError) {
      return e.message === "NOT_COMMITTABLE"
        ? Response.json({ error: "NOT_COMMITTABLE" }, { status: 409 })
        : Response.json({ error: "FORBIDDEN" }, { status: 403 });
    }
```

`messages/fr.json` `import.error.NOT_COMMITTABLE`: `"Cet import a déjà été validé ou annulé."`; `messages/en.json`: `"This import was already committed or undone."`

- [ ] **Step 8: Run unit + imports integration tests — expect PASS**

Run: `npx vitest run tests/unit/lib/import-status.test.ts && DATABASE_URL="$TDB" npx vitest run tests/integration/imports-csv.test.ts tests/integration/imports-pdf.test.ts`

If `imports-pdf.test.ts` asserts on `metadata.products` after commit, update that assertion to the trimmed shape.

- [ ] **Step 9: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/import-status.ts src/server/services/imports src/app/api/import messages tests
git commit -m "feat(import): trim raw payload from committed batches and refuse re-commits (#121)"
```

---

### Task 2: Revert service (impact + revert)

**Files:**
- Create: `src/server/services/imports/revert.ts`
- Test: `tests/integration/imports-revert.test.ts` (new)

**Interfaces:**
- Consumes: `canRevert`, `trimBatchMetadata` (Task 1); `insertRows`, `finalizeBatch(batchId, totals, actor, accountIds)` (Task 1); `ImportAccessError` from `./index`; `canWriteAccount` from `@/server/services/accounts/sharing`; `createLink` from `@/server/services/links`.
- Produces:
  ```ts
  export type RevertImpact = { transactions: number; linked: number; budgeted: number; edited: number };
  export async function getRevertImpact(actorId: string, batchId: string): Promise<RevertImpact>;
  export async function revertImport(actorId: string, batchId: string): Promise<{ deleted: number; linksDissolved: number }>;
  ```

- [ ] **Step 1: Write the failing integration tests** — `tests/integration/imports-revert.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { insertRows, finalizeBatch } from "@/server/services/imports/commit";
import { getRevertImpact, revertImport } from "@/server/services/imports/revert";
import { createLink } from "@/server/services/links";
import { createTransaction } from "@/server/services/transactions";

const owner = "rev_owner";
const other = "rev_other";
let accA: string;
let accB: string; // owned by `other`, shared READ with `owner`
let groupId: string;

const d = (day: number) => new Date(Date.UTC(2026, 4, day));

async function committedBatch(
  targets: { accountId: string; labels: string[] }[],
  actor = owner,
): Promise<string> {
  const batch = await db.importBatch.create({
    data: {
      accountId: targets[0].accountId,
      source: "PDF",
      filename: "test.pdf",
      status: "REVIEW",
      createdById: actor,
      metadata: { products: [], fileSizeBytes: 1 },
    },
  });
  const totals = { imported: 0, skipped: 0, total: 0 };
  for (const t of targets) {
    const rows = t.labels.map((rawLabel, i) => ({ date: d(i + 1), amount: -10 - i, rawLabel }));
    const r = await insertRows({ batchId: batch.id, accountId: t.accountId }, rows, { id: actor }, {
      autoCategorize: false,
    });
    totals.imported += r.imported;
    totals.total += r.total;
  }
  await finalizeBatch(batch.id, totals, { id: actor }, targets.map((t) => t.accountId));
  return batch.id;
}

const manual = async (day: number, label: string) =>
  (
    await createTransaction(
      { accountId: accA, date: `2026-05-${String(day).padStart(2, "0")}`, amount: 5, type: "CARD", label },
      { id: owner },
    )
  ).id;

const txIds = async (batchId: string) =>
  (await db.transaction.findMany({ where: { importBatchId: batchId }, select: { id: true } })).map(
    (t) => t.id,
  );

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await db.user.create({ data: { id: owner, email: "rev-owner@bilan.local" } });
  await db.user.create({ data: { id: other, email: "rev-other@bilan.local" } });
  accA = (await db.bankAccount.create({ data: { ownerId: owner, name: "A", type: "CHECKING" } })).id;
  accB = (await db.bankAccount.create({ data: { ownerId: other, name: "B", type: "CHECKING" } })).id;
  groupId = (await db.group.create({ data: { name: "Rev", createdById: other } })).id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: other, role: "OWNER" },
      { groupId, userId: owner, role: "MEMBER" },
    ],
  });
  await db.accountShare.create({
    data: { accountId: accB, groupId, permission: "READ", createdById: other },
  });
});

afterAll(async () => {
  await db.transactionLink.deleteMany({ where: { createdById: { in: [owner, other] } } });
  await db.budget.deleteMany({ where: { userId: owner } });
  await db.transaction.deleteMany({ where: { accountId: { in: [accA, accB] } } });
  await db.importBatch.deleteMany({ where: { accountId: { in: [accA, accB] } } });
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.bankAccount.deleteMany({ where: { id: { in: [accA, accB] } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [owner, other] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
  await db.$disconnect();
});

describe("revertImport", () => {
  it("reports the impact: linked, budgeted and edited rows", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["IMP ONE", "IMP TWO", "IMP THREE"] }]);
    const [t1, t2, t3] = await txIds(batchId);
    await createLink({ transactionIds: [t1, await manual(9, "Outside")], userId: owner });
    const budget = await db.budget.create({
      data: {
        name: "B", userId: owner, periodType: "MONTH",
        periodStart: d(1), periodEnd: d(31), createdById: owner,
      },
    });
    await db.budgetAssignment.create({
      data: { budgetId: budget.id, transactionId: t2, mode: "INCLUDE", assignedById: owner },
    });
    await db.transaction.update({ where: { id: t3 }, data: { manuallyCategorized: true } });

    expect(await getRevertImpact(owner, batchId)).toEqual({
      transactions: 3,
      linked: 1,
      budgeted: 1,
      edited: 1,
    });
  });

  it("deletes the rows, dissolves a link left with one member, keeps a larger one", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["LNK ONE", "LNK TWO"] }]);
    const [t1, t2] = await txIds(batchId);
    const small = await createLink({ transactionIds: [t1, await manual(20, "Small")], userId: owner });
    const large = await createLink({
      transactionIds: [t2, await manual(21, "Large one"), await manual(22, "Large two")],
      userId: owner,
    });

    expect(await revertImport(owner, batchId)).toEqual({ deleted: 2, linksDissolved: 1 });
    expect(await db.transaction.count({ where: { importBatchId: batchId } })).toBe(0);
    expect(await db.transactionLink.findUnique({ where: { id: small.id } })).toBeNull();
    expect(await db.transactionLinkMember.count({ where: { linkId: large.id } })).toBe(2);

    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("REVERTED");
    expect(batch.importedRows).toBe(2);
    const audit = await db.auditLog.findFirst({
      where: { action: "import.reverted", entityId: batchId },
    });
    expect(audit?.metadata).toEqual({ deleted: 2, linksDissolved: 1 });
  });

  it("dissolves a link whose members were all in the batch", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["ALL ONE", "ALL TWO"] }]);
    const link = await createLink({ transactionIds: await txIds(batchId), userId: owner });
    expect((await revertImport(owner, batchId)).linksDissolved).toBe(1);
    expect(await db.transactionLink.findUnique({ where: { id: link.id } })).toBeNull();
  });

  it("lets the same rows be imported again afterwards", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["AGAIN ONE"] }]);
    await revertImport(owner, batchId);
    const again = await committedBatch([{ accountId: accA, labels: ["AGAIN ONE"] }]);
    expect(await db.transaction.count({ where: { importBatchId: again } })).toBe(1);
  });

  it("refuses a second revert, and a batch that is not completed", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["TWICE ONE"] }]);
    await revertImport(owner, batchId);
    await expect(revertImport(owner, batchId)).rejects.toThrow("NOT_REVERTIBLE");
    const review = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "REVIEW", createdById: owner },
    });
    await expect(revertImport(owner, review.id)).rejects.toThrow("NOT_REVERTIBLE");
  });

  it("runs concurrent reverts once", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["RACE ONE", "RACE TWO"] }]);
    const results = await Promise.allSettled([
      revertImport(owner, batchId),
      revertImport(owner, batchId),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("refuses the whole revert when one account of the batch is not writable", async () => {
    await db.accountShare.create({
      data: { accountId: accA, groupId, permission: "WRITE", createdById: owner },
    });
    // B is READ-only for owner: the revert must not touch A's rows either.
    const batchId = await committedBatch(
      [
        { accountId: accB, labels: ["PDF B"] },
        { accountId: accA, labels: ["PDF A"] },
      ],
      other,
    );
    await expect(revertImport(owner, batchId)).rejects.toThrow("FORBIDDEN");
    expect(await db.transaction.count({ where: { importBatchId: batchId } })).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

Run: `DATABASE_URL="$TDB" npx vitest run tests/integration/imports-revert.test.ts`

- [ ] **Step 3: Implement** — `src/server/services/imports/revert.ts`

```ts
import { db } from "@/server/db";
import { canWriteAccount } from "@/server/services/accounts/sharing";
import { logEvent } from "@/server/services/audit";
import { canRevert, trimBatchMetadata } from "@/lib/import-status";
import { ImportAccessError } from "./index";

export type RevertImpact = { transactions: number; linked: number; budgeted: number; edited: number };

// Write access is required on every account the batch touched: a PDF batch maps
// each product to its own account (spec D2).
async function loadRevertable(actorId: string, batchId: string) {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportAccessError("NOT_FOUND");
  const rows = await db.transaction.findMany({
    where: { importBatchId: batchId },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const accountIds = [...new Set([batch.accountId, ...rows.map((r) => r.accountId)])];
  for (const id of accountIds) {
    if (!(await canWriteAccount(actorId, id))) throw new ImportAccessError("FORBIDDEN");
  }
  if (!canRevert(batch.status)) throw new ImportAccessError("NOT_REVERTIBLE");
  return batch;
}

export async function getRevertImpact(actorId: string, batchId: string): Promise<RevertImpact> {
  const batch = await loadRevertable(actorId, batchId);
  const where = { importBatchId: batchId };
  const [transactions, linked, budgeted, edited] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.count({ where: { ...where, linkMembership: { isNot: null } } }),
    db.transaction.count({ where: { ...where, budgetAssignments: { some: {} } } }),
    db.transaction.count({
      where: { ...where, updatedAt: { gt: batch.completedAt ?? batch.createdAt } },
    }),
  ]);
  return { transactions, linked, budgeted, edited };
}

export async function revertImport(
  actorId: string,
  batchId: string,
): Promise<{ deleted: number; linksDissolved: number }> {
  const batch = await loadRevertable(actorId, batchId);
  const accountIds =
    (batch.metadata as { accountIds?: string[] } | null)?.accountIds ?? [batch.accountId];
  const result = await db.$transaction(async (tx) => {
    // Claiming the status first makes a concurrent second revert find nothing to flip.
    const claimed = await tx.importBatch.updateMany({
      where: { id: batchId, status: "COMPLETED" },
      data: { status: "REVERTED", metadata: trimBatchMetadata(batch.metadata, accountIds) },
    });
    if (claimed.count === 0) throw new ImportAccessError("NOT_REVERTIBLE");

    const memberships = await tx.transactionLinkMember.findMany({
      where: { transaction: { importBatchId: batchId } },
      select: { linkId: true },
    });
    const linkIds = [...new Set(memberships.map((m) => m.linkId))];
    const { count: deleted } = await tx.transaction.deleteMany({
      where: { importBatchId: batchId },
    });
    const remaining = await tx.transactionLinkMember.groupBy({
      by: ["linkId"],
      where: { linkId: { in: linkIds } },
      _count: { _all: true },
    });
    const kept = new Set(remaining.filter((r) => r._count._all >= 2).map((r) => r.linkId));
    const dissolved = linkIds.filter((id) => !kept.has(id));
    await tx.transactionLink.deleteMany({ where: { id: { in: dissolved } } });
    return { deleted, linksDissolved: dissolved.length };
  });
  await logEvent({
    userId: actorId,
    action: "import.reverted",
    entity: "ImportBatch",
    entityId: batchId,
    metadata: result,
  });
  return result;
}
```

- [ ] **Step 4: Run — expect PASS.** If the concurrency test is flaky under MariaDB's default isolation, check that both calls really reach `updateMany` (the claim is the only serialization point) before changing anything else.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/server/services/imports/revert.ts tests/integration/imports-revert.test.ts
git commit -m "feat(import): revert a committed import with its impact (#121)"
```

---

### Task 3: Discard, history, stale purge + cron route

**Files:**
- Modify: `src/server/services/imports/revert.ts`
- Create: `src/app/api/cron/purge-imports/route.ts`
- Test: `tests/integration/imports-revert.test.ts` (new `describe` blocks)

**Interfaces:**
- Produces:
  ```ts
  export async function discardBatch(actorId: string, batchId: string): Promise<void>;
  export type ImportHistoryItem = {
    id: string; createdAt: Date; source: string; filename: string | null;
    status: "COMPLETED" | "REVERTED"; importedRows: number; skippedRows: number; accountNames: string[];
  };
  export async function listRecentImports(userId: string, limit?: number): Promise<ImportHistoryItem[]>;
  export async function purgeStaleImports(cutoff: Date): Promise<number>;
  ```

- [ ] **Step 1: Write the failing tests** — append to `tests/integration/imports-revert.test.ts` (extend the imports with `discardBatch, listRecentImports, purgeStaleImports`)

```ts
describe("discardBatch", () => {
  it("deletes an uncommitted batch and is a no-op once it is gone", async () => {
    const b = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "REVIEW", createdById: owner, metadata: { text: "raw" } },
    });
    await discardBatch(owner, b.id);
    expect(await db.importBatch.findUnique({ where: { id: b.id } })).toBeNull();
    await expect(discardBatch(owner, b.id)).resolves.toBeUndefined();
  });

  it("refuses a committed batch and a stranger", async () => {
    const batchId = await committedBatch([{ accountId: accA, labels: ["KEEP ONE"] }]);
    await expect(discardBatch(owner, batchId)).rejects.toThrow("NOT_DISCARDABLE");
    const b = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "REVIEW", createdById: owner },
    });
    await expect(discardBatch("nobody", b.id)).rejects.toThrow("FORBIDDEN");
  });
});

describe("purgeStaleImports", () => {
  it("deletes old uncommitted batches only", async () => {
    const old = new Date(Date.now() - 48 * 3600_000);
    const stale = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "PARSING", createdById: owner, createdAt: old },
    });
    const fresh = await db.importBatch.create({
      data: { accountId: accA, source: "CSV", status: "REVIEW", createdById: owner },
    });
    const done = await committedBatch([{ accountId: accA, labels: ["OLD DONE"] }]);
    await db.importBatch.update({ where: { id: done }, data: { createdAt: old } });

    expect(await purgeStaleImports(new Date(Date.now() - 24 * 3600_000))).toBeGreaterThanOrEqual(1);
    expect(await db.importBatch.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await db.importBatch.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await db.importBatch.findUnique({ where: { id: done } })).not.toBeNull();
  });
});

describe("listRecentImports", () => {
  it("lists committed and reverted batches of writable accounts, newest first", async () => {
    const kept = await committedBatch([{ accountId: accA, labels: ["HIST ONE"] }]);
    const undone = await committedBatch([{ accountId: accA, labels: ["HIST TWO"] }]);
    await revertImport(owner, undone);
    const foreign = await committedBatch([{ accountId: accB, labels: ["HIST B"] }], other);

    const items = await listRecentImports(owner);
    const ids = items.map((i) => i.id);
    expect(ids).toContain(kept);
    expect(ids).toContain(undone);
    expect(ids).not.toContain(foreign); // B is READ-only for owner
    expect(items.find((i) => i.id === undone)?.status).toBe("REVERTED");
    expect(items.find((i) => i.id === kept)?.accountNames).toEqual(["A"]);
    expect(items.every((i) => i.status === "COMPLETED" || i.status === "REVERTED")).toBe(true);
    const times = items.map((i) => i.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
```

The `FORBIDDEN` stranger case uses a user id that doesn't exist: `canWriteAccount` returns false for it. If it throws on an unknown user instead, create a throwaway user in `beforeAll` and remove it in `afterAll`.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** — append to `src/server/services/imports/revert.ts`

```ts
import { listVisibleForUser } from "@/server/services/accounts";
import { canDiscard, UNCOMMITTED_STATUSES } from "@/lib/import-status";

export async function discardBatch(actorId: string, batchId: string): Promise<void> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) return; // already discarded or purged
  if (!(await canWriteAccount(actorId, batch.accountId))) throw new ImportAccessError("FORBIDDEN");
  if (!canDiscard(batch.status)) throw new ImportAccessError("NOT_DISCARDABLE");
  await db.importBatch.deleteMany({
    where: { id: batchId, status: { in: [...UNCOMMITTED_STATUSES] } },
  });
  await logEvent({
    userId: actorId,
    action: "import.discarded",
    entity: "ImportBatch",
    entityId: batchId,
  });
}

export type ImportHistoryItem = {
  id: string;
  createdAt: Date;
  source: string;
  filename: string | null;
  status: "COMPLETED" | "REVERTED";
  importedRows: number;
  skippedRows: number;
  accountNames: string[];
};

export async function listRecentImports(userId: string, limit = 20): Promise<ImportHistoryItem[]> {
  const visible = await listVisibleForUser(userId);
  const names = new Map(visible.map((a) => [a.id, a.name]));
  const writable = visible.filter((a) => a.access === "OWNER" || a.access === "WRITE");
  const batches = await db.importBatch.findMany({
    where: {
      accountId: { in: writable.map((a) => a.id) },
      status: { in: ["COMPLETED", "REVERTED"] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return batches.map((b) => {
    const ids = (b.metadata as { accountIds?: string[] } | null)?.accountIds ?? [b.accountId];
    return {
      id: b.id,
      createdAt: b.createdAt,
      source: b.source,
      filename: b.filename,
      status: b.status as ImportHistoryItem["status"],
      importedRows: b.importedRows,
      skippedRows: b.skippedRows,
      accountNames: ids.flatMap((id) => names.get(id) ?? []),
    };
  });
}

export async function purgeStaleImports(cutoff: Date): Promise<number> {
  const { count } = await db.importBatch.deleteMany({
    where: { status: { in: [...UNCOMMITTED_STATUSES] }, createdAt: { lt: cutoff } },
  });
  return count;
}
```

(Merge the new imports into the existing import lines at the top of the file.)

`src/app/api/cron/purge-imports/route.ts`:

```ts
import { env } from "@/env";
import { logEvent } from "@/server/services/audit";
import { purgeStaleImports } from "@/server/services/imports/revert";

export const runtime = "nodejs";

const STALE_MS = 24 * 3600 * 1000;

// Token-guarded like purge-audit: unset CRON_SECRET → 404, wrong token → 401.
export async function POST(req: Request): Promise<Response> {
  if (!env.CRON_SECRET) return new Response(null, { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return new Response(null, { status: 401 });
  }
  const count = await purgeStaleImports(new Date(Date.now() - STALE_MS));
  await logEvent({ userId: null, action: "import.purged", metadata: { count } });
  return Response.json({ purged: count });
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `DATABASE_URL="$TDB" npx vitest run tests/integration/imports-revert.test.ts`

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/server/services/imports/revert.ts src/app/api/cron/purge-imports tests/integration/imports-revert.test.ts
git commit -m "feat(import): discard, list and purge import batches (#121)"
```

---

### Task 4: Server actions

**Files:**
- Create: `src/server/transport/actions/imports.ts`

**Interfaces:**
- Consumes: `getRevertImpact`, `revertImport`, `discardBatch`, `RevertImpact` (Tasks 2–3); `ImportAccessError`.
- Produces:
  ```ts
  export type ImportActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
  export async function getRevertImpactAction(batchId: string): Promise<ImportActionResult<RevertImpact>>;
  export async function revertImportAction(batchId: string): Promise<ImportActionResult<{ deleted: number; linksDissolved: number }>>;
  export async function discardImportAction(batchId: string): Promise<ImportActionResult<null>>;
  ```

- [ ] **Step 1: Implement** — `src/server/transport/actions/imports.ts`

```ts
"use server";

import { requireSession } from "@/server/auth/permissions";
import { ImportAccessError } from "@/server/services/imports";
import {
  discardBatch,
  getRevertImpact,
  revertImport,
  type RevertImpact,
} from "@/server/services/imports/revert";

export type ImportActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: (userId: string) => Promise<T>): Promise<ImportActionResult<T>> {
  const user = await requireSession();
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (e) {
    return { ok: false, error: e instanceof ImportAccessError ? e.message : "FAILED" };
  }
}

export async function getRevertImpactAction(
  batchId: string,
): Promise<ImportActionResult<RevertImpact>> {
  return run((userId) => getRevertImpact(userId, batchId));
}

export async function revertImportAction(
  batchId: string,
): Promise<ImportActionResult<{ deleted: number; linksDissolved: number }>> {
  return run((userId) => revertImport(userId, batchId));
}

export async function discardImportAction(batchId: string): Promise<ImportActionResult<null>> {
  return run(async (userId) => {
    await discardBatch(userId, batchId);
    return null;
  });
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
npx tsc --noEmit && npx eslint src/server/transport/actions/imports.ts
git add src/server/transport/actions/imports.ts
git commit -m "feat(import): server actions for revert and discard (#121)"
```

(No dedicated test: the wrappers are covered by the e2e in Task 7.)

---

### Task 5: UI mockups (review gate)

**Files:** throwaway only, under `.playwright-mcp/undo-import/` (deleted at the end of the task).

- [ ] **Step 1:** On the dev app (`docker compose up -d app`, demo account `dev@bilan.local` / `dev-password-123`), write a Node script with `@playwright/test`'s `chromium` that logs in, opens `/fr/import`, waits for `networkidle` + 1500 ms (hydration), removes `nextjs-portal`, hides `position: fixed` elements, then injects each mockup into the DOM under the dropzone. Viewport 390 px, `deviceScaleFactor: 2`.
- [ ] **Step 2:** Render three layouts of the "Imports récents" card with realistic rows (one CSV COMPLETED, one PDF on two accounts COMPLETED, one REVERTED):
  - **A** — table-like rows (like the transactions list): date · source badge · filename / accounts · counts · status badge · "Annuler" ghost button.
  - **B** — compact two-line list items: filename + status badge on line 1; date · accounts · counts on line 2; a `⋯` menu holding "Annuler l'import".
  - **C** — one small card per import in a grid, with the counts as the headline and the action at the bottom.
- [ ] **Step 3:** Render the confirmation dialog once (it has one natural layout): title, "N transactions seront supprimées", the non-zero impact lines with icons, "Cette action est définitive.", "Garder" + destructive "Supprimer les transactions".
- [ ] **Step 4:** Send the images to the user **one per option** (A, B, C, then the dialog), recommend one, and wait for their choice. Record the choice in the PR description.
- [ ] **Step 5:** Delete `.playwright-mcp/undo-import/` (eslint scans `.playwright-mcp/`).

Task 6 below is written for layout **A**; if another layout is chosen, apply it to `import-history.tsx` only (the data, strings and dialog stay the same).

---

### Task 6: UI — dialog, history card, wizard wiring, i18n

**Files:**
- Create: `src/components/import/revert-import-dialog.tsx`, `src/components/import/import-history.tsx`
- Modify: `src/components/import/import-wizard.tsx`, `src/app/[locale]/(authenticated)/import/page.tsx`
- Modify: `messages/fr.json`, `messages/en.json`

**Interfaces:**
- Consumes: `getRevertImpactAction`, `revertImportAction`, `discardImportAction` (Task 4); `listRecentImports`, `ImportHistoryItem` (Task 3).
- Produces: `<RevertImportDialog batchId trigger onReverted? />`; `<ImportHistory items locale />`; `ImportWizard` prop `history?: React.ReactNode`.

- [ ] **Step 1: Strings** — add to the `import` namespace of `messages/fr.json`:

```json
"history": {
  "overline": "Historique",
  "title": "Imports récents",
  "empty": "Aucun import pour l'instant.",
  "rows": "{imported} importées · {skipped} ignorées",
  "status": { "COMPLETED": "Importé", "REVERTED": "Annulé" },
  "revert": "Annuler"
},
"revert": {
  "action": "Annuler l'import",
  "title": "Annuler cet import ?",
  "loading": "Calcul de l'impact…",
  "deleted": "{count, plural, one {# transaction sera supprimée} other {# transactions seront supprimées}}",
  "linked": "{count, plural, one {# est liée à d'autres transactions : elle sortira de son lien} other {# sont liées à d'autres transactions : elles sortiront de leur lien}}",
  "budgeted": "{count, plural, one {# est affectée à un budget} other {# sont affectées à un budget}}",
  "edited": "{count, plural, one {# a été modifiée depuis l'import} other {# ont été modifiées depuis l'import}}",
  "irreversible": "Cette action est définitive.",
  "keep": "Garder",
  "confirm": "Supprimer les transactions",
  "done": "Import annulé : {count, plural, one {# transaction supprimée} other {# transactions supprimées}}.",
  "newImport": "Nouvel import",
  "error": {
    "NOT_REVERTIBLE": "Cet import a déjà été annulé.",
    "NOT_FOUND": "Import introuvable.",
    "FORBIDDEN": "Action non autorisée.",
    "FAILED": "Échec de l'annulation. Réessayez."
  }
}
```

and to `messages/en.json`:

```json
"history": {
  "overline": "History",
  "title": "Recent imports",
  "empty": "No imports yet.",
  "rows": "{imported} imported · {skipped} skipped",
  "status": { "COMPLETED": "Imported", "REVERTED": "Undone" },
  "revert": "Undo"
},
"revert": {
  "action": "Undo import",
  "title": "Undo this import?",
  "loading": "Checking the impact…",
  "deleted": "{count, plural, one {# transaction will be deleted} other {# transactions will be deleted}}",
  "linked": "{count, plural, one {# is linked to other transactions and will leave its link} other {# are linked to other transactions and will leave their links}}",
  "budgeted": "{count, plural, one {# is assigned to a budget} other {# are assigned to a budget}}",
  "edited": "{count, plural, one {# was edited since the import} other {# were edited since the import}}",
  "irreversible": "This can't be undone.",
  "keep": "Keep",
  "confirm": "Delete the transactions",
  "done": "Import undone: {count, plural, one {# transaction deleted} other {# transactions deleted}}.",
  "newImport": "New import",
  "error": {
    "NOT_REVERTIBLE": "This import was already undone.",
    "NOT_FOUND": "Import not found.",
    "FORBIDDEN": "Not allowed.",
    "FAILED": "Undo failed. Try again."
  }
}
```

Check parity: `node -e "const f=require('./messages/fr.json').import,e=require('./messages/en.json').import;const k=o=>Object.entries(o).flatMap(([a,v])=>typeof v==='object'?k(v).map(x=>a+'.'+x):[a]);const a=k(f).sort(),b=k(e).sort();console.log(JSON.stringify(a)===JSON.stringify(b)?'parity ok':{fr:a.filter(x=>!b.includes(x)),en:b.filter(x=>!a.includes(x))})"`

- [ ] **Step 2: Dialog** — `src/components/import/revert-import-dialog.tsx`

```tsx
"use client";

import { useState, useTransition, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getRevertImpactAction, revertImportAction } from "@/server/transport/actions/imports";
import type { RevertImpact } from "@/server/services/imports/revert";

type ErrorKey = "NOT_REVERTIBLE" | "NOT_FOUND" | "FORBIDDEN" | "FAILED";
const errorKey = (e: string): ErrorKey =>
  (["NOT_REVERTIBLE", "NOT_FOUND", "FORBIDDEN"] as const).find((k) => k === e) ?? "FAILED";

export function RevertImportDialog({
  batchId,
  trigger,
  onReverted,
}: {
  batchId: string;
  trigger: ReactElement;
  onReverted?: (deleted: number) => void;
}) {
  const t = useTranslations("import.revert");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<RevertImpact | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setImpact(null);
    setError(null);
    startTransition(async () => {
      const res = await getRevertImpactAction(batchId);
      if (res.ok) setImpact(res.data);
      else setError(errorKey(res.error));
    });
  }

  function confirm() {
    startTransition(async () => {
      const res = await revertImportAction(batchId);
      if (!res.ok) return setError(errorKey(res.error));
      setOpen(false);
      onReverted?.(res.data.deleted);
      router.refresh();
    });
  }

  const extras = impact
    ? (["linked", "budgeted", "edited"] as const).filter((k) => impact[k] > 0)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent data-slot="revert-import-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {impact ? t("deleted", { count: impact.transactions }) : t("loading")}
          </DialogDescription>
        </DialogHeader>
        {extras.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {extras.map((k) => (
              <li key={k} className="flex items-center gap-2">
                <TriangleAlert className="text-destructive size-3.5 shrink-0" />
                {t(k, { count: impact![k] })}
              </li>
            ))}
          </ul>
        )}
        {impact && <p className="text-muted-foreground text-xs">{t("irreversible")}</p>}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{t(`error.${error}`)}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>{t("keep")}</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={!impact || pending}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`import type` of `RevertImpact` from the service is erased at build, so the client bundle doesn't pull `@/server/db`.

- [ ] **Step 3: History card (layout A)** — `src/components/import/import-history.tsx`

```tsx
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { overline } from "@/components/transactions/bits";
import type { ImportHistoryItem } from "@/server/services/imports/revert";
import { RevertImportDialog } from "./revert-import-dialog";

export async function ImportHistory({
  items,
  locale,
}: {
  items: ImportHistoryItem[];
  locale: string;
}) {
  const t = await getTranslations("import.history");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <Card className="gap-4 p-6" data-slot="import-history">
      <div>
        <div className={overline}>{t("overline")}</div>
        <div className="font-display text-xl">{t("title")}</div>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="divide-border divide-y">
          {items.map((it) => (
            <li
              key={it.id}
              data-slot="import-history-row"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
            >
              <span className="bg-foreground text-background rounded px-1.5 py-0.5 font-mono text-[10px]">
                {it.source}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate">{it.filename ?? it.source}</div>
                <div className="text-muted-foreground truncate text-[11.5px]">
                  {date.format(it.createdAt)} · {it.accountNames.join(", ")} ·{" "}
                  {t("rows", { imported: it.importedRows, skipped: it.skippedRows })}
                </div>
              </div>
              <Badge variant={it.status === "REVERTED" ? "outline" : "secondary"}>
                {t(`status.${it.status}`)}
              </Badge>
              {it.status === "COMPLETED" && (
                <RevertImportDialog
                  batchId={it.id}
                  trigger={
                    <Button size="sm" variant="ghost">
                      {t("revert")}
                    </Button>
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

Check `Badge` variants in `src/components/ui/badge.tsx` and use the closest existing ones.

- [ ] **Step 4: Page** — `src/app/[locale]/(authenticated)/import/page.tsx`: load the history and pass it as a slot.

```tsx
import { listRecentImports } from "@/server/services/imports/revert";
import { ImportHistory } from "@/components/import/import-history";
// …
  const [categories, history] = await Promise.all([
    listForUser(user.id).then(flattenCategories),
    listRecentImports(user.id),
  ]);

  return (
    <ImportWizard
      accounts={accounts}
      categories={categories}
      history={<ImportHistory items={history} locale={locale} />}
    />
  );
```

- [ ] **Step 5: Wizard** — `src/components/import/import-wizard.tsx`

1. Props: add `history?: React.ReactNode`; render it at the end of the step-0 block (after the dropzone and the error), i.e. inside the `!preview` branch: `{history}`.
2. Split the existing `reset()` into `clear()` (the current state resets, plus `setSummary(null)`) and a `reset()` that discards first. Replace the comment above `reset` (now wrong):

```tsx
  function clear() {
    setFile(null);
    setPreview(null);
    setColumns({});
    setProductAccount({});
    setOverrides({});
    setExcluded({});
    setError(null);
    setSummary(null);
  }

  // Server cleanup is best effort: a batch that survives is purged by cron.
  function discard(batchId: string | undefined) {
    if (batchId) void discardImportAction(batchId);
  }

  function reset() {
    discard(preview?.batchId);
    clear();
  }
```

3. In `upload()`, discard the batch being replaced before the new request: first line `discard(preview?.batchId);`.
4. Summary branch: keep the summary text and "Voir les transactions", add the revert, and show the outcome once undone:

```tsx
  const [reverted, setReverted] = useState<number | null>(null);
  // …
      {summary ? (
        <Card className="space-y-3 p-6">
          {reverted === null ? (
            <>
              <p className="text-sm">
                {t("summary", { imported: summary.importedRows, skipped: summary.skippedRows })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/${locale}/transactions`} className={buttonVariants()}>
                  {t("viewTransactions")}
                </Link>
                {preview && (
                  <RevertImportDialog
                    batchId={preview.batchId}
                    onReverted={setReverted}
                    trigger={<Button variant="outline">{t("revert.action")}</Button>}
                  />
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">{t("revert.done", { count: reverted })}</p>
              <Button
                variant="outline"
                onClick={() => {
                  setReverted(null);
                  clear();
                }}
              >
                {t("revert.newImport")}
              </Button>
            </>
          )}
        </Card>
      ) : …
```

Imports to add: `RevertImportDialog`, `discardImportAction`. `Button` is already imported.

- [ ] **Step 6: Check in the browser** (chromium, desktop and 390 px): upload a CSV → validate → "Annuler l'import" → dialog shows the counts → confirm → "Import annulé…" → the history on `/import` shows the row "Annulé". Also check "Annuler" on the preview leaves no `REVIEW` batch behind:

```bash
docker compose exec -T mariadb mariadb -uapp -papp_password budget -e "select status, count(*) from ImportBatch group by status;"
```

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npx eslint src/components/import src/app && npx tsc --noEmit
git add src/components/import src/app messages
git commit -m "feat(import): undo an import from the wizard or the import history (#121)"
```

---

### Task 7: e2e, CI, PR

**Files:**
- Modify: `tests/e2e/import-csv.spec.ts`

- [ ] **Step 1: Write the e2e** — new test in `tests/e2e/import-csv.spec.ts`

```ts
  test("undo a committed import from the summary, then see it in the history", async ({
    page,
  }) => {
    const stamp = Date.now();
    const csv = `Date;Libellé;Débit;Crédit
09/03/2026;CB UNDO ${stamp};12,00;
10/03/2026;CB UNDO BIS ${stamp};8,00;`;

    await page.goto("/fr/import");
    const uploaded = page.waitForResponse(
      (r) => r.url().includes("/api/import/csv") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: `undo-${stamp}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    await uploaded;
    await expect(page.locator('[data-slot="import-preview-row"]').first()).toBeVisible({
      timeout: 15_000,
    });

    const committed = page.waitForResponse(
      (r) => r.url().includes("/commit") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /valider l'import/i }).click();
    await committed;

    const dialog = page.locator('[data-slot="revert-import-dialog"]');
    await expect(async () => {
      await page.getByRole("button", { name: /annuler l'import/i }).click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(dialog).toContainText("2 transactions seront supprimées");
    await dialog.getByRole("button", { name: /supprimer les transactions/i }).click();
    await expect(page.getByText(/import annulé/i)).toBeVisible({ timeout: 15_000 });

    await page.goto(`/fr/transactions?search=${stamp}`);
    await expect(page.getByRole("heading", { level: 1, name: /transactions/i })).toBeVisible();
    await expect(page.locator('[data-slot="transaction-row"]')).toHaveCount(0);

    await page.goto("/fr/import");
    await expect(
      page.locator('[data-slot="import-history-row"]', { hasText: `undo-${stamp}.csv` }),
    ).toContainText("Annulé");
  });
```

- [ ] **Step 2: Run the import e2e on chromium**

Run: `npx playwright test tests/e2e/import-csv.spec.ts tests/e2e/import-pdf.spec.ts --project=chromium`
(If the `setup` project stays on `/login`: `docker compose restart app`, open `/fr/login` once to warm it, rerun.)

- [ ] **Step 3: Full local CI**

Run: `DATABASE_URL="$TDB" npm run ci`
Expected: lint (only the known `_actor` warning), typecheck, all tests green.

- [ ] **Step 4: Commit, push, PR**

```bash
git add tests/e2e/import-csv.spec.ts
git commit -m "test(import): e2e for undoing an import (#121)"
git push -u origin feature/121-undo-import
gh pr create --base develop --title "feat(import): undo a committed import (#121)" \
  --label enhancement --label frontend --label backend --body-file /tmp/pr.md
```

PR body: `Closes #121`, what/why (revert, history, discard + purge, metadata trimming, re-commit guard), the chosen mockup layout, the crontab line:

```
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/purge-imports
```

Then link the PR to the thread (`mcp__t3-code__link_pull_request`) and watch the checks in the background.

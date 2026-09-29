# Undo a committed import (#121)

> **Status**: Approved in brainstorming — pending written-spec review
> **Date**: 2026-09-29
> **Issue**: #121 (follow-up of the import wizard, PR #73)

## 1. Problem

A committed import can't be rolled back: a wrong file (wrong account, duplicate statement) leaves its transactions behind, and there is no way to delete them (no transaction deletion exists at all, tracked separately in #128).

Two related gaps found while scoping:

- **Raw bank data stays in plaintext.** `ImportBatch.metadata` holds the whole CSV text (`metadata.text`) or every parsed PDF row (`metadata.products`), and keeps it after commit. Labels are encrypted everywhere else, and the main spec (§4, `ImportBatch.metadata`) only meant it to hold the mapping.
- **Abandoned batches pile up.** The wizard's "Annuler" is client-only, and changing the account or the file re-uploads, which creates a new batch each time. Every abandoned batch keeps its raw payload.

## 2. Goal

- Undo a whole committed import in one action, from the wizard's summary screen or from an import history on `/import`.
- Never keep raw bank data longer than the wizard needs it.

Out of scope: undoing single rows (#128), editing a committed import.

## 3. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | A revert that touches linked, budget-assigned or edited-since-import transactions **warns with counts, then proceeds** on confirmation. A link left with fewer than 2 members is dissolved. | User choice. Refusing would force manual unlinking first; silent deletion hides the side effects. |
| D2 | The revert requires write access to **every** account holding the batch's transactions. | A PDF batch maps each product to its own account (`commitPdfBatch`), so the upload account alone is not enough. |
| D3 | The import history lives on **`/import`**, in a "Imports récents" card under the dropzone: the 20 latest `COMPLETED`/`REVERTED` batches of the accounts the user can write. | User choice. It is where a bad import is noticed; no new page. Per-account placement fits PDF batches badly. |
| D4 | Raw payload is **cleared at commit and at revert**; uncommitted batches are **deleted on cancel / account or file change**, with a **cron purge** of uncommitted batches older than 24 h as a safety net. | User choice. Cron jobs are host-driven and inert without `CRON_SECRET`, so they can't be the only mechanism; a closed tab still needs the purge. |
| D5 | `REVERTED` batches are kept (counters intact) and shown as "Annulé" in the history. | The history and the audit trail stay readable. |
| D6 | "Edited since import" = `updatedAt > batch.completedAt`. | Recategorizing is the only edit today; `updatedAt` is set at creation, just before `completedAt`. |

## 4. Data

`ImportBatch.status` is a `String`: the new `REVERTED` value needs no migration.

Statuses: `PARSING | REVIEW | COMPLETED | FAILED | REVERTED`. "Uncommitted" = `PARSING | REVIEW | FAILED`.

`metadata` after commit (D4) keeps only:

```ts
{ fileSizeBytes: number | null; bank?: BankKey | null; accountIds: string[] }
```

`accountIds` = accounts that received rows, recorded at finalize so the history can still name them once the rows are reverted.

## 5. Services — `src/server/services/imports/`

New file `revert.ts` (the CSV path of `index.ts` stays untouched apart from finalize):

```ts
export type RevertImpact = {
  transactions: number;
  linked: number;
  budgeted: number;
  edited: number;
};

getRevertImpact(actorId, batchId): Promise<RevertImpact>
revertImport(actorId, batchId): Promise<{ deleted: number; linksDissolved: number }>
discardBatch(actorId, batchId): Promise<void>
listRecentImports(userId, limit = 20): Promise<ImportHistoryItem[]>
purgeStaleImports(cutoff: Date): Promise<number>
```

**Guards** (pure helper, unit-tested): `revertImport` needs `status === "COMPLETED"` (else `ImportAccessError("NOT_REVERTIBLE")`) and `canWriteAccount` on every account of the batch's transactions plus the upload account (else `FORBIDDEN`). `discardBatch` needs an uncommitted status (else `NOT_DISCARDABLE`) and write access to the upload account.

**`revertImport`**, in one `db.$transaction`:

1. Collect the link ids of the batch's link memberships.
2. `transaction.deleteMany({ where: { importBatchId } })`: search tokens, budget assignments and link memberships cascade.
3. Delete the collected links now holding fewer than 2 members.
4. Update the batch: `status: "REVERTED"`, `metadata` cleared per §4.

Then audit `import.reverted` with `{ deleted, linksDissolved }`. Re-importing the same file afterwards works: dedup finds no existing `externalId`.

**`finalizeBatch`** also writes the trimmed `metadata` (§4). Committing now requires `status === "REVIEW"` (else `NOT_COMMITTABLE`, HTTP 409): once the payload is trimmed, re-committing a `COMPLETED` or `REVERTED` batch would otherwise re-finalize it with zero rows.

**`discardBatch`** deletes the batch row; audit `import.discarded`.

**`listRecentImports`**: batches with `status in (COMPLETED, REVERTED)` whose upload account is writable by the user (`listVisibleForUser` filtered on `OWNER | WRITE`), newest first, with the account names resolved from `metadata.accountIds`.

**`purgeStaleImports`**: deletes uncommitted batches with `createdAt < cutoff`, returns the count.

## 6. Transport

- `src/server/transport/actions/imports.ts` (new): `getRevertImpactAction`, `revertImportAction`, `discardImportAction`. Thin wrappers (session, error mapping to `{ error }`); the client calls `router.refresh()` after a revert, like the other actions.
- `src/app/api/cron/purge-imports/route.ts`: same `CRON_SECRET` guard as `purge-audit`, cutoff `now − 24 h`, audit `import.purged` with `{ count }`. Crontab line documented in the PR:

  ```
  0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/purge-imports
  ```

## 7. UI

- **Wizard** (`import-wizard.tsx`): "Annuler", an account change and a file change call `discardImportAction` on the current batch, fire-and-forget (a failure is left to the purge). The summary screen gets an "Annuler l'import" button that opens the confirmation dialog.
- **"Imports récents" card** (`src/components/import/import-history.tsx`), rendered by `/import` under the dropzone: date, source badge (CSV/PDF), filename, account(s), imported/skipped counts, status (Importé / Annulé), and an "Annuler" action on `COMPLETED` rows. Empty state when there is no history.
- **Confirmation dialog** (`revert-import-dialog.tsx`), shared by the summary and the card: loads the impact, then states "N transactions seront supprimées", plus one line per non-zero count among linked, budget-assigned and edited-since-import transactions. Destructive confirm button; on success the dialog closes and the page refreshes (the row turns "Annulé").
- Layout of the card and the dialog: A/B/C mockups as images, reviewed before implementing the UI.
- Strings in fr and en, `import` namespace.

## 8. Tests

- **Unit**: the guards (non-revertible status, write access missing on one of a PDF batch's accounts, non-discardable status).
- **Integration**:
  - revert: rows gone, link with a remaining single member dissolved, budget assignments gone, status `REVERTED`, audit written, re-import of the same rows works;
  - `metadata` trimmed after commit (no `text` / `products`);
  - `discardBatch` refuses a `COMPLETED` batch;
  - `purgeStaleImports` deletes old uncommitted batches and keeps recent ones and committed ones;
  - `listRecentImports` only returns batches of writable accounts.
- **e2e** (chromium): import a CSV → "Annuler l'import" → confirm → the rows are gone from `/transactions` and the history shows "Annulé".

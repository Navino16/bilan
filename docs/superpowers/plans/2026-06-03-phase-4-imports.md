# Phase 4 — Import Sources (CSV / PDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import bank transactions from CSV (and PDF after a spike) with a preview/mapping step, content-hash dedup on `(accountId, externalId)`, encrypted labels + search tokens, and auto-categorization — plus a small "add transaction" entry point from the accounts page.

**Architecture:** A clean split between **source-specific parsing** (CSV → mapped rows, PDF → rows) and a **shared commit pipeline** (`commitRows`) that dedups, builds secure fields, auto-categorizes, inserts `Transaction` + `TransactionSearchToken[]`, and updates the `ImportBatch` counters. Uploads go through **API Route Handlers** (`/api/import/*`) per spec §3.2 (large payload, 10s+ parsing); the preview/commit UI calls those routes with `fetch`. Pure parser/normalizer functions are unit-tested; the commit pipeline and routes are integration-tested.

**Tech Stack:** Next 16 (App Router, Route Handlers), Prisma 7 + MariaDB, `papaparse` (CSV), `pdf-parse` (PDF, chosen after the 4.3a spike — revisit if the spike says otherwise), Zod, next-intl, Vitest + Playwright. Crypto + transactions primitives reused from Phase 3 (`buildSecureFields`, `computeExternalId`, `suggest`, `canWriteAccount`).

---

## Conventions reused from Phases 0–3 (read before starting)

- **One scope = one GitHub issue = one branch `feature/4.x-...` = one PR → `develop`.** Run `npm run ci` before every PR; GPG-sign commits (ask the user to unlock GPG if signing fails). PR body: `Closes #<issue>` + the required type label (`enhancement`) plus phase/area labels.
- **Migrations:** `npm run db:migrate -- --name phase_4_x_<slug>` creates `prisma/migrations/<ts>_phase_4_x_<slug>/migration.sql` and applies it to the dev DB (3306). Then `DATABASE_URL=mysql://app:app_password@localhost:3307/budget_test npx prisma migrate deploy` to apply to the **test DB** (3307), `npx prisma generate`, `rm -rf node_modules/.vite/vitest` (clears the stale Prisma client cache that otherwise makes `db.<newModel>` undefined in Vitest), and `docker compose restart app`. Only reset (`db:reset`) when a hand-edited migration must be replayed — and reset needs explicit user consent (Prisma's AI-danger guard) on **both** dev and test DBs.
- **No DB CHECK on FK columns** (MariaDB error 1901) — not relevant here, but see `[[project_mariadb-check-xor-fk]]`.
- **Encrypted-at-rest:** never store clear labels/notes; reuse `buildSecureFields` (AES-256-GCM + HMAC blind index + per-word tokens). No plaintext in any query.
- **Route Handlers** export `GET`/`POST` from `route.ts`. Use `getCurrentUser()` (from `@/server/auth/permissions`) and return `401` when null — `requireSession()` *redirects*, which is wrong for an API/fetch caller.
- **e2e fixtures:** the `owner@e2e.local` user already has a seeded bank account (`scripts/seed-e2e.ts`, id `e2e-owner-account`) and default categories.

---

## File Structure (created or modified in this phase)

**Scope 4.1 — Manual entry from the accounts page**
- Modify: `src/components/accounts/account-list.tsx` — add an "add transaction" action per owned/WRITE account that opens `TransactionForm` with `defaultAccountId`.
- Modify: `src/components/transactions/transaction-form.tsx` — already supports `defaultAccountId`; add a `categories` fetch path note (the accounts page must pass categories). Consider extracting a tiny `AddTransactionButton` if cleaner.
- Modify: `src/app/[locale]/(authenticated)/accounts/page.tsx` — pass categories to the list.
- Modify: `messages/{fr,en}.json` — `accounts.addTransaction`.
- Test: `tests/e2e/manual-entry.spec.ts`.

**Scope 4.2 — CSV import**
- Create: `src/lib/validation/import.ts` — `CSV_FIELDS`, `csvMappingSchema`.
- Modify: `prisma/schema.prisma` — add `ImportBatch`; add `imports ImportBatch[]` to `BankAccount`; add `importBatchId` + `importBatch` + back-relation to `Transaction`.
- Create: `prisma/migrations/<ts>_phase_4_2_imports/migration.sql` (generated).
- Create: `src/server/services/imports/types.ts` — `NormalizedRow`, `CsvMapping`, `ImportPreview`, `CommitSummary`.
- Create: `src/server/services/imports/csv-parse.ts` — pure `parseCsv`, `detectMapping`, `normalizeAmount`, `normalizeDate`, `mapRows`.
- Create: `src/server/services/imports/commit.ts` — `commitRows(batchId, rows, actor)` shared pipeline (dedup + secure fields + suggest + insert + counters).
- Create: `src/server/services/imports/index.ts` — `createCsvBatch`, `previewCsvBatch`, `commitCsvBatch`, `getBatchForUser`.
- Create: `src/app/api/import/csv/route.ts` — upload + parse + preview.
- Create: `src/app/api/import/csv/[batchId]/commit/route.ts` — commit.
- Create: `src/app/[locale]/(authenticated)/import/csv/page.tsx` and `src/components/import/{csv-importer,mapping-form,preview-table}.tsx`.
- Modify: `src/components/shell/nav-items.ts` + `messages/{fr,en}.json` — `import` nav + namespace.
- Test: `tests/unit/services/csv-parse.test.ts`, `tests/integration/imports-csv.test.ts`, `tests/e2e/import-csv.spec.ts`.

**Scope 4.3a — PDF parsing spike**
- Create: `samples/.gitignore` (ignore real bank PDFs), `samples/README.md`.
- Create: `scripts/pdf-spike.ts` — runs `pdf-parse` over `samples/*.pdf`, prints structure.
- Create: `docs/superpowers/notes/2026-MM-DD-pdf-parsing-findings.md` — findings + parser-approach decision.
- Modify: `package.json` — add `pdf-parse`.

**Scope 4.3b — PDF import**
- Create: `src/server/services/imports/pdf-parse.ts` — `parsePdf(buffer) → NormalizedRow[]` (shape per 4.3a findings).
- Create: `src/app/api/import/pdf/route.ts` (+ reuse `commit` route pattern, or a `/api/import/pdf/[batchId]/commit`).
- Modify: `src/components/import/csv-importer.tsx` (or a shared importer) to support a PDF tab/source.
- Test: `tests/unit/services/pdf-parse.test.ts` (against a committed text fixture, not a real PDF), `tests/integration/imports-pdf.test.ts`, `tests/e2e/import-pdf.spec.ts`.

---

## Task 4.1 — Manual entry from the accounts page

**Branch:** `feature/4.1-manual-entry`
**Goal:** Spec §5.4 AC ("e2e from account page"). The transaction form, validation, and category combobox already shipped in 3.4; this scope only adds an entry point from the accounts page that pre-selects the account, and an e2e covering create-from-account.

**Files:**
- Modify: `src/app/[locale]/(authenticated)/accounts/page.tsx`
- Modify: `src/components/accounts/account-list.tsx`
- Modify: `messages/fr.json`, `messages/en.json`
- Test: `tests/e2e/manual-entry.spec.ts`

### Step 1: Add the i18n string

- [ ] **Step 1** — In `messages/fr.json`, under the `accounts` namespace add:

```json
    "addTransaction": "Saisir une transaction",
```

In `messages/en.json`, under `accounts`:

```json
    "addTransaction": "Add a transaction",
```

### Step 2: Pass categories to the account list

- [ ] **Step 2** — In `src/app/[locale]/(authenticated)/accounts/page.tsx`, import the category tree + flattener and pass a flat list to `AccountList`.

Add imports near the top:

```typescript
import { listForUser } from "@/server/services/categories";
import { flattenCategories } from "@/components/transactions/category-tree";
```

In the component body, after `const accounts = await listVisibleForUser(user.id);` add:

```typescript
  const categories = flattenCategories(await listForUser(user.id));
```

Pass it to the list:

```tsx
      <AccountList accounts={accounts} groups={groups} categories={categories} />
```

### Step 3: Render an "add transaction" trigger per writable account

- [ ] **Step 3** — In `src/components/accounts/account-list.tsx`:

Add imports:

```typescript
import { Plus } from "lucide-react";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { FlatCategory } from "@/components/transactions/category-tree";
```

Extend the component props:

```typescript
export function AccountList({
  accounts,
  groups,
  categories,
}: {
  accounts: VisibleAccount[];
  groups: ShareGroup[];
  categories: FlatCategory[];
}) {
```

Inside each account card, in the actions area (next to `RowActions`, rendered for accounts the user can write — i.e. `access === "OWNER" || access === "WRITE"`), add a `TransactionForm` whose trigger is a small icon button and whose `defaultAccountId` is the account id:

```tsx
                {(a.access === "OWNER" || a.access === "WRITE") && (
                  <TransactionForm
                    accounts={accounts
                      .filter((x) => x.access === "OWNER" || x.access === "WRITE")
                      .map((x) => ({ id: x.id, name: x.name }))}
                    categories={categories}
                    defaultAccountId={a.id}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={t("addTransaction")}>
                        <Plus />
                      </Button>
                    }
                  />
                )}
```

> `TransactionForm` (from 3.4) already accepts `accounts`, `categories`, `defaultAccountId`, `trigger` and pre-selects `defaultAccountId`. No form changes needed.

### Step 4: Typecheck

- [ ] **Step 4** — Run: `npm run typecheck`
Expected: PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/app/\[locale\]/\(authenticated\)/accounts/page.tsx src/components/accounts/account-list.tsx messages
git commit -m "feat: add a transaction directly from an account card"
```

### Step 6: Write the e2e

- [ ] **Step 6** — Create `tests/e2e/manual-entry.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("manual entry from accounts", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("adds a transaction from an account card with the account preselected", async ({ page }) => {
    const label = `Loyer ${Date.now()}`;
    await page.goto("/fr/accounts");
    // Open the per-account "add transaction" dialog (first writable account).
    await page.getByRole("button", { name: /saisir une transaction/i }).first().click();
    await page.fill('input[name="date"]', "2026-03-01");
    await page.fill('input[name="amount"]', "-742");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    // It lands in the transactions list.
    await page.goto("/fr/transactions");
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
    ).toBeVisible();
  });
});
```

### Step 7: Run e2e + CI, commit, push, PR

- [ ] **Step 7**

Run: `npm run test:e2e -- manual-entry --project=chromium`
Expected: PASS.

Run: `npm run ci`
Expected: PASS.

```bash
git add tests/e2e/manual-entry.spec.ts
git commit -m "test: add manual-entry-from-account e2e"
git push -u origin feature/4.1-manual-entry
gh pr create --base develop --title "feat: manual entry from accounts" --label "enhancement,phase-4,frontend" --body "Closes #21"
```

---

## Task 4.2 — CSV import

**Branch:** `feature/4.2-csv-import`
**Goal:** Upload a CSV → parse + detect column mapping → preview (first 50 rows with suggested categories) → commit with dedup on `(accountId, externalId)`, encrypted labels, search tokens, and auto-categorization. `ImportBatch` tracks status + counters.

**Files:** see File Structure above.

### Step 1: Install papaparse

- [ ] **Step 1**

Run: `npm install papaparse && npm install -D @types/papaparse`
Expected: both added to `package.json`.

### Step 2: Write the failing CSV-parse unit test

- [ ] **Step 2** — Create `tests/unit/services/csv-parse.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseCsv,
  detectMapping,
  normalizeAmount,
  normalizeDate,
  mapRows,
} from "@/server/services/imports/csv-parse";

const SAMPLE = `Date;Libellé;Débit;Crédit
01/02/2026;CB CARREFOUR CITY;42,90;
03/02/2026;VIR SEPA SALAIRE;;2450,00`;

describe("normalizeAmount", () => {
  it("parses fr-formatted amounts with comma decimals and spaces", () => {
    expect(normalizeAmount("1 234,56")).toBe(1234.56);
    expect(normalizeAmount("42,90")).toBe(42.9);
    expect(normalizeAmount("-7.5")).toBe(-7.5);
    expect(normalizeAmount("")).toBeNull();
    expect(normalizeAmount("abc")).toBeNull();
  });
});

describe("normalizeDate", () => {
  it("parses dd/mm/yyyy and ISO into a UTC date", () => {
    expect(normalizeDate("01/02/2026")?.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(normalizeDate("2026-02-01")?.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(normalizeDate("not a date")).toBeNull();
  });
});

describe("parseCsv + detectMapping", () => {
  it("parses headers/rows and guesses the column mapping", () => {
    const { headers, rows } = parseCsv(SAMPLE);
    expect(headers).toEqual(["Date", "Libellé", "Débit", "Crédit"]);
    expect(rows).toHaveLength(2);
    const mapping = detectMapping(headers);
    expect(mapping.date).toBe("Date");
    expect(mapping.label).toBe("Libellé");
    // Either an "amount" column, or a debit/credit pair.
    expect(mapping.debit).toBe("Débit");
    expect(mapping.credit).toBe("Crédit");
  });
});

describe("mapRows", () => {
  it("turns raw rows into normalized rows (debit negative, credit positive)", () => {
    const { headers, rows } = parseCsv(SAMPLE);
    const mapping = detectMapping(headers);
    const normalized = mapRows(rows, mapping);
    expect(normalized).toEqual([
      { date: new Date("2026-02-01T00:00:00.000Z"), amount: -42.9, rawLabel: "CB CARREFOUR CITY" },
      { date: new Date("2026-02-03T00:00:00.000Z"), amount: 2450, rawLabel: "VIR SEPA SALAIRE" },
    ]);
  });

  it("drops rows with an unparseable date or amount", () => {
    const rows = [{ Date: "xx", Libellé: "X", Débit: "1", Crédit: "" }];
    const mapping = { date: "Date", label: "Libellé", debit: "Débit", credit: "Crédit" } as const;
    expect(mapRows(rows, mapping)).toEqual([]);
  });
});
```

### Step 3: Run to verify it fails

- [ ] **Step 3** — Run: `npm run test:unit -- csv-parse`
Expected: FAIL — `Cannot find module '@/server/services/imports/csv-parse'`.

### Step 4: Implement the import types

- [ ] **Step 4** — Create `src/server/services/imports/types.ts`:

```typescript
// One bank movement after source-specific parsing, before encryption/insert.
// Shared by the CSV (4.2) and PDF (4.3b) pipelines.
export type NormalizedRow = {
  date: Date;
  amount: number; // signed: negative = expense, positive = income
  rawLabel: string;
};

// CSV column mapping: either a single signed `amount` column, or a
// `debit`/`credit` pair (French bank exports). `type` is optional.
export type CsvMapping = {
  date: string;
  label: string;
  amount?: string;
  debit?: string;
  credit?: string;
  type?: string;
};

export type PreviewRow = NormalizedRow & {
  suggestedCategoryId: string | null;
};

export type ImportPreview = {
  batchId: string;
  headers: string[];
  mapping: CsvMapping;
  totalRows: number;
  preview: PreviewRow[]; // first 50 normalized rows
};

export type CommitSummary = {
  batchId: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
};
```

### Step 5: Implement csv-parse

- [ ] **Step 5** — Create `src/server/services/imports/csv-parse.ts`:

```typescript
import Papa from "papaparse";
import type { CsvMapping, NormalizedRow } from "./types";

export type RawRow = Record<string, string>;

// Parses a CSV string. Auto-detects the delimiter (`,` or `;`), trims headers,
// and returns string cells keyed by header.
export function parseCsv(text: string): { headers: string[]; rows: RawRow[] } {
  const result = Papa.parse<RawRow>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields?.map((f) => f.trim()) ?? [];
  return { headers, rows: result.data };
}

const DATE_HINTS = ["date", "date opération", "date operation", "date valeur"];
const LABEL_HINTS = ["libellé", "libelle", "label", "description", "nature", "détail", "detail"];
const AMOUNT_HINTS = ["montant", "amount", "valeur"];
const DEBIT_HINTS = ["débit", "debit", "retrait"];
const CREDIT_HINTS = ["crédit", "credit", "versement"];
const TYPE_HINTS = ["type", "mode", "opération", "operation"];

function pick(headers: string[], hints: string[]): string | undefined {
  const lower = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const i = lower.findIndex((h) => h === hint);
    if (i >= 0) return headers[i];
  }
  for (const hint of hints) {
    const i = lower.findIndex((h) => h.includes(hint));
    if (i >= 0) return headers[i];
  }
  return undefined;
}

// Best-effort column mapping from header names. The UI lets the user correct it.
export function detectMapping(headers: string[]): CsvMapping {
  const amount = pick(headers, AMOUNT_HINTS);
  return {
    date: pick(headers, DATE_HINTS) ?? headers[0] ?? "",
    label: pick(headers, LABEL_HINTS) ?? headers[1] ?? "",
    ...(amount ? { amount } : {}),
    debit: pick(headers, DEBIT_HINTS),
    credit: pick(headers, CREDIT_HINTS),
    type: pick(headers, TYPE_HINTS),
  };
}

// "1 234,56" / "42,90" / "-7.5" → number; "" / garbage → null.
export function normalizeAmount(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(/ /g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// dd/mm/yyyy or yyyy-mm-dd → UTC midnight Date; else null.
export function normalizeDate(raw: string): Date | null {
  const s = raw.trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (fr) return new Date(`${fr[3]}-${fr[2]}-${fr[1]}T00:00:00.000Z`);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
  return null;
}

// Applies the mapping to raw rows, dropping any row whose date or amount is
// unparseable. A debit becomes negative, a credit positive; a single signed
// `amount` column is used as-is.
export function mapRows(rows: RawRow[], mapping: CsvMapping): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  for (const row of rows) {
    const date = normalizeDate(row[mapping.date] ?? "");
    if (!date) continue;

    let amount: number | null = null;
    if (mapping.amount) {
      amount = normalizeAmount(row[mapping.amount] ?? "");
    } else {
      const debit = mapping.debit ? normalizeAmount(row[mapping.debit] ?? "") : null;
      const credit = mapping.credit ? normalizeAmount(row[mapping.credit] ?? "") : null;
      if (debit != null) amount = -Math.abs(debit);
      else if (credit != null) amount = Math.abs(credit);
    }
    if (amount == null) continue;

    const rawLabel = (row[mapping.label] ?? "").trim();
    if (!rawLabel) continue;

    out.push({ date, amount, rawLabel });
  }
  return out;
}
```

### Step 6: Run to verify it passes

- [ ] **Step 6** — Run: `npm run test:unit -- csv-parse`
Expected: PASS (all cases).

### Step 7: Commit

- [ ] **Step 7**

```bash
git add package.json package-lock.json src/server/services/imports/types.ts src/server/services/imports/csv-parse.ts tests/unit/services/csv-parse.test.ts
git commit -m "feat: add CSV parser, column-mapping detection and row normalizer"
```

### Step 8: Add the ImportBatch model + Transaction link

- [ ] **Step 8** — In `prisma/schema.prisma`:

Add to `BankAccount` relations (after `transactions Transaction[]`):

```prisma
  imports      ImportBatch[]
```

Add to the `Transaction` model (after `externalId String?`):

```prisma
  importBatchId String?
  importBatch   ImportBatch? @relation(fields: [importBatchId], references: [id], onDelete: SetNull)
```

Add to the `Transaction` indexes block:

```prisma
  @@index([importBatchId])
```

Add the new model (after `TransactionSearchToken`):

```prisma
model ImportBatch {
  id           String    @id @default(cuid())
  accountId    String
  source       String // CSV | PDF | MANUAL
  filename     String?
  filenameHash String?
  status       String // PENDING | PARSING | REVIEW | COMPLETED | FAILED
  totalRows    Int       @default(0)
  importedRows Int       @default(0)
  skippedRows  Int       @default(0)
  errorMessage String?
  metadata     Json?
  createdById  String
  createdAt    DateTime  @default(now())
  completedAt  DateTime?

  account      BankAccount   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  transactions Transaction[]

  @@index([accountId, createdAt])
}
```

### Step 9: Generate + apply the migration

- [ ] **Step 9**

Run: `npm run db:migrate -- --name phase_4_2_imports`
Expected: migration created + applied to dev DB.

Run: `DATABASE_URL="mysql://app:app_password@localhost:3307/budget_test" npx prisma migrate deploy`
Expected: applied to test DB.

Run: `npx prisma generate && rm -rf node_modules/.vite/vitest && docker compose restart app`
Expected: fresh client; Vitest cache cleared.

### Step 10: Commit schema + migration

- [ ] **Step 10**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add ImportBatch model and Transaction.importBatchId"
```

### Step 11: Add the import validation module

- [ ] **Step 11** — Create `src/lib/validation/import.ts`:

```typescript
import { z } from "zod";

export const CSV_FIELDS = ["date", "label", "amount", "debit", "credit", "type"] as const;

// Mapping submitted at commit time. `date` + `label` always required; either
// `amount`, or at least one of `debit`/`credit`.
export const csvMappingSchema = z
  .object({
    date: z.string().min(1),
    label: z.string().min(1),
    amount: z.string().trim().optional(),
    debit: z.string().trim().optional(),
    credit: z.string().trim().optional(),
    type: z.string().trim().optional(),
  })
  .refine((m) => Boolean(m.amount || m.debit || m.credit), {
    message: "An amount, debit, or credit column is required",
  });

export type CsvMappingInput = z.input<typeof csvMappingSchema>;
```

### Step 12: Write the failing commit-pipeline integration test

- [ ] **Step 12** — Create `tests/integration/imports-csv.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import {
  createCsvBatch,
  previewCsvBatch,
  commitCsvBatch,
  ImportAccessError,
} from "@/server/services/imports";

const owner = "imp_owner";
const stranger = "imp_stranger";
let accountId: string;

const CSV = `Date;Libellé;Débit;Crédit
05/03/2026;CB CARREFOUR CITY;82,37;
06/03/2026;VIR SEPA SALAIRE;;2450,00`;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "imp-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "imp-stranger@bilan.local" } });
  const acc = await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } });
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
    await expect(createCsvBatch({ accountId, filename: "x.csv", text: CSV }, { id: stranger })).rejects.toBeInstanceOf(
      ImportAccessError,
    );
  });

  it("previews with a detected mapping and per-row suggestions", async () => {
    const batch = await createCsvBatch({ accountId, filename: "march.csv", text: CSV }, { id: owner });
    const preview = await previewCsvBatch(batch.id, owner);
    expect(preview.totalRows).toBe(2);
    expect(preview.mapping.date).toBe("Date");
    expect(preview.mapping.debit).toBe("Débit");
    expect(preview.preview[0].amount).toBe(-82.37);
    expect(preview.preview[1].amount).toBe(2450);
  });

  it("commits rows: encrypts labels, writes tokens, sets counters and status", async () => {
    const batch = await createCsvBatch({ accountId, filename: "march2.csv", text: CSV }, { id: owner });
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

  it("dedups a re-import of the same file: 0 imported, all skipped", async () => {
    const batch = await createCsvBatch({ accountId, filename: "march3.csv", text: CSV }, { id: owner });
    const preview = await previewCsvBatch(batch.id, owner);
    const summary = await commitCsvBatch(batch.id, preview.mapping, { id: owner });
    expect(summary.importedRows).toBe(0);
    expect(summary.skippedRows).toBe(2);
  });
});
```

### Step 13: Run to verify it fails

- [ ] **Step 13** — Run: `npm run test:integration -- imports-csv`
Expected: FAIL — `Cannot find module '@/server/services/imports'`.

### Step 14: Implement the shared commit pipeline

- [ ] **Step 14** — Create `src/server/services/imports/commit.ts`:

```typescript
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { buildSecureFields, computeExternalId } from "@/server/services/transactions/secure-fields";
import { suggest } from "@/server/services/categorization";
import type { CommitSummary, NormalizedRow } from "./types";

// Shared by CSV (4.2) and PDF (4.3b). Authorization + batch existence are the
// caller's responsibility. Dedups against existing `(accountId, externalId)`
// rows (including duplicates within the same file), encrypts labels, writes
// per-word search tokens, auto-categorizes, and updates the batch counters.
export async function commitRows(
  batch: { id: string; accountId: string },
  rows: NormalizedRow[],
  actor: { id: string },
): Promise<CommitSummary> {
  // Pre-compute externalIds and load the ones that already exist for the account.
  const withIds = rows.map((r) => ({
    row: r,
    externalId: computeExternalId(r.date, r.amount, r.rawLabel),
  }));
  const existing = await db.transaction.findMany({
    where: { accountId: batch.accountId, externalId: { in: withIds.map((w) => w.externalId) } },
    select: { externalId: true },
  });
  const seen = new Set(existing.map((e) => e.externalId));

  let imported = 0;
  let skipped = 0;
  for (const { row, externalId } of withIds) {
    if (seen.has(externalId)) {
      skipped++;
      continue;
    }
    seen.add(externalId); // guards against in-file duplicates too

    const secure = buildSecureFields({ label: row.rawLabel, rawLabel: row.rawLabel });
    const suggestion = await suggest(row.rawLabel, { userId: actor.id });
    await db.transaction.create({
      data: {
        accountId: batch.accountId,
        date: row.date,
        amount: row.amount,
        type: "OTHER",
        labelEnc: secure.labelEnc,
        labelHash: secure.labelHash,
        rawLabelEnc: secure.rawLabelEnc,
        rawLabelHash: secure.rawLabelHash,
        noteEnc: null,
        categoryId: suggestion.categoryId,
        manuallyCategorized: false,
        externalId,
        importBatchId: batch.id,
        createdById: actor.id,
        searchTokens: { create: secure.tokens.map((tokenHash) => ({ tokenHash })) },
      },
    });
    imported++;
  }

  const updated = await db.importBatch.update({
    where: { id: batch.id },
    data: {
      status: "COMPLETED",
      totalRows: rows.length,
      importedRows: imported,
      skippedRows: skipped,
      completedAt: new Date(),
    },
  });
  await logEvent({
    userId: actor.id,
    action: "import.committed",
    entity: "ImportBatch",
    entityId: batch.id,
    metadata: { imported, skipped, total: rows.length },
  });
  return {
    batchId: updated.id,
    totalRows: rows.length,
    importedRows: imported,
    skippedRows: skipped,
  };
}
```

> Note: the import label is used as both `label` and `rawLabel` (banks give one string). The user can rename per-transaction later (3.4 detail panel).

### Step 15: Implement the imports service (CSV orchestration)

- [ ] **Step 15** — Create `src/server/services/imports/index.ts`:

```typescript
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
  await logEvent({ userId: actor.id, action: "import.created", entity: "ImportBatch", entityId: batch.id });
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
  await db.importBatch.update({ where: { id: batchId }, data: { status: "REVIEW", totalRows: normalized.length } });

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
```

### Step 16: Run to verify it passes

- [ ] **Step 16** — Run: `npm run test:integration -- imports-csv`
Expected: PASS (4 tests).

### Step 17: Commit

- [ ] **Step 17**

```bash
git add src/lib/validation/import.ts src/server/services/imports/commit.ts src/server/services/imports/index.ts tests/integration/imports-csv.test.ts
git commit -m "feat: add CSV import service (batch, preview, commit with dedup + categorization)"
```

### Step 18: Implement the upload + preview Route Handler

- [ ] **Step 18** — Create `src/app/api/import/csv/route.ts`:

```typescript
import { getCurrentUser } from "@/server/auth/permissions";
import { createCsvBatch, previewCsvBatch, ImportAccessError } from "@/server/services/imports";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const accountId = String(form.get("accountId") ?? "");
  if (!(file instanceof File) || !accountId) {
    return Response.json({ error: "INVALID" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return Response.json({ error: "TOO_LARGE" }, { status: 413 });
  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && file.type !== "text/csv") {
    return Response.json({ error: "BAD_TYPE" }, { status: 415 });
  }

  const text = await file.text();
  try {
    const batch = await createCsvBatch({ accountId, filename: file.name, text }, { id: user.id });
    const preview = await previewCsvBatch(batch.id, user.id);
    return Response.json(preview);
  } catch (e) {
    if (e instanceof ImportAccessError) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    return Response.json({ error: "PARSE_FAILED" }, { status: 422 });
  }
}
```

### Step 19: Implement the commit Route Handler

- [ ] **Step 19** — Create `src/app/api/import/csv/[batchId]/commit/route.ts`:

```typescript
import { getCurrentUser } from "@/server/auth/permissions";
import { commitCsvBatch, ImportAccessError } from "@/server/services/imports";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { batchId } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.mapping) return Response.json({ error: "INVALID" }, { status: 400 });
  try {
    const summary = await commitCsvBatch(batchId, body.mapping, { id: user.id });
    return Response.json(summary);
  } catch (e) {
    if (e instanceof ImportAccessError) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    return Response.json({ error: "COMMIT_FAILED" }, { status: 422 });
  }
}
```

### Step 20: Add the `import` i18n namespace + nav entry

- [ ] **Step 20** — In `messages/fr.json` add a top-level `"import"` namespace:

```json
  "import": {
    "title": "Importer",
    "subtitle": "Importez vos opérations depuis un fichier de votre banque.",
    "csvTab": "CSV",
    "pdfTab": "PDF",
    "account": "Compte",
    "chooseFile": "Choisir un fichier",
    "drop": "Déposez un fichier CSV ici, ou cliquez pour parcourir.",
    "mapping": "Correspondance des colonnes",
    "colDate": "Date",
    "colLabel": "Libellé",
    "colAmount": "Montant",
    "colDebit": "Débit",
    "colCredit": "Crédit",
    "colType": "Type",
    "none": "—",
    "preview": "Aperçu",
    "rowsDetected": "{count, plural, one {# ligne détectée} other {# lignes détectées}}",
    "commit": "Importer",
    "importing": "Import en cours…",
    "summary": "{imported} importées · {skipped} ignorées (doublons)",
    "viewTransactions": "Voir les transactions",
    "error": {
      "INVALID": "Vérifiez le fichier et le compte.",
      "BAD_TYPE": "Format de fichier non supporté.",
      "TOO_LARGE": "Fichier trop volumineux (5 Mo max).",
      "FORBIDDEN": "Action non autorisée.",
      "PARSE_FAILED": "Impossible de lire le fichier.",
      "COMMIT_FAILED": "Échec de l'import. Réessayez."
    }
  },
```

In `messages/en.json`, mirror:

```json
  "import": {
    "title": "Import",
    "subtitle": "Import your transactions from a file exported by your bank.",
    "csvTab": "CSV",
    "pdfTab": "PDF",
    "account": "Account",
    "chooseFile": "Choose a file",
    "drop": "Drop a CSV file here, or click to browse.",
    "mapping": "Column mapping",
    "colDate": "Date",
    "colLabel": "Label",
    "colAmount": "Amount",
    "colDebit": "Debit",
    "colCredit": "Credit",
    "colType": "Type",
    "none": "—",
    "preview": "Preview",
    "rowsDetected": "{count, plural, one {# row detected} other {# rows detected}}",
    "commit": "Import",
    "importing": "Importing…",
    "summary": "{imported} imported · {skipped} skipped (duplicates)",
    "viewTransactions": "View transactions",
    "error": {
      "INVALID": "Check the file and account.",
      "BAD_TYPE": "Unsupported file type.",
      "TOO_LARGE": "File too large (5 MB max).",
      "FORBIDDEN": "Not allowed.",
      "PARSE_FAILED": "Could not read the file.",
      "COMMIT_FAILED": "Import failed. Try again."
    }
  },
```

In `src/components/shell/nav-items.ts`, import the icon and add to `WORKSPACE_NAV` after `transactions`:

```typescript
import { Upload } from "lucide-react";
```

```typescript
  { key: "import", href: "/import/csv", icon: Upload },
```

Add the nav label under `shell.nav` in both files: `"import": "Importer"` (fr) / `"import": "Import"` (en).

### Step 21: Build the CSV importer UI

- [ ] **Step 21** — Create `src/components/import/csv-importer.tsx` (client). It owns the three phases (upload → review → done) and calls the Route Handlers with `fetch`.

```typescript
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CSV_FIELDS } from "@/lib/validation/import";

type PreviewRow = { date: string; amount: number; rawLabel: string; suggestedCategoryId: string | null };
type Preview = {
  batchId: string;
  headers: string[];
  mapping: Record<string, string | undefined>;
  totalRows: number;
  preview: PreviewRow[];
};
type Summary = { importedRows: number; skippedRows: number };

export function CsvImporter({ accounts }: { accounts: { id: string; name: string }[] }) {
  const t = useTranslations("import");
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("accountId", accountId);
    const res = await fetch("/api/import/csv", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "PARSE_FAILED");
    setPreview(data);
    setMapping(Object.fromEntries(Object.entries(data.mapping).filter(([, v]) => v)) as Record<string, string>);
  }

  function commit() {
    if (!preview) return;
    startTransition(async () => {
      const res = await fetch(`/api/import/csv/${preview.batchId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "COMMIT_FAILED");
      setSummary(data);
      router.refresh();
    });
  }

  if (summary) {
    return (
      <div className="border-border space-y-3 rounded-xl border p-6">
        <p className="text-sm">{t("summary", { imported: summary.importedRows, skipped: summary.skippedRows })}</p>
        <Button render={<Link href="/transactions" />}>{t("viewTransactions")}</Button>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="space-y-4">
        <label className="space-y-1.5 block">
          <span className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
            {t("account")}
          </span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="border-input bg-background h-9 w-full max-w-sm rounded-md border px-3 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="border-border hover:bg-muted/40 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <Upload className="text-muted-foreground size-6" />
          <span className="text-muted-foreground text-sm">{t("drop")}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
        {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[0.7rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {t("mapping")}
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3">
          {CSV_FIELDS.map((field) => (
            <label key={field} className="space-y-1 text-sm">
              <span className="text-muted-foreground text-xs">{t(`col${field[0].toUpperCase()}${field.slice(1)}`)}</span>
              <select
                value={mapping[field] ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              >
                <option value="">{t("none")}</option>
                {preview.headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-[0.7rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {t("preview")} · {t("rowsDetected", { count: preview.totalRows })}
        </h2>
        <div className="border-border mt-2 overflow-hidden rounded-xl border">
          {preview.preview.slice(0, 20).map((r, i) => (
            <div
              key={i}
              data-slot="import-preview-row"
              className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-b-0"
            >
              <span className="text-muted-foreground w-24 text-xs tabular-nums">
                {r.date.slice(0, 10)}
              </span>
              <span className="flex-1 truncate">{r.rawLabel}</span>
              <span
                className="tabular-nums"
                style={r.amount > 0 ? { color: "var(--income)" } : undefined}
              >
                {r.amount.toFixed(2)} €
              </span>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
      <Button onClick={commit} disabled={pending}>
        {pending ? t("importing") : t("commit")}
      </Button>
    </div>
  );
}
```

> `preview.preview[].date` arrives as a JSON string (Date serialized over `fetch`), hence the `.slice(0, 10)`.

### Step 22: Build the import page

- [ ] **Step 22** — Create `src/app/[locale]/(authenticated)/import/csv/page.tsx`:

```typescript
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listVisibleForUser } from "@/server/services/accounts";
import { CsvImporter } from "@/components/import/csv-importer";

export const dynamic = "force-dynamic";

export default async function ImportCsvPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("import");
  const accounts = (await listVisibleForUser(user.id))
    .filter((a) => a.access === "OWNER" || a.access === "WRITE")
    .map((a) => ({ id: a.id, name: a.name }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>
      <CsvImporter accounts={accounts} />
    </div>
  );
}
```

### Step 23: Typecheck + CI

- [ ] **Step 23**

Run: `npm run typecheck` → PASS.
Run: `npm run ci` → PASS (lint + typecheck + unit + integration).

### Step 24: Write the e2e

- [ ] **Step 24** — Create `tests/e2e/import-csv.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("CSV import", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog refinement deferred to Phase 8.3",
  );

  test("upload → preview → commit → see imported transactions", async ({ page }) => {
    const stamp = Date.now();
    const csv = `Date;Libellé;Débit;Crédit
07/03/2026;CB IMPORT ${stamp};19,99;
08/03/2026;VIR IMPORT ${stamp};;100,00`;

    await page.goto("/fr/import/csv");
    // Upload via the hidden file input.
    await page.locator('input[type="file"]').setInputFiles({
      name: "import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });

    // Preview appears.
    await expect(page.locator('[data-slot="import-preview-row"]').first()).toBeVisible();

    await page.getByRole("button", { name: /^importer$/i }).click();
    await page.getByRole("link", { name: /voir les transactions/i }).click();

    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: `CB IMPORT ${stamp}` }).first(),
    ).toBeVisible();
  });
});
```

### Step 25: Run e2e + commit, push, PR

- [ ] **Step 25**

Run: `npm run test:e2e -- import-csv --project=chromium`
Expected: PASS (chromium).

```bash
git add src/app/api/import src/app/\[locale\]/\(authenticated\)/import src/components/import src/components/shell/nav-items.ts messages tests/e2e/import-csv.spec.ts
git commit -m "feat: CSV import UI (upload, mapping, preview, commit) via route handlers"
git push -u origin feature/4.2-csv-import
gh pr create --base develop --title "feat: CSV import" --label "enhancement,phase-4,frontend,backend" --body "Closes #22"
```

---

## Task 4.3a — PDF parsing spike

**Branch:** `feature/4.3a-pdf-spike`
**Goal:** Install `pdf-parse`, run it on the user's real bank PDFs, document the extracted text structure, and decide the parser approach for 4.3b. Output: a committed findings note (no app code beyond the spike script + dependency).

> A spike is exploratory, not TDD. The steps below produce a reproducible script and a written decision; the only "test" is that the script runs and the note is committed.

**Files:** see File Structure above.

### Step 1: Install pdf-parse

- [ ] **Step 1**

Run: `npm install pdf-parse`
Expected: added to `package.json`.

### Step 2: Add a samples directory (real PDFs git-ignored)

- [ ] **Step 2** — Create `samples/README.md`:

```markdown
# Import samples

Drop real bank statement files here to develop/spike importers. **Real bank
files are git-ignored** (they contain personal data). Only this README and any
explicitly-added anonymized fixtures are tracked.
```

Create `samples/.gitignore`:

```gitignore
*
!.gitignore
!README.md
```

### Step 3: Write the spike script

- [ ] **Step 3** — Create `scripts/pdf-spike.ts`:

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pdf from "pdf-parse";

// Usage: npx tsx scripts/pdf-spike.ts
// Prints, for each PDF in samples/, the page count and the first ~60 lines of
// extracted text so we can see the statement structure (date/label/amount columns).
async function main() {
  const dir = "samples";
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (files.length === 0) {
    console.log("No PDFs in samples/. Drop a bank statement there and re-run.");
    return;
  }
  for (const file of files) {
    const data = await pdf(readFileSync(join(dir, file)));
    console.log(`\n===== ${file} — ${data.numpages} page(s), ${data.text.length} chars =====`);
    console.log(data.text.split("\n").slice(0, 60).join("\n"));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

### Step 4: Run the spike on real PDFs

- [ ] **Step 4** — Ask the user to drop one or more real bank PDF statements into `samples/`.

Run: `npx tsx scripts/pdf-spike.ts`
Expected: prints page counts + extracted text per file. Read the output and note: are rows on one line each? Where are date/label/amount? Is text columnar or interleaved? Are amounts grouped as debit/credit? Is any file scanned (empty text → OCR needed)?

### Step 5: Write the findings note + decision

- [ ] **Step 5** — Create `docs/superpowers/notes/2026-MM-DD-pdf-parsing-findings.md` (use today's date) documenting:
  - For each sample: bank, page count, whether text extraction works (or it's scanned).
  - The line/column structure of a transaction row (with a redacted example line).
  - A regex or line-grammar sketch for `parsePdf` → `NormalizedRow[]`.
  - **Decision:** keep `pdf-parse` (text-based) or switch (e.g. `unpdf`, or OCR via `tesseract.js` only if scanned). State the chosen approach for 4.3b and any per-bank assumptions.

### Step 6: Commit + PR

- [ ] **Step 6**

```bash
git add package.json package-lock.json samples/README.md samples/.gitignore scripts/pdf-spike.ts docs/superpowers/notes
git commit -m "chore: PDF parsing spike (pdf-parse) + findings note"
git push -u origin feature/4.3a-pdf-spike
gh pr create --base develop --title "chore: PDF parsing spike" --label "infra,phase-4,backend" --body "Closes #23"
```

> Do **not** commit any real bank PDF. Confirm `git status` shows none staged before pushing.

---

## Task 4.3b — PDF import

**Branch:** `feature/4.3b-pdf-import`
**Goal:** A `parsePdf` based on the 4.3a findings that yields `NormalizedRow[]`, wired into the **same** preview/commit pipeline as CSV (reusing `commitRows`), exposed at `/api/import/pdf` and a PDF source in the importer UI.

> The exact `parsePdf` body depends on the 4.3a note. Below is the structure + tests; replace the line-parsing regex with the grammar decided in 4.3a. The test runs against a **committed text fixture** (the extracted-text shape), not a binary PDF, so it is deterministic and contains no personal data.

**Files:** see File Structure above.

### Step 1: Write the failing parser unit test

- [ ] **Step 1** — Create `tests/unit/services/pdf-parse.test.ts`. Replace `FIXTURE` with a redacted real extracted-text snippet from the 4.3a note, and the expectations with its true values.

```typescript
import { describe, it, expect } from "vitest";
import { parsePdfText } from "@/server/services/imports/pdf-parse";

// Extracted-text shape observed in the 4.3a spike (redacted, representative).
const FIXTURE = `RELEVE DE COMPTE
01/02/2026 CB CARREFOUR CITY 42,90
03/02/2026 VIR SEPA SALAIRE 2 450,00
SOLDE 2407,10`;

describe("parsePdfText", () => {
  it("extracts transaction rows from the statement text", () => {
    const rows = parsePdfText(FIXTURE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      date: new Date("2026-02-01T00:00:00.000Z"),
      amount: -42.9,
      rawLabel: "CB CARREFOUR CITY",
    });
    expect(rows[1].amount).toBe(2450);
  });

  it("ignores non-transaction lines (headers, balance)", () => {
    expect(parsePdfText("RELEVE\nSOLDE 1,00").length).toBe(0);
  });
});
```

> Sign of debit vs credit is bank-specific (column position, +/- sign, or a separate debit/credit area). Encode the rule from 4.3a here. If the statement has no sign and relies on a debit/credit column, parse accordingly so expenses come out negative.

### Step 2: Run to verify it fails

- [ ] **Step 2** — Run: `npm run test:unit -- pdf-parse`
Expected: FAIL — `Cannot find module '@/server/services/imports/pdf-parse'`.

### Step 3: Implement the PDF parser

- [ ] **Step 3** — Create `src/server/services/imports/pdf-parse.ts`. Reuse the normalizers from `csv-parse`. The `parsePdfText` line grammar below is a starting point — **adjust to the 4.3a findings.**

```typescript
import { normalizeAmount, normalizeDate } from "./csv-parse";
import type { NormalizedRow } from "./types";

// Line grammar (adjust per the 4.3a findings note): "<dd/mm/yyyy> <label...> <amount>".
// Amount sign convention is bank-specific — see the note.
const LINE = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d  ]+[.,]\d{2})$/;

export function parsePdfText(text: string): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  for (const line of text.split("\n")) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    const date = normalizeDate(m[1]);
    const amount = normalizeAmount(m[3]);
    const rawLabel = m[2].trim();
    if (!date || amount == null || !rawLabel) continue;
    // Per 4.3a: a debit is negative. If the statement shows bare positives in a
    // debit column, negate here. Default below assumes a signed amount.
    out.push({ date, amount, rawLabel });
  }
  return out;
}

// Extracts text from a PDF buffer, then parses rows. Kept separate so the pure
// `parsePdfText` is unit-testable without a binary fixture.
export async function parsePdf(buffer: Buffer): Promise<NormalizedRow[]> {
  const pdf = (await import("pdf-parse")).default;
  const data = await pdf(buffer);
  return parsePdfText(data.text);
}
```

### Step 4: Run to verify it passes

- [ ] **Step 4** — Run: `npm run test:unit -- pdf-parse`
Expected: PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/server/services/imports/pdf-parse.ts tests/unit/services/pdf-parse.test.ts
git commit -m "feat: add PDF statement parser"
```

### Step 6: Add createPdfBatch + commitPdfBatch to the imports service

- [ ] **Step 6** — In `src/server/services/imports/index.ts` add a PDF path that stores the extracted **text** (not the binary) in the batch and reuses `mapRows`-free `parsePdfText` + `commitRows`.

Add imports at the top:

```typescript
import { parsePdfText } from "./pdf-parse";
```

Add these exports:

```typescript
// PDF: we extract text in the route (Node runtime), store it in the batch, and
// parse rows from text in preview/commit so the pipeline mirrors CSV.
export async function createPdfBatch(
  input: { accountId: string; filename: string; text: string },
  actor: { id: string },
): Promise<{ id: string }> {
  if (!(await canWriteAccount(actor.id, input.accountId))) throw new ImportAccessError("FORBIDDEN");
  const batch = await db.importBatch.create({
    data: {
      accountId: input.accountId,
      source: "PDF",
      filename: input.filename,
      filenameHash: createHash("sha256").update(input.filename).digest("hex"),
      status: "REVIEW",
      createdById: actor.id,
      metadata: { text: input.text } as never,
    },
  });
  await logEvent({ userId: actor.id, action: "import.created", entity: "ImportBatch", entityId: batch.id });
  return { id: batch.id };
}

export async function previewPdfBatch(batchId: string, userId: string) {
  const batch = await loadBatch(batchId, userId);
  const text = (batch.metadata as { text?: string } | null)?.text ?? "";
  const rows = parsePdfText(text);
  await db.importBatch.update({ where: { id: batchId }, data: { totalRows: rows.length } });
  const preview = await Promise.all(
    rows.slice(0, 50).map(async (r) => ({
      ...r,
      suggestedCategoryId: (await suggest(r.rawLabel, { userId })).categoryId,
    })),
  );
  return { batchId, totalRows: rows.length, preview };
}

export async function commitPdfBatch(batchId: string, actor: { id: string }) {
  const batch = await loadBatch(batchId, actor.id);
  const text = (batch.metadata as { text?: string } | null)?.text ?? "";
  const rows = parsePdfText(text);
  return commitRows({ id: batch.id, accountId: batch.accountId }, rows, actor);
}
```

### Step 7: Write the failing PDF integration test

- [ ] **Step 7** — Create `tests/integration/imports-pdf.test.ts` (mirrors the CSV test; uses the extracted-text path via `createPdfBatch`):

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createPdfBatch, commitPdfBatch } from "@/server/services/imports";

const owner = "pdf_owner";
let accountId: string;
const TEXT = `RELEVE DE COMPTE
05/03/2026 CB CARREFOUR CITY 82,37
06/03/2026 VIR SEPA SALAIRE 2 450,00`;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: owner } });
  await db.user.create({ data: { id: owner, email: "pdf-owner@bilan.local" } });
  accountId = (await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })).id;
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.importBatch.deleteMany({ where: { accountId } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.user.deleteMany({ where: { id: owner } });
  await db.$disconnect();
});

describe("PDF import pipeline", () => {
  it("parses the statement text and commits transactions", async () => {
    const batch = await createPdfBatch({ accountId, filename: "releve.pdf", text: TEXT }, { id: owner });
    const summary = await commitPdfBatch(batch.id, { id: owner });
    expect(summary.importedRows).toBe(2);
    const rows = await db.transaction.findMany({ where: { importBatchId: batch.id } });
    expect(rows).toHaveLength(2);
  });

  it("dedups a re-import: 0 imported", async () => {
    const batch = await createPdfBatch({ accountId, filename: "releve2.pdf", text: TEXT }, { id: owner });
    const summary = await commitPdfBatch(batch.id, { id: owner });
    expect(summary.importedRows).toBe(0);
    expect(summary.skippedRows).toBe(2);
  });
});
```

> Adjust `TEXT` + expectations to match the grammar finalized in 4.3a/4.3b Step 1.

### Step 8: Run to verify it passes

- [ ] **Step 8** — Run: `npm run test:integration -- imports-pdf`
Expected: PASS.

### Step 9: Implement the PDF upload Route Handler

- [ ] **Step 9** — Create `src/app/api/import/pdf/route.ts`:

```typescript
import { getCurrentUser } from "@/server/auth/permissions";
import { createPdfBatch, previewPdfBatch, ImportAccessError } from "@/server/services/imports";
import { parsePdf } from "@/server/services/imports/pdf-parse";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  const accountId = String(form.get("accountId") ?? "");
  if (!(file instanceof File) || !accountId) return Response.json({ error: "INVALID" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "TOO_LARGE" }, { status: 413 });
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return Response.json({ error: "BAD_TYPE" }, { status: 415 });
  }
  try {
    // Extract text here (Node runtime), reuse the same text → rows pipeline.
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = await parsePdf(buffer); // also validates it parses
    const data = (await import("pdf-parse")).default;
    const text = (await data(buffer)).text;
    void rows;
    const batch = await createPdfBatch({ accountId, filename: file.name, text }, { id: user.id });
    const preview = await previewPdfBatch(batch.id, user.id);
    return Response.json(preview);
  } catch (e) {
    if (e instanceof ImportAccessError) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    return Response.json({ error: "PARSE_FAILED" }, { status: 422 });
  }
}
```

> Simplify the double parse: extract `text` once, pass to `createPdfBatch`; `previewPdfBatch` re-parses rows from the stored text. (The `parsePdf` call above is only to fail fast on an unreadable PDF — collapse it if redundant after 4.3a.)

### Step 10: Implement the PDF commit Route Handler

- [ ] **Step 10** — Create `src/app/api/import/pdf/[batchId]/commit/route.ts`:

```typescript
import { getCurrentUser } from "@/server/auth/permissions";
import { commitPdfBatch, ImportAccessError } from "@/server/services/imports";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { batchId } = await params;
  try {
    const summary = await commitPdfBatch(batchId, { id: user.id });
    return Response.json(summary);
  } catch (e) {
    if (e instanceof ImportAccessError) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
    return Response.json({ error: "COMMIT_FAILED" }, { status: 422 });
  }
}
```

### Step 11: Add a PDF source to the importer UI

- [ ] **Step 11** — Add a `/import/pdf` page mirroring the CSV page, and a `PdfImporter` (or generalize `CsvImporter` with a `source` prop: different `accept`, endpoints, and no mapping step for PDF — it commits directly after preview). Minimal approach: create `src/components/import/pdf-importer.tsx` modeled on `CsvImporter` but posting to `/api/import/pdf` and `/api/import/pdf/[batchId]/commit` (no mapping selects; preview → commit). Add `src/app/[locale]/(authenticated)/import/pdf/page.tsx` and a tab/link between CSV and PDF in both pages (using `import.csvTab` / `import.pdfTab`).

### Step 12: Typecheck + CI + e2e

- [ ] **Step 12**

Run: `npm run ci` → PASS.

Create `tests/e2e/import-pdf.spec.ts` only if a deterministic PDF fixture is available (generating a PDF in-test is heavy). Otherwise rely on the integration test for the pipeline and add an e2e that asserts the `/fr/import/pdf` page renders + redirects when unauthenticated:

```typescript
import { test, expect } from "@playwright/test";

test("unauthenticated /import/pdf redirects to login", async ({ page }) => {
  await page.goto("/fr/import/pdf");
  await expect(page).toHaveURL(/\/login$/);
});
```

Run: `npm run test:e2e -- import-pdf --project=chromium` → PASS.

### Step 13: Commit, push, PR

- [ ] **Step 13**

```bash
git add src/server/services/imports/index.ts src/app/api/import/pdf src/app/\[locale\]/\(authenticated\)/import/pdf src/components/import tests
git commit -m "feat: PDF import (parser + route handlers + UI) reusing the CSV pipeline"
git push -u origin feature/4.3b-pdf-import
gh pr create --base develop --title "feat: PDF import" --label "enhancement,phase-4,frontend,backend" --body "Closes #24"
```

---

## Self-Review notes (for the executor)

**Spec coverage (PLAN.md Phase 4 + spec §5.5/§4.7/§9):**
- 4.1 Manual entry polish + account preselect + e2e from account page → Task 4.1 (reuses the 3.4 `TransactionForm` with `defaultAccountId`). ✅
- 4.2 `ImportBatch`, `/api/import/csv` (upload, papaparse, mapping detection), preview UI, dedup `(accountId, externalId)`, batch commit + tokens + categorization → Task 4.2 (`csv-parse` pure + unit-tested, `commitRows` shared pipeline integration-tested for import + dedup re-import, route handlers, importer UI, e2e upload→preview→commit). ✅
- 4.3a PDF spike (install pdf-parse, run on real PDFs, findings note + decision) → Task 4.3a. ✅
- 4.3b PDF import (parser from 4.3a, `/api/import/pdf`, same preview+dedup+categorization pipeline) → Task 4.3b (`parsePdfText` pure + unit-tested against a text fixture, reuses `commitRows`, integration parse→tx + dedup). ✅

**Type consistency:** `NormalizedRow { date, amount, rawLabel }` is the single contract between parsers (`csv-parse.mapRows`, `pdf-parse.parsePdfText`) and `commitRows`. `CsvMapping` shared between `detectMapping`/`mapRows`/`csvMappingSchema`. `ImportAccessError` thrown by the service, mapped to 403 in every route. `commitRows(batch:{id,accountId}, rows, actor)` signature matches both CSV and PDF callers. `suggest(rawLabel, { userId })` and `buildSecureFields`/`computeExternalId` reused unchanged from Phase 3.

**Known deviations / decisions (documented, not gaps):**
- Import stores the raw CSV/extracted-PDF **text** in `ImportBatch.metadata.text` (MVP). A blob store for very large files is out of scope. Note: that text is plaintext-at-rest in `metadata` — acceptable for the import window, but if flagged in 8.5 security hardening, encrypt it or drop it after commit.
- Imported rows use the bank label as both `label` and `rawLabel`; `type` defaults to `OTHER` (CSV `type` column mapping can refine this later — left simple).
- `commitRows` inserts per-row (N creates) for clarity over a raw bulk insert; fine for statement-sized files.
- PDF e2e uses a redirect-only smoke test unless a deterministic PDF fixture exists; the parse→commit path is covered by the integration test against a text fixture.
- `parsePdfText`'s line grammar is a placeholder to be finalized from the 4.3a findings before implementing 4.3b Step 3.

**Before each PR:** `git checkout develop && git pull`, delete merged branches, branch `feature/4.x-...`, run `npm run ci`, GPG-sign commits (ask the user to unlock GPG if signing fails), open the PR with `Closes #<issue>` and the required type label (`enhancement`/`infra`) plus phase/area labels. After a migration, also deploy it to the test DB (3307), regenerate the client, clear the Vitest cache, and restart the app container (see Conventions).
```

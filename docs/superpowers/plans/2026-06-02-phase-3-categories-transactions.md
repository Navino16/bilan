# Phase 3 — Categories, Rules & Manual Transactions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can manage hierarchical **categories** (owned by a user XOR a group), record **manual transactions** with encrypted/searchable labels, get **auto-categorization** from user/group rules (with a "create a rule?" learning loop), and browse/search/recategorize transactions in a list (day-grouped cards on mobile, table on desktop).

**Architecture:** Each scope = one GitHub issue = one `feature/3.x-...` branch = one PR → `develop`. Business logic lives in pure, tested services under `src/server/services/*`; Server Actions in `src/server/transport/actions/*` are thin wrappers that resolve the session, `safeParse` the form, call the service, and map typed errors to `{ ok: false, error }`. Sensitive transaction fields are encrypted at the application layer (AES-256-GCM) with HMAC blind-index search tokens — the crypto primitives already exist from scope 0.4 (`src/server/crypto/*`). Owner-XOR (user vs. group) is enforced both in the service layer and by a DB `CHECK` constraint. Transaction visibility reuses the Phase 2 permission layer (`listVisibleForUser`, `canWriteAccount`, `getEffectiveAccess`).

**Tech Stack:** Next.js 16 (App Router, `src/`, RSC + Server Actions) · React 19 · TypeScript 6 strict · Prisma 7 + `@prisma/adapter-mariadb` · MariaDB 11 · Zod 4 · next-intl (fr/en) · shadcn/ui (Dialog, Input, Select, …) · Vitest (unit + integration) · Playwright (e2e).

---

## Conventions reused from Phases 0–2 (read before starting)

These are **established patterns** — match them exactly.

- **No Prisma/TS enums.** Enum-like fields are `String` in Prisma, with a `readonly` string-literal array + derived type in `src/lib/validation/*` (e.g. `ACCOUNT_TYPES` / `AccountType` in `src/lib/validation/account.ts`), validated with `z.enum(...)`.
- **Crypto (already built, do not reimplement):**
  - `encrypt(plaintext, key)` / `decrypt(stored, key)` — `src/server/crypto/encryption.ts` (AES-256-GCM, format `v1.iv.ct.tag`).
  - `hmacForSearch(input, key)` — `src/server/crypto/hmac.ts` (HMAC-SHA256 of the normalized full string; equality/blind-index).
  - `tokenize(input)` — normalized words ≥ 3 chars, deduped.
  - `hmacTokens(input, key)` — per-word HMAC for search tokens.
  - `dataKey` (AES) and `searchKey` (HMAC) — `src/server/crypto/keys.ts`.
  - `normalize` strips diacritics, lowercases, collapses whitespace (internal to hmac.ts).
- **Services** throw a typed error class (e.g. `class CategoryAccessError extends Error {}`) for both auth and business-invalid cases; they `parse()` the Zod schema at the boundary and write an audit entry via `logEvent({ userId, action, entity, entityId })` (`src/server/services/audit`).
- **Server Actions** (`"use server"`): `const user = await requireSession();` (from `@/server/auth/permissions`), `safeParse` the `FormData`, `try/catch` the service mapping the typed error → a stable string key, return `{ ok: true } | { ok: false; error } | null`. No `revalidatePath` — the client calls `router.refresh()` after success.
- **Pages** are RSC: `export const dynamic = "force-dynamic"`, `const { locale } = await params; setRequestLocale(locale);`, `const user = await requireSession();`, `const t = await getTranslations("<ns>");`, fetch via services (never raw Prisma in a page).
- **Forms** are `"use client"` Dialogs (`@/components/ui/dialog`): controlled/uncontrolled `open`, `useTransition`, `<form action={handleAction}>`, on `ok` → `setOpen(false); router.refresh();` else `setError(result.error)`. Errors render via `t("error.<KEY>")`.
- **Group role checks**: `requireGroupRole(groupId, userId, "ADMIN")` from `@/server/services/groups/roles` (throws `GroupAccessError`); ranks OWNER > ADMIN > MEMBER.
- **Account access**: `canWriteAccount(userId, accountId)`, `canReadAccount(...)`, `getEffectiveAccess(...)`, `listVisibleForUser(userId)` from `@/server/services/accounts` (`index.ts` / `sharing.ts`).
- **Migrations**: `npm run db:migrate -- --name phase_3_x_<slug>` creates `prisma/migrations/<timestamp>_phase_3_x_<slug>/migration.sql`. After editing the schema, generate the migration, then **hand-append** any `CHECK` constraint Prisma can't express (see 3.1 Task) into that `migration.sql` and re-run `npm run db:migrate` (it applies the appended SQL on the existing draft) — or add a follow-up empty migration. Restart the `app` container after migrating (caches the Prisma client).
- **Tests**: Vitest `fileParallelism: false`, shared test DB; `beforeAll`/`afterAll` clean up by stable ids and `await db.$disconnect()`. E2E uses `storageState` `tests/e2e/.auth/{owner,member,admin}.json`; skip webkit for dialog-heavy flows (deferred to 8.3). Run `npm run ci` (lint + typecheck + test) before every PR.
- **Routes** live at `src/app/[locale]/(authenticated)/<name>/`. The `transactions` nav item already exists in `src/components/shell/nav-items.ts` (points at `/transactions`, route not yet created). `categories` must be added.

---

## File Structure (created or modified in this phase)

**Scope 3.1 — Categories**
- Create `src/lib/validation/category.ts` — `CATEGORY_*` constants + `categoryInputSchema`.
- Modify `prisma/schema.prisma` — add `Category` model; add `categories Category[]` to `User` and `Group`.
- Create `prisma/migrations/<ts>_phase_3_1_categories/migration.sql` (+ hand-appended XOR `CHECK`).
- Create `prisma/seed-data/categories-fr.json`, `prisma/seed-data/categories-en.json`.
- Create `src/server/services/categories/index.ts` — service (CRUD + tree).
- Create `src/server/services/categories/seed-defaults.ts` — `seedDefaultCategories`.
- Modify `src/server/services/bootstrap.ts` — seed defaults for the first user.
- Modify `src/server/auth/index.ts` — `databaseHooks.user.create.after` seeds defaults for new signups.
- Create `src/server/transport/actions/categories.ts` — actions.
- Create `src/app/[locale]/(authenticated)/categories/page.tsx`.
- Create `src/components/categories/category-list.tsx`, `src/components/categories/category-form.tsx`.
- Modify `src/components/shell/nav-items.ts` + `messages/{fr,en}.json` — `categories` nav + namespace.
- Tests: `tests/unit/validation/category.test.ts`, `tests/integration/categories.test.ts`, `tests/e2e/categories.spec.ts`.

**Scope 3.2 — Transaction model + crypto**
- Create `src/lib/validation/transaction.ts` — `TRANSACTION_TYPES` + `transactionInputSchema`.
- Modify `prisma/schema.prisma` — add `Transaction`, `TransactionSearchToken`; add back-relations to `BankAccount` and `Category`.
- Create `prisma/migrations/<ts>_phase_3_2_transactions/migration.sql`.
- Create `src/server/services/transactions/secure-fields.ts` — `buildSecureFields`, `computeExternalId`.
- Create `src/server/services/transactions/index.ts` — `createTransaction`, `getTransactionForUser`.
- Tests: `tests/unit/services/transaction-secure-fields.test.ts`, `tests/integration/transactions.test.ts`.

**Scope 3.3 — Categorization engine + learning**
- Create `src/lib/validation/rule.ts` — `RULE_MATCH_TYPES` + `ruleInputSchema`.
- Modify `prisma/schema.prisma` — add `CategorizationRule`; add `rules` back-relations to `User`, `Group`, `Category`.
- Create `prisma/migrations/<ts>_phase_3_3_rules/migration.sql` (+ hand-appended XOR `CHECK`).
- Create `src/server/services/categorization/match.ts` — pure `matchRule`, `proposeRule`.
- Create `src/server/services/categorization/index.ts` — `suggest`, `createRule`, `listRulesForUser`.
- Create `src/server/transport/actions/rules.ts` — `createRuleAction`.
- Tests: `tests/unit/services/categorization-match.test.ts`, `tests/integration/categorization.test.ts`, `tests/e2e/categorization.spec.ts` (recategorize → rule).

**Scope 3.4 — Transactions list + manual entry**
- Modify `src/server/services/transactions/index.ts` — `listTransactions` (filters + token search), `recategorizeTransaction`.
- Create `src/server/transport/actions/transactions.ts` — create/recategorize actions.
- Create `src/app/[locale]/(authenticated)/transactions/page.tsx`.
- Create `src/components/transactions/transaction-list.tsx`, `transaction-form.tsx`, `transaction-filters.tsx`, `category-picker.tsx`, `create-rule-dialog.tsx`.
- Modify `messages/{fr,en}.json` — `transactions` namespace.
- Tests: `tests/integration/transactions-list.test.ts`, `tests/e2e/transactions.spec.ts`.

---

## Task 3.1 — Categories (user XOR group)

**Branch:** `feature/3.1-categories`
**Goal:** Hierarchical categories owned by a user XOR a group; default sets seeded per locale; CRUD UI; XOR enforced at service + DB.

**Files:**
- Create: `src/lib/validation/category.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/seed-data/categories-fr.json`, `prisma/seed-data/categories-en.json`
- Create: `src/server/services/categories/index.ts`, `src/server/services/categories/seed-defaults.ts`
- Modify: `src/server/services/bootstrap.ts`, `src/server/auth/index.ts`
- Create: `src/server/transport/actions/categories.ts`
- Create: `src/app/[locale]/(authenticated)/categories/page.tsx`
- Create: `src/components/categories/category-list.tsx`, `src/components/categories/category-form.tsx`
- Modify: `src/components/shell/nav-items.ts`, `messages/fr.json`, `messages/en.json`
- Test: `tests/unit/validation/category.test.ts`, `tests/integration/categories.test.ts`, `tests/e2e/categories.spec.ts`

### Step 1: Write the failing validation unit test

Create `tests/unit/validation/category.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { categoryInputSchema, CATEGORY_NAME_MAX } from "@/lib/validation/category";

describe("categoryInputSchema", () => {
  it("accepts a minimal personal category", () => {
    const r = categoryInputSchema.safeParse({ name: "Courses" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Courses");
      expect(r.data.groupId).toBeUndefined();
      expect(r.data.parentId).toBeUndefined();
    }
  });

  it("normalizes empty optional strings to undefined", () => {
    const r = categoryInputSchema.parse({ name: "X", groupId: "", parentId: "", icon: "", color: "" });
    expect(r.groupId).toBeUndefined();
    expect(r.parentId).toBeUndefined();
    expect(r.icon).toBeUndefined();
    expect(r.color).toBeUndefined();
  });

  it("rejects a blank name and an over-long name", () => {
    expect(categoryInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "a".repeat(CATEGORY_NAME_MAX + 1) }).success).toBe(false);
  });

  it("rejects a malformed color", () => {
    expect(categoryInputSchema.safeParse({ name: "X", color: "red" }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "X", color: "#abcdef" }).success).toBe(true);
  });
});
```

### Step 2: Run it to verify it fails

Run: `npm run test:unit -- category`
Expected: FAIL — `Cannot find module '@/lib/validation/category'`.

### Step 3: Implement the validation module

Create `src/lib/validation/category.ts`:

```typescript
import { z } from "zod";

export const CATEGORY_NAME_MAX = 60;

// A category is owned by the current user (personal) when `groupId` is absent,
// or by a group when `groupId` is set. The XOR (userId vs groupId) is resolved
// in the service from the session + this field, and enforced by a DB CHECK.
export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(CATEGORY_NAME_MAX),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().trim().max(50).optional(),
  parentId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  groupId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type CategoryInput = z.input<typeof categoryInputSchema>;
```

### Step 4: Run the test to verify it passes

Run: `npm run test:unit -- category`
Expected: PASS (4 tests).

### Step 5: Commit

```bash
git add src/lib/validation/category.ts tests/unit/validation/category.test.ts
git commit -m "feat: add category input validation schema"
```

### Step 6: Add the Category model to the Prisma schema

In `prisma/schema.prisma`, add to the `User` model relations block (after `sentInvitations`):

```prisma
  categories       Category[]
```

Add to the `Group` model relations block (after `accountShares`):

```prisma
  categories    Category[]
```

Add the new model (place it after `AccountShare`, before any Phase-4 placeholder):

```prisma
model Category {
  id        String   @id @default(cuid())
  name      String
  color     String?
  icon      String?
  parentId  String?
  parent    Category?  @relation("CategoryHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children  Category[] @relation("CategoryHierarchy")

  // Owner XOR (User or Group) — enforced at the service layer + a DB CHECK.
  userId    String?
  groupId   String?
  user      User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group     Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([groupId])
  @@index([parentId])
}
```

### Step 7: Generate the migration

Run: `npm run db:migrate -- --name phase_3_1_categories`
Expected: a new `prisma/migrations/<timestamp>_phase_3_1_categories/migration.sql` is created and applied; `prisma generate` runs.

### Step 8: Append the XOR CHECK constraint to the migration

Open the generated `prisma/migrations/<timestamp>_phase_3_1_categories/migration.sql` and append at the end:

```sql
-- Owner XOR: exactly one of userId / groupId is non-null.
ALTER TABLE `Category`
  ADD CONSTRAINT `Category_owner_xor`
  CHECK ((`userId` IS NOT NULL) <> (`groupId` IS NOT NULL));
```

Re-apply by resetting & migrating the dev DB (safe — no real data yet):

Run: `npm run db:reset`
Expected: all migrations apply including the appended CHECK; seed runs.

### Step 9: Restart the app container (Prisma client cache)

Run: `docker compose restart app`
Expected: container restarts; new Prisma client picked up.

### Step 10: Commit the schema + migration

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Category model with owner XOR constraint"
```

### Step 11: Create the default-category seed fixtures

Create `prisma/seed-data/categories-fr.json`:

```json
[
  { "name": "Revenus", "icon": "💰", "color": "#16a34a", "children": ["Salaire", "Remboursements", "Autres revenus"] },
  { "name": "Alimentation", "icon": "🛒", "color": "#f59e0b", "children": ["Courses", "Restaurants", "Café & snacks"] },
  { "name": "Logement", "icon": "🏠", "color": "#2563eb", "children": ["Loyer & prêt", "Charges", "Électricité & gaz", "Internet & téléphone"] },
  { "name": "Transport", "icon": "🚗", "color": "#0891b2", "children": ["Carburant", "Transports en commun", "Entretien véhicule"] },
  { "name": "Loisirs", "icon": "🎉", "color": "#9333ea", "children": ["Sorties", "Abonnements", "Voyages"] },
  { "name": "Santé", "icon": "🩺", "color": "#dc2626", "children": ["Médecin", "Pharmacie", "Mutuelle"] },
  { "name": "Achats", "icon": "🛍️", "color": "#db2777", "children": ["Vêtements", "Maison", "High-tech"] },
  { "name": "Divers", "icon": "📦", "color": "#64748b", "children": [] }
]
```

Create `prisma/seed-data/categories-en.json`:

```json
[
  { "name": "Income", "icon": "💰", "color": "#16a34a", "children": ["Salary", "Reimbursements", "Other income"] },
  { "name": "Food", "icon": "🛒", "color": "#f59e0b", "children": ["Groceries", "Restaurants", "Coffee & snacks"] },
  { "name": "Housing", "icon": "🏠", "color": "#2563eb", "children": ["Rent & mortgage", "Fees", "Electricity & gas", "Internet & phone"] },
  { "name": "Transport", "icon": "🚗", "color": "#0891b2", "children": ["Fuel", "Public transport", "Vehicle maintenance"] },
  { "name": "Leisure", "icon": "🎉", "color": "#9333ea", "children": ["Outings", "Subscriptions", "Travel"] },
  { "name": "Health", "icon": "🩺", "color": "#dc2626", "children": ["Doctor", "Pharmacy", "Insurance"] },
  { "name": "Shopping", "icon": "🛍️", "color": "#db2777", "children": ["Clothing", "Home", "Electronics"] },
  { "name": "Other", "icon": "📦", "color": "#64748b", "children": [] }
]
```

### Step 12: Write the failing seed-defaults integration test

Create `tests/integration/categories.test.ts` (first test only for now):

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";

const userId = "cat_seed_user";

beforeAll(async () => {
  await db.category.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.user.create({ data: { id: userId, email: "cat-seed@bilan.local" } });
});

afterAll(async () => {
  await db.category.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("seedDefaultCategories", () => {
  it("seeds the French default set as a parent/child tree owned by the user", async () => {
    await seedDefaultCategories(userId, "fr");
    const all = await db.category.findMany({ where: { userId } });
    expect(all.length).toBeGreaterThan(10);
    expect(all.every((c) => c.isDefault && c.userId === userId && c.groupId === null)).toBe(true);
    const revenus = all.find((c) => c.name === "Revenus")!;
    expect(revenus.parentId).toBeNull();
    const salaire = all.find((c) => c.name === "Salaire")!;
    expect(salaire.parentId).toBe(revenus.id);
  });

  it("is idempotent-safe: a second seed does not duplicate when categories already exist", async () => {
    const before = await db.category.count({ where: { userId } });
    await seedDefaultCategories(userId, "fr");
    const after = await db.category.count({ where: { userId } });
    expect(after).toBe(before); // skips when the user already has categories
  });
});
```

### Step 13: Run it to verify it fails

Run: `npm run test:integration -- categories`
Expected: FAIL — `Cannot find module '@/server/services/categories/seed-defaults'`.

### Step 14: Implement seed-defaults

Create `src/server/services/categories/seed-defaults.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import categoriesFr from "../../../../prisma/seed-data/categories-fr.json";
import categoriesEn from "../../../../prisma/seed-data/categories-en.json";

type DefaultCategory = { name: string; icon?: string; color?: string; children: string[] };

const SETS: Record<"fr" | "en", DefaultCategory[]> = {
  fr: categoriesFr as DefaultCategory[],
  en: categoriesEn as DefaultCategory[],
};

// Copies the locale's default category set into rows owned by `userId`
// (isDefault = true). No-op if the user already has any category, so it is
// safe to call on every signup and never duplicates.
export async function seedDefaultCategories(
  userId: string,
  locale: "fr" | "en",
  db: PrismaClient = defaultDb,
): Promise<void> {
  const existing = await db.category.count({ where: { userId } });
  if (existing > 0) return;
  const set = SETS[locale] ?? SETS.fr;
  for (const parent of set) {
    const created = await db.category.create({
      data: {
        name: parent.name,
        icon: parent.icon ?? null,
        color: parent.color ?? null,
        userId,
        isDefault: true,
      },
    });
    for (const childName of parent.children) {
      await db.category.create({
        data: { name: childName, parentId: created.id, userId, isDefault: true },
      });
    }
  }
}
```

> Note: importing JSON requires `resolveJsonModule` (already enabled by Next's `tsconfig`; if `npm run typecheck` complains, add `"resolveJsonModule": true` under `compilerOptions`).

### Step 15: Run the test to verify it passes

Run: `npm run test:integration -- categories`
Expected: PASS (2 tests).

### Step 16: Commit

```bash
git add prisma/seed-data src/server/services/categories/seed-defaults.ts tests/integration/categories.test.ts
git commit -m "feat: seed default categories per locale"
```

### Step 17: Write failing service tests (append to the integration file)

Append to `tests/integration/categories.test.ts` a new block (above `afterAll` is fine; Vitest collects all `describe`s):

```typescript
import {
  createCategory,
  updateCategory,
  deleteCategory,
  listForUser,
  CategoryAccessError,
} from "@/server/services/categories";

describe("categories service", () => {
  const owner = "cat_owner";
  const stranger = "cat_stranger";
  let groupId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
    await db.user.create({ data: { id: owner, email: "cat-owner@bilan.local" } });
    await db.user.create({ data: { id: stranger, email: "cat-stranger@bilan.local" } });
    const group = await db.group.create({ data: { name: "Foyer Cat", createdById: owner } });
    groupId = group.id;
    await db.groupMember.create({ data: { groupId, userId: owner, role: "OWNER" } });
  });

  afterAll(async () => {
    await db.category.deleteMany({ where: { OR: [{ userId: { in: [owner, stranger] } }, { groupId }] } });
    await db.groupMember.deleteMany({ where: { groupId } });
    await db.group.deleteMany({ where: { id: groupId } });
    await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  });

  it("creates a personal category (userId set, groupId null)", async () => {
    const { id } = await createCategory({ name: "Perso" }, { id: owner });
    const row = await db.category.findUniqueOrThrow({ where: { id } });
    expect(row.userId).toBe(owner);
    expect(row.groupId).toBeNull();
  });

  it("creates a group category when the actor is a group ADMIN/OWNER", async () => {
    const { id } = await createCategory({ name: "Foyer", groupId }, { id: owner });
    const row = await db.category.findUniqueOrThrow({ where: { id } });
    expect(row.groupId).toBe(groupId);
    expect(row.userId).toBeNull();
  });

  it("blocks creating a group category for a non-member", async () => {
    await expect(
      createCategory({ name: "Nope", groupId }, { id: stranger }),
    ).rejects.toBeInstanceOf(CategoryAccessError);
  });

  it("blocks updating/deleting a category the actor does not own", async () => {
    const { id } = await createCategory({ name: "Mine" }, { id: owner });
    await expect(updateCategory(id, { name: "Hacked" }, { id: stranger })).rejects.toBeInstanceOf(
      CategoryAccessError,
    );
    await expect(deleteCategory(id, { id: stranger })).rejects.toBeInstanceOf(CategoryAccessError);
  });

  it("lists personal + group categories as a tree for the user", async () => {
    const parent = await createCategory({ name: "Parent" }, { id: owner });
    await createCategory({ name: "Child", parentId: parent.id }, { id: owner });
    const tree = await listForUser(owner);
    const node = tree.find((c) => c.id === parent.id)!;
    expect(node.children.some((c) => c.name === "Child")).toBe(true);
    expect(tree.some((c) => c.scope === "GROUP")).toBe(true);
  });
});
```

### Step 18: Run to verify it fails

Run: `npm run test:integration -- categories`
Expected: FAIL — `Cannot find module '@/server/services/categories'`.

### Step 19: Implement the categories service

Create `src/server/services/categories/index.ts`:

```typescript
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { requireGroupRole } from "@/server/services/groups/roles";
import { categoryInputSchema, type CategoryInput } from "@/lib/validation/category";

export class CategoryAccessError extends Error {}

export type CategoryScope = "USER" | "GROUP";

export type CategoryNode = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  scope: CategoryScope;
  groupId: string | null;
  isDefault: boolean;
  children: CategoryNode[];
};

// Authorizes the actor for a given owner scope: personal categories require the
// category to belong to the actor; group categories require ADMIN+ in the group.
async function assertCanManageScope(
  groupId: string | undefined,
  actorId: string,
): Promise<void> {
  if (groupId) {
    try {
      await requireGroupRole(groupId, actorId, "ADMIN");
    } catch {
      throw new CategoryAccessError("FORBIDDEN");
    }
  }
}

export async function createCategory(
  input: CategoryInput,
  actor: { id: string },
): Promise<{ id: string }> {
  const data = categoryInputSchema.parse(input);
  await assertCanManageScope(data.groupId, actor.id);

  // A parent (if any) must live in the same owner scope.
  if (data.parentId) {
    const parent = await db.category.findUnique({ where: { id: data.parentId } });
    if (!parent) throw new CategoryAccessError("INVALID_PARENT");
    const sameScope = data.groupId
      ? parent.groupId === data.groupId
      : parent.userId === actor.id;
    if (!sameScope) throw new CategoryAccessError("INVALID_PARENT");
  }

  const cat = await db.category.create({
    data: {
      name: data.name,
      color: data.color ?? null,
      icon: data.icon ?? null,
      parentId: data.parentId ?? null,
      userId: data.groupId ? null : actor.id,
      groupId: data.groupId ?? null,
    },
  });
  await logEvent({ userId: actor.id, action: "category.created", entity: "Category", entityId: cat.id });
  return { id: cat.id };
}

async function ownedOrThrow(id: string, actorId: string) {
  const cat = await db.category.findUnique({ where: { id } });
  if (!cat) throw new CategoryAccessError("NOT_FOUND");
  if (cat.groupId) {
    try {
      await requireGroupRole(cat.groupId, actorId, "ADMIN");
    } catch {
      throw new CategoryAccessError("FORBIDDEN");
    }
  } else if (cat.userId !== actorId) {
    throw new CategoryAccessError("FORBIDDEN");
  }
  return cat;
}

export async function updateCategory(
  id: string,
  input: CategoryInput,
  actor: { id: string },
): Promise<void> {
  const existing = await ownedOrThrow(id, actor.id);
  const data = categoryInputSchema.parse(input);
  await db.category.update({
    where: { id },
    data: {
      name: data.name,
      color: data.color ?? null,
      icon: data.icon ?? null,
      // Reparenting within the same scope only; ignore groupId changes (scope is immutable).
      parentId: data.parentId && data.parentId !== id ? data.parentId : null,
    },
  });
  await logEvent({ userId: actor.id, action: "category.updated", entity: "Category", entityId: existing.id });
}

export async function deleteCategory(id: string, actor: { id: string }): Promise<void> {
  const existing = await ownedOrThrow(id, actor.id);
  // Children become roots (onDelete: SetNull); transactions keep categoryId null (set in 3.2 schema).
  await db.category.delete({ where: { id } });
  await logEvent({ userId: actor.id, action: "category.deleted", entity: "Category", entityId: existing.id });
}

function buildTree(
  rows: {
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
    parentId: string | null;
    userId: string | null;
    groupId: string | null;
    isDefault: boolean;
  }[],
): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      color: r.color,
      icon: r.icon,
      parentId: r.parentId,
      scope: r.groupId ? "GROUP" : "USER",
      groupId: r.groupId,
      isDefault: r.isDefault,
      children: [],
    });
  }
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

// All categories the user can use: their personal ones + every category owned
// by a group they belong to. Returned as a parent/child forest.
export async function listForUser(userId: string): Promise<CategoryNode[]> {
  const memberships = await db.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.category.findMany({
    where: { OR: [{ userId }, { groupId: { in: groupIds } }] },
    orderBy: { name: "asc" },
  });
  return buildTree(rows);
}
```

### Step 20: Run the service tests

Run: `npm run test:integration -- categories`
Expected: PASS (all category tests).

### Step 21: Commit

```bash
git add src/server/services/categories/index.ts tests/integration/categories.test.ts
git commit -m "feat: add categories service (CRUD + tree, owner XOR)"
```

### Step 22: Wire seeding into the first-user setup

Modify `src/server/services/bootstrap.ts` — import and call after the `UserPreference` upsert:

```typescript
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
```

Inside `completeSetup`, after the `userPreference.upsert(...)` block and before `logEvent`:

```typescript
  await seedDefaultCategories(res.user.id, input.locale ?? "fr", db);
```

### Step 23: Wire seeding into new signups (better-auth hook)

Modify `src/server/auth/index.ts`. Add the import:

```typescript
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";
```

In `buildOptions`, add a `databaseHooks` entry to the returned options object (e.g. right after `account: { modelName: "authAccount" },`):

```typescript
    databaseHooks: {
      user: {
        create: {
          // Seed the default category set for every new account. Locale is not
          // known here (UserPreference is written separately) so default to fr;
          // failures must never block signup.
          after: async (user) => {
            try {
              await seedDefaultCategories(user.id, "fr");
            } catch {
              // best-effort
            }
          },
        },
      },
    },
```

> The first-user path (`completeSetup`) also calls `seedDefaultCategories` with the chosen locale; the `existing > 0` guard makes the second call a no-op, so there is no duplication.

### Step 24: Typecheck & commit the wiring

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/server/services/bootstrap.ts src/server/auth/index.ts
git commit -m "feat: seed default categories on signup and first-run setup"
```

### Step 25: Implement the server actions

Create `src/server/transport/actions/categories.ts`:

```typescript
"use server";

import { requireSession } from "@/server/auth/permissions";
import { categoryInputSchema } from "@/lib/validation/category";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  CategoryAccessError,
} from "@/server/services/categories";

export type CategoryActionState = { ok: true } | { ok: false; error: string } | null;

function parse(formData: FormData) {
  return categoryInputSchema.safeParse({
    name: formData.get("name") ?? "",
    color: formData.get("color") || undefined,
    icon: formData.get("icon") || undefined,
    parentId: formData.get("parentId") ?? "",
    groupId: formData.get("groupId") ?? "",
  });
}

function mapError(e: unknown): string {
  return e instanceof CategoryAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

export async function createCategoryAction(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const user = await requireSession();
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await createCategory(parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}

export async function updateCategoryAction(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await updateCategory(id, parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}

export async function deleteCategoryAction(
  _prev: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteCategory(id, { id: user.id });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}
```

### Step 26: Add the i18n namespace + nav entry

In `messages/fr.json`, add `"categories"` under `shell.nav` (after `"groups"`):

```json
      "categories": "Catégories",
```

And add a top-level `"categories"` namespace (after the `"groups"` namespace closes):

```json
  "categories": {
    "title": "Catégories",
    "subtitle": "Organisez vos dépenses et revenus. Une catégorie appartient à vous ou à un foyer.",
    "empty": "Aucune catégorie.",
    "create": "Nouvelle catégorie",
    "createTitle": "Ajouter une catégorie",
    "editTitle": "Modifier la catégorie",
    "name": "Nom",
    "namePlaceholder": "Courses",
    "color": "Couleur",
    "icon": "Icône",
    "parent": "Catégorie parente",
    "noParent": "Aucune (racine)",
    "scope": "Portée",
    "scopePersonal": "Personnelle",
    "scopeGroup": "Foyer",
    "default": "Par défaut",
    "edit": "Modifier",
    "delete": "Supprimer",
    "deleteConfirm": "Supprimer cette catégorie ? Les sous-catégories deviendront des racines et les transactions seront décatégorisées.",
    "cancel": "Annuler",
    "save": "Enregistrer",
    "saving": "Enregistrement…",
    "createCta": "Créer",
    "error": {
      "INVALID": "Vérifiez les champs.",
      "INVALID_PARENT": "Catégorie parente invalide.",
      "FORBIDDEN": "Action non autorisée.",
      "NOT_FOUND": "Catégorie introuvable.",
      "FAILED": "Échec. Réessayez."
    }
  },
```

In `messages/en.json`, mirror under `shell.nav`:

```json
      "categories": "Categories",
```

and the top-level namespace:

```json
  "categories": {
    "title": "Categories",
    "subtitle": "Organize your spending and income. A category belongs to you or to a household.",
    "empty": "No categories yet.",
    "create": "New category",
    "createTitle": "Add a category",
    "editTitle": "Edit category",
    "name": "Name",
    "namePlaceholder": "Groceries",
    "color": "Color",
    "icon": "Icon",
    "parent": "Parent category",
    "noParent": "None (root)",
    "scope": "Scope",
    "scopePersonal": "Personal",
    "scopeGroup": "Household",
    "default": "Default",
    "edit": "Edit",
    "delete": "Delete",
    "deleteConfirm": "Delete this category? Sub-categories become roots and transactions are uncategorized.",
    "cancel": "Cancel",
    "save": "Save",
    "saving": "Saving…",
    "createCta": "Create",
    "error": {
      "INVALID": "Check the fields.",
      "INVALID_PARENT": "Invalid parent category.",
      "FORBIDDEN": "Not allowed.",
      "NOT_FOUND": "Category not found.",
      "FAILED": "Failed. Try again."
    }
  },
```

In `src/components/shell/nav-items.ts`, add to `WORKSPACE_NAV` (after `accounts`, before `groups`) and import the icon:

```typescript
import { Tags } from "lucide-react";
```

```typescript
  { key: "categories", href: "/categories", icon: Tags },
```

### Step 27: Build the category form component

Create `src/components/categories/category-form.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createCategoryAction,
  updateCategoryAction,
  type CategoryActionState,
} from "@/server/transport/actions/categories";

export type ParentOption = { id: string; name: string };
export type EditableCategory = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  groupId: string | null;
};

export function CategoryForm({
  mode,
  category,
  parents,
  groupId,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  mode: "create" | "edit";
  category?: EditableCategory;
  parents: ParentOption[];
  groupId?: string | null;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("categories");
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAction(formData: FormData) {
    startTransition(async () => {
      const act = mode === "create" ? createCategoryAction : updateCategoryAction;
      const result: CategoryActionState = await act(null, formData);
      if (result?.ok) {
        setError(null);
        setOpen(false);
        router.refresh();
      } else {
        setError(result?.error ?? "FAILED");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
          <DialogTitle className="font-display text-2xl">
            {mode === "create" ? t("createTitle") : t("editTitle")}
          </DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <form action={handleAction} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            {mode === "edit" && <input type="hidden" name="id" value={category!.id} />}
            {groupId ? <input type="hidden" name="groupId" value={groupId} /> : null}

            <div className="space-y-2">
              <Label htmlFor="cat-name">{t("name")}</Label>
              <Input
                id="cat-name"
                name="name"
                defaultValue={category?.name}
                placeholder={t("namePlaceholder")}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cat-icon">{t("icon")}</Label>
                <Input id="cat-icon" name="icon" defaultValue={category?.icon ?? ""} maxLength={50} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cat-color">{t("color")}</Label>
                <Input
                  id="cat-color"
                  name="color"
                  type="color"
                  defaultValue={category?.color ?? "#2563eb"}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cat-parent">{t("parent")}</Label>
              <select
                id="cat-parent"
                name="parentId"
                defaultValue={category?.parentId ?? ""}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">{t("noParent")}</option>
                {parents
                  .filter((p) => p.id !== category?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>

            {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
          </div>

          <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              <Check />
              {pending ? t("saving") : mode === "create" ? t("createCta") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

### Step 28: Build the category list component

Create `src/components/categories/category-list.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CategoryForm, type EditableCategory, type ParentOption } from "./category-form";
import { deleteCategoryAction } from "@/server/transport/actions/categories";

type Node = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parentId: string | null;
  scope: "USER" | "GROUP";
  groupId: string | null;
  isDefault: boolean;
  children: Node[];
};

function Row({ node, parents }: { node: Node; parents: ParentOption[] }) {
  const t = useTranslations("categories");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const editable: EditableCategory = {
    id: node.id,
    name: node.name,
    color: node.color,
    icon: node.icon,
    parentId: node.parentId,
    groupId: node.groupId,
  };

  function handleDelete() {
    if (!confirm(t("deleteConfirm"))) return;
    const fd = new FormData();
    fd.set("id", node.id);
    startTransition(async () => {
      const r = await deleteCategoryAction(null, fd);
      if (r?.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <div
        className="border-border flex items-center gap-3 rounded-md border px-3 py-2"
        data-slot="category-row"
      >
        <span
          aria-hidden
          className="inline-block size-3 rounded-full"
          style={{ background: node.color ?? "var(--muted-foreground)" }}
        />
        <span className="flex-1 text-sm">
          {node.icon ? `${node.icon} ` : ""}
          {node.name}
        </span>
        {node.scope === "GROUP" && <Badge variant="secondary">{t("scopeGroup")}</Badge>}
        {node.isDefault && <Badge variant="outline">{t("default")}</Badge>}
        <Button variant="ghost" size="icon" aria-label={t("edit")} onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("delete")}
          disabled={pending}
          onClick={handleDelete}
        >
          <Trash2 className="size-4" />
        </Button>
        <CategoryForm
          mode="edit"
          category={editable}
          parents={parents}
          groupId={node.groupId}
          open={editing}
          onOpenChange={setEditing}
        />
      </div>
      {node.children.length > 0 && (
        <div className="ml-6 space-y-1">
          {node.children.map((c) => (
            <Row key={c.id} node={c} parents={parents} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoryList({ tree }: { tree: Node[] }) {
  const t = useTranslations("categories");
  const parents: ParentOption[] = tree.map((n) => ({ id: n.id, name: n.name }));
  if (tree.length === 0) return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  return (
    <div className="space-y-2">
      {tree.map((node) => (
        <Row key={node.id} node={node} parents={parents} />
      ))}
    </div>
  );
}
```

### Step 29: Build the categories page

Create `src/app/[locale]/(authenticated)/categories/page.tsx`:

```typescript
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listForUser } from "@/server/services/categories";
import { CategoryList } from "@/components/categories/category-list";
import { CategoryForm } from "@/components/categories/category-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("categories");
  const tree = await listForUser(user.id);
  const parents = tree.map((n) => ({ id: n.id, name: n.name }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <CategoryForm
          mode="create"
          parents={parents}
          trigger={
            <Button>
              <Plus />
              {t("create")}
            </Button>
          }
        />
      </header>
      <CategoryList tree={tree} />
    </div>
  );
}
```

### Step 30: Write the e2e test

Create `tests/e2e/categories.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("categories", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("create, edit and delete a category", async ({ page }) => {
    const name = `Cat ${Date.now()}`;
    await page.goto("/fr/categories");
    await page.getByRole("button", { name: /nouvelle catégorie/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /^créer$/i }).click();
    const row = page.locator('[data-slot="category-row"]').filter({ hasText: name });
    await expect(row.first()).toBeVisible();

    await row.first().getByRole("button", { name: /modifier/i }).click();
    await page.fill('input[name="name"]', `${name} edited`);
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await expect(
      page.locator('[data-slot="category-row"]').filter({ hasText: `${name} edited` }).first(),
    ).toBeVisible();

    page.on("dialog", (d) => d.accept());
    await page
      .locator('[data-slot="category-row"]')
      .filter({ hasText: `${name} edited` })
      .first()
      .getByRole("button", { name: /supprimer/i })
      .click();
    await expect(
      page.locator('[data-slot="category-row"]').filter({ hasText: `${name} edited` }),
    ).toHaveCount(0);
  });
});

test("unauthenticated /categories redirects to login", async ({ page }) => {
  await page.goto("/fr/categories");
  await expect(page).toHaveURL(/\/login$/);
});
```

### Step 31: Run full CI + e2e

Run: `npm run ci`
Expected: lint, typecheck, unit + integration tests all PASS.

Run: `npm run test:e2e -- categories`
Expected: PASS (chromium + mobile; webkit skipped).

### Step 32: Commit, push, open PR

```bash
git add src/server/transport/actions/categories.ts src/app/[locale]/\(authenticated\)/categories src/components/categories src/components/shell/nav-items.ts messages tests/e2e/categories.spec.ts
git commit -m "feat: categories CRUD UI with hierarchical list and i18n"
git push -u origin feature/3.1-categories
gh pr create --base develop --title "feat: categories (user XOR group)" --body "Closes #18"
```

> Replace `#18` with the actual 3.1 issue number (`gh issue list --search "3.1"`). Add the required type label (`enhancement`) plus phase/area labels.

---

## Task 3.2 — Transaction model + crypto

**Branch:** `feature/3.2-transactions-model`
**Goal:** `Transaction` + `TransactionSearchToken` models; a secure-fields builder (encrypt label/rawLabel/note + HMAC hashes + per-word tokens); `createTransaction` writing tokens; dedup `externalId` helper. Crypto primitives already exist (scope 0.4) and are unit-tested (`tests/unit/crypto/*`) — reuse them.

**Files:**
- Create: `src/lib/validation/transaction.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_phase_3_2_transactions/migration.sql`
- Create: `src/server/services/transactions/secure-fields.ts`, `src/server/services/transactions/index.ts`
- Test: `tests/unit/services/transaction-secure-fields.test.ts`, `tests/integration/transactions.test.ts`

### Step 1: Write the failing validation + secure-fields unit test

Create `tests/unit/services/transaction-secure-fields.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { decrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { buildSecureFields, computeExternalId } from "@/server/services/transactions/secure-fields";

describe("buildSecureFields", () => {
  it("encrypts label/rawLabel and stores matching HMAC hashes + per-word tokens", () => {
    const f = buildSecureFields({ label: "Carrefour City", rawLabel: "CB CARREFOUR CITY PARIS", note: "lunch" });
    expect(decrypt(f.labelEnc, dataKey)).toBe("Carrefour City");
    expect(decrypt(f.rawLabelEnc, dataKey)).toBe("CB CARREFOUR CITY PARIS");
    expect(f.noteEnc).not.toBeNull();
    expect(decrypt(f.noteEnc!, dataKey)).toBe("lunch");
    expect(f.labelHash).toBe(hmacForSearch("Carrefour City", searchKey));
    // tokens are per normalized word ≥ 3 chars of the raw label
    expect(f.tokens).toContain(hmacForSearch("carrefour", searchKey));
    expect(f.tokens).toContain(hmacForSearch("city", searchKey));
    expect(f.tokens).toContain(hmacForSearch("paris", searchKey));
    // "cb" (2 chars) is below the 3-char threshold
    expect(f.tokens).not.toContain(hmacForSearch("cb", searchKey));
  });

  it("leaves noteEnc null when no note is given", () => {
    const f = buildSecureFields({ label: "X", rawLabel: "X" });
    expect(f.noteEnc).toBeNull();
  });
});

describe("computeExternalId", () => {
  it("is deterministic for the same date+amount+rawLabel and differs otherwise", () => {
    const a = computeExternalId(new Date("2026-01-15"), 12.5, "CB FOO");
    const b = computeExternalId(new Date("2026-01-15"), 12.5, "CB FOO");
    const c = computeExternalId(new Date("2026-01-15"), 12.51, "CB FOO");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64); // sha256 hex
  });
});
```

### Step 2: Run to verify it fails

Run: `npm run test:unit -- transaction-secure-fields`
Expected: FAIL — module not found.

### Step 3: Implement secure-fields

Create `src/server/services/transactions/secure-fields.ts`:

```typescript
import { createHash } from "node:crypto";
import { encrypt } from "@/server/crypto/encryption";
import { hmacForSearch, hmacTokens } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";

export type SecureFields = {
  labelEnc: string;
  labelHash: string;
  rawLabelEnc: string;
  rawLabelHash: string;
  noteEnc: string | null;
  tokens: string[]; // HMAC of each normalized word ≥ 3 chars (label + rawLabel)
};

// Encrypts the human + raw labels and the optional note, derives equality
// HMAC hashes for both labels, and builds the per-word search-token set used by
// TransactionSearchToken rows. Tokens come from BOTH labels so a search matches
// whichever the user typed.
export function buildSecureFields(input: {
  label: string;
  rawLabel: string;
  note?: string | null;
}): SecureFields {
  const note = input.note?.trim() ? input.note : null;
  const tokens = Array.from(
    new Set([...hmacTokens(input.label, searchKey), ...hmacTokens(input.rawLabel, searchKey)]),
  );
  return {
    labelEnc: encrypt(input.label, dataKey),
    labelHash: hmacForSearch(input.label, searchKey),
    rawLabelEnc: encrypt(input.rawLabel, dataKey),
    rawLabelHash: hmacForSearch(input.rawLabel, searchKey),
    noteEnc: note ? encrypt(note, dataKey) : null,
    tokens,
  };
}

// Stable dedup key for imported rows: sha256 of date(ISO day) + amount + rawLabel.
// Manual entries pass no externalId (no auto-dedup) — this is for CSV/PDF (Phase 4).
export function computeExternalId(date: Date, amount: number, rawLabel: string): string {
  const day = date.toISOString().slice(0, 10);
  return createHash("sha256").update(`${day}|${amount.toFixed(2)}|${rawLabel}`).digest("hex");
}
```

### Step 4: Run to verify it passes

Run: `npm run test:unit -- transaction-secure-fields`
Expected: PASS.

### Step 5: Commit

```bash
git add src/server/services/transactions/secure-fields.ts tests/unit/services/transaction-secure-fields.test.ts
git commit -m "feat: add transaction secure-fields builder and dedup key"
```

### Step 6: Add the transaction validation module

Create `src/lib/validation/transaction.ts`:

```typescript
import { z } from "zod";

export const TRANSACTION_TYPES = ["CARD", "TRANSFER", "DIRECT_DEBIT", "CHEQUE", "ATM", "OTHER"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const transactionInputSchema = z.object({
  accountId: z.string().min(1),
  date: z.coerce.date(),
  // Amount in clear (Decimal(12,2)); accepts a number or a "12,34"/"12.34" string.
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => {
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
      return Math.round(n * 100) / 100;
    })
    .refine((n) => Number.isFinite(n) && Math.abs(n) < 1e10, { message: "Invalid amount" }),
  type: z.enum(TRANSACTION_TYPES),
  label: z.string().trim().min(1).max(200),
  // rawLabel defaults to label for manual entry; imports pass the bank string.
  rawLabel: z.string().trim().max(300).optional(),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  categoryId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type TransactionInput = z.input<typeof transactionInputSchema>;
```

### Step 7: Extend the Prisma schema with Transaction models

In `prisma/schema.prisma`:

Add to `BankAccount` relations (after `shares`):

```prisma
  transactions Transaction[]
```

Add to `Category` relations (after `children`, inside the model):

```prisma
  transactions Transaction[]
```

Add the new models (after `Category`):

```prisma
model Transaction {
  id        String   @id @default(cuid())
  accountId String
  date      DateTime
  amount    Decimal  @db.Decimal(12, 2)
  type      String // CARD | TRANSFER | DIRECT_DEBIT | CHEQUE | ATM | OTHER

  labelEnc     String  @db.Text
  labelHash    String
  rawLabelEnc  String  @db.Text
  rawLabelHash String
  noteEnc      String? @db.Text

  categoryId          String?
  category            Category? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  manuallyCategorized Boolean   @default(false)

  externalId  String?
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  account      BankAccount              @relation(fields: [accountId], references: [id], onDelete: Cascade)
  searchTokens TransactionSearchToken[]

  @@unique([accountId, externalId])
  @@index([accountId, date])
  @@index([categoryId, date])
  @@index([labelHash])
  @@index([rawLabelHash])
  @@index([date])
}

model TransactionSearchToken {
  id            String      @id @default(cuid())
  transactionId String
  tokenHash     String
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@index([tokenHash])
  @@index([transactionId])
}
```

### Step 8: Generate the migration & restart

Run: `npm run db:migrate -- --name phase_3_2_transactions`
Expected: migration created + applied.

Run: `docker compose restart app`

### Step 9: Commit schema + migration

```bash
git add prisma/schema.prisma prisma/migrations src/lib/validation/transaction.ts
git commit -m "feat: add Transaction and TransactionSearchToken models"
```

### Step 10: Write the failing createTransaction integration test

Create `tests/integration/transactions.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import {
  createTransaction,
  getTransactionForUser,
  TransactionAccessError,
} from "@/server/services/transactions";

const owner = "tx_owner";
const stranger = "tx_stranger";
let accountId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.user.create({ data: { id: owner, email: "tx-owner@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "tx-stranger@bilan.local" } });
  const acc = await db.bankAccount.create({
    data: { ownerId: owner, name: "Courant", type: "CHECKING" },
  });
  accountId = acc.id;
});

afterAll(async () => {
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("createTransaction", () => {
  it("creates a transaction, encrypts labels and writes per-word search tokens", async () => {
    const { id } = await createTransaction(
      {
        accountId,
        date: "2026-01-10",
        amount: "-42,90",
        type: "CARD",
        label: "Carrefour City",
        rawLabel: "CB CARREFOUR CITY PARIS",
        note: "courses",
      },
      { id: owner },
    );
    const row = await db.transaction.findUniqueOrThrow({
      where: { id },
      include: { searchTokens: true },
    });
    expect(decrypt(row.labelEnc, dataKey)).toBe("Carrefour City");
    expect(row.labelEnc).not.toContain("Carrefour");
    expect(Number(row.amount)).toBe(-42.9);
    expect(row.searchTokens.some((t) => t.tokenHash === hmacForSearch("carrefour", searchKey))).toBe(true);
    expect(row.searchTokens.some((t) => t.tokenHash === hmacForSearch("paris", searchKey))).toBe(true);

    const audit = await db.auditLog.findFirst({ where: { action: "transaction.created", entityId: id } });
    expect(audit).not.toBeNull();
  });

  it("defaults rawLabel to label when omitted", async () => {
    const { id } = await createTransaction(
      { accountId, date: "2026-01-11", amount: 10, type: "OTHER", label: "Remboursement" },
      { id: owner },
    );
    const row = await db.transaction.findUniqueOrThrow({ where: { id } });
    expect(decrypt(row.rawLabelEnc, dataKey)).toBe("Remboursement");
  });

  it("rejects creating a transaction on an account the actor cannot write", async () => {
    await expect(
      createTransaction(
        { accountId, date: "2026-01-12", amount: 5, type: "OTHER", label: "X" },
        { id: stranger },
      ),
    ).rejects.toBeInstanceOf(TransactionAccessError);
  });

  it("getTransactionForUser returns a decrypted view for the owner and null for a stranger", async () => {
    const { id } = await createTransaction(
      { accountId, date: "2026-01-13", amount: -7, type: "CARD", label: "Boulangerie" },
      { id: owner },
    );
    const view = await getTransactionForUser(id, owner);
    expect(view?.label).toBe("Boulangerie");
    expect(await getTransactionForUser(id, stranger)).toBeNull();
  });
});
```

### Step 11: Run to verify it fails

Run: `npm run test:integration -- transactions`
Expected: FAIL — module not found.

### Step 12: Implement the transactions service (create + read)

Create `src/server/services/transactions/index.ts`:

```typescript
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { canWriteAccount, canReadAccount } from "@/server/services/accounts/sharing";
import { transactionInputSchema, type TransactionInput } from "@/lib/validation/transaction";
import { buildSecureFields, computeExternalId } from "./secure-fields";

export class TransactionAccessError extends Error {}

export type TransactionView = {
  id: string;
  accountId: string;
  date: Date;
  amount: number;
  type: string;
  label: string;
  note: string | null;
  categoryId: string | null;
  manuallyCategorized: boolean;
};

// Creates a transaction the actor is allowed to write (owner or WRITE share),
// encrypting labels/note and writing per-word search tokens in one DB transaction.
// `categoryId` is taken verbatim (manual choice or import suggestion); auto-suggest
// is wired by callers in 3.3+. Pass `externalId` for imports (dedup); manual = none.
export async function createTransaction(
  input: TransactionInput,
  actor: { id: string },
  opts: { externalId?: string; manuallyCategorized?: boolean } = {},
): Promise<{ id: string }> {
  const data = transactionInputSchema.parse(input);
  if (!(await canWriteAccount(actor.id, data.accountId))) {
    throw new TransactionAccessError("FORBIDDEN");
  }
  const rawLabel = data.rawLabel?.trim() ? data.rawLabel : data.label;
  const secure = buildSecureFields({ label: data.label, rawLabel, note: data.note });
  const externalId =
    opts.externalId ?? null; // manual entries have no externalId (no auto-dedup)

  const tx = await db.transaction.create({
    data: {
      accountId: data.accountId,
      date: data.date,
      amount: data.amount,
      type: data.type,
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      noteEnc: secure.noteEnc,
      categoryId: data.categoryId ?? null,
      manuallyCategorized: opts.manuallyCategorized ?? Boolean(data.categoryId),
      externalId,
      createdById: actor.id,
      searchTokens: { create: secure.tokens.map((tokenHash) => ({ tokenHash })) },
    },
  });
  await logEvent({
    userId: actor.id,
    action: "transaction.created",
    entity: "Transaction",
    entityId: tx.id,
  });
  return { id: tx.id };
}

// Decrypts a single transaction for a user who can read its account.
export async function getTransactionForUser(
  id: string,
  userId: string,
): Promise<TransactionView | null> {
  const row = await db.transaction.findUnique({ where: { id } });
  if (!row) return null;
  if (!(await canReadAccount(userId, row.accountId))) return null;
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amount: Number(row.amount),
    type: row.type,
    label: decrypt(row.labelEnc, dataKey),
    note: row.noteEnc ? decrypt(row.noteEnc, dataKey) : null,
    categoryId: row.categoryId,
    manuallyCategorized: row.manuallyCategorized,
  };
}

export { computeExternalId };
```

### Step 13: Run to verify it passes

Run: `npm run test:integration -- transactions`
Expected: PASS (4 tests).

### Step 14: Run CI, commit, push, PR

Run: `npm run ci`
Expected: PASS.

```bash
git add src/server/services/transactions/index.ts tests/integration/transactions.test.ts
git commit -m "feat: add transactions service create/read with encrypted labels and tokens"
git push -u origin feature/3.2-transactions-model
gh pr create --base develop --title "feat: transaction model + crypto" --body "Closes #19"
```

> Replace `#19` with the real 3.2 issue number.

---

## Task 3.3 — Categorization engine + learning

**Branch:** `feature/3.3-categorization`
**Goal:** `CategorizationRule` model (scope user XOR group); a pure matcher for all match types with priority; `suggest()`; `createRule()`; a `proposeRule()` helper for the "create a rule?" learning dialog.

**Files:**
- Create: `src/lib/validation/rule.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_phase_3_3_rules/migration.sql` (+ XOR CHECK)
- Create: `src/server/services/categorization/match.ts`, `src/server/services/categorization/index.ts`
- Create: `src/server/transport/actions/rules.ts`
- Test: `tests/unit/services/categorization-match.test.ts`, `tests/integration/categorization.test.ts`, `tests/e2e/categorization.spec.ts`

### Step 1: Write the failing matcher unit test

Create `tests/unit/services/categorization-match.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { matchRule, pickByPriority, proposeRule, type Rule } from "@/server/services/categorization/match";

const base = { id: "r", categoryId: "c", caseSensitive: false } as const;

describe("matchRule", () => {
  it("CONTAINS is case-insensitive by default", () => {
    expect(matchRule({ ...base, matchType: "CONTAINS", pattern: "carrefour" }, "CB CARREFOUR CITY")).toBe(true);
    expect(matchRule({ ...base, matchType: "CONTAINS", pattern: "leclerc" }, "CB CARREFOUR CITY")).toBe(false);
  });

  it("EXACT matches the whole normalized string", () => {
    expect(matchRule({ ...base, matchType: "EXACT", pattern: "loyer" }, "Loyer")).toBe(true);
    expect(matchRule({ ...base, matchType: "EXACT", pattern: "loyer" }, "Loyer mai")).toBe(false);
  });

  it("STARTS_WITH matches a prefix", () => {
    expect(matchRule({ ...base, matchType: "STARTS_WITH", pattern: "vir" }, "VIR SEPA SALAIRE")).toBe(true);
    expect(matchRule({ ...base, matchType: "STARTS_WITH", pattern: "sepa" }, "VIR SEPA SALAIRE")).toBe(false);
  });

  it("REGEX matches the source pattern", () => {
    expect(matchRule({ ...base, matchType: "REGEX", pattern: "carrefour|leclerc" }, "ticket leclerc")).toBe(true);
    expect(matchRule({ ...base, matchType: "REGEX", pattern: "^uber" }, "UBER EATS")).toBe(true);
  });

  it("caseSensitive=true respects case", () => {
    expect(matchRule({ ...base, caseSensitive: true, matchType: "CONTAINS", pattern: "Carrefour" }, "carrefour")).toBe(false);
  });

  it("an invalid regex never throws and returns false", () => {
    expect(matchRule({ ...base, matchType: "REGEX", pattern: "(" }, "anything")).toBe(false);
  });
});

describe("pickByPriority", () => {
  it("returns the highest-priority matching rule", () => {
    const rules: Rule[] = [
      { ...base, id: "low", matchType: "CONTAINS", pattern: "city", priority: 10, categoryId: "A" },
      { ...base, id: "high", matchType: "CONTAINS", pattern: "carrefour", priority: 200, categoryId: "B" },
    ];
    expect(pickByPriority(rules, "CARREFOUR CITY")?.id).toBe("high");
  });

  it("returns null when nothing matches", () => {
    expect(pickByPriority([{ ...base, matchType: "EXACT", pattern: "x", priority: 1 }], "y")).toBeNull();
  });
});

describe("proposeRule", () => {
  it("proposes the longest distinctive token as a CONTAINS pattern", () => {
    expect(proposeRule("CB CARREFOUR CITY PARIS")).toEqual({ pattern: "carrefour", matchType: "CONTAINS" });
  });
  it("returns null when there is no token ≥ 3 chars", () => {
    expect(proposeRule("a b cd")).toBeNull();
  });
});
```

### Step 2: Run to verify it fails

Run: `npm run test:unit -- categorization-match`
Expected: FAIL — module not found.

### Step 3: Implement the pure matcher

Create `src/server/services/categorization/match.ts`:

```typescript
import { tokenize } from "@/server/crypto/hmac";
import type { RuleMatchType } from "@/lib/validation/rule";

export type Rule = {
  id: string;
  categoryId: string;
  pattern: string;
  matchType: RuleMatchType;
  caseSensitive: boolean;
  priority?: number;
};

function prep(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : s.toLowerCase();
}

// Pure predicate: does `label` satisfy this rule? Never throws (a malformed
// REGEX yields false rather than crashing categorization of a whole import).
export function matchRule(rule: Rule, label: string): boolean {
  const hay = prep(label, rule.caseSensitive);
  const needle = prep(rule.pattern, rule.caseSensitive);
  switch (rule.matchType) {
    case "EXACT":
      return hay.trim() === needle.trim();
    case "STARTS_WITH":
      return hay.trimStart().startsWith(needle.trim());
    case "CONTAINS":
      return hay.includes(needle);
    case "REGEX":
      try {
        return new RegExp(rule.pattern, rule.caseSensitive ? "" : "i").test(label);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// Highest-priority matching rule (ties broken by array order, callers pre-sort).
export function pickByPriority(rules: Rule[], label: string): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matchRule(r, label)) continue;
    if (!best || (r.priority ?? 100) > (best.priority ?? 100)) best = r;
  }
  return best;
}

// Suggests a rule pattern from a label for the learning dialog: the longest
// normalized token (most distinctive), as a case-insensitive CONTAINS rule.
export function proposeRule(rawLabel: string): { pattern: string; matchType: RuleMatchType } | null {
  const tokens = tokenize(rawLabel);
  if (tokens.length === 0) return null;
  const pattern = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  return { pattern, matchType: "CONTAINS" };
}
```

### Step 4: Add the rule validation module

Create `src/lib/validation/rule.ts`:

```typescript
import { z } from "zod";

export const RULE_MATCH_TYPES = ["CONTAINS", "EXACT", "STARTS_WITH", "REGEX"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

export const ruleInputSchema = z.object({
  pattern: z.string().trim().min(1).max(200),
  matchType: z.enum(RULE_MATCH_TYPES),
  caseSensitive: z.boolean().default(false),
  priority: z.coerce.number().int().min(0).max(10000).default(100),
  categoryId: z.string().min(1),
  groupId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type RuleInput = z.input<typeof ruleInputSchema>;
```

### Step 5: Run the matcher test to verify it passes

Run: `npm run test:unit -- categorization-match`
Expected: PASS.

### Step 6: Commit

```bash
git add src/lib/validation/rule.ts src/server/services/categorization/match.ts tests/unit/services/categorization-match.test.ts
git commit -m "feat: add pure categorization matcher and rule validation"
```

### Step 7: Extend the schema with CategorizationRule

In `prisma/schema.prisma`:

Add to `User` relations: `rules CategorizationRule[]`
Add to `Group` relations: `rules CategorizationRule[]`
Add to `Category` relations: `rules CategorizationRule[]`

Add the model (after `TransactionSearchToken`):

```prisma
model CategorizationRule {
  id            String   @id @default(cuid())
  pattern       String
  matchType     String // CONTAINS | EXACT | STARTS_WITH | REGEX
  caseSensitive Boolean  @default(false)
  priority      Int      @default(100)

  categoryId String
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  // Scope XOR (User or Group) — enforced at the service layer + a DB CHECK.
  userId  String?
  groupId String?
  user    User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group   Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@index([groupId])
  @@index([categoryId])
}
```

### Step 8: Generate migration + append XOR CHECK + reset

Run: `npm run db:migrate -- --name phase_3_3_rules`

Append to the generated `migration.sql`:

```sql
ALTER TABLE `CategorizationRule`
  ADD CONSTRAINT `CategorizationRule_scope_xor`
  CHECK ((`userId` IS NOT NULL) <> (`groupId` IS NOT NULL));
```

Run: `npm run db:reset` then `docker compose restart app`
Expected: all migrations apply with the CHECK.

### Step 9: Commit schema + migration

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add CategorizationRule model with scope XOR constraint"
```

### Step 10: Write failing suggest/createRule integration tests

Create `tests/integration/categorization.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { suggest, createRule, RuleAccessError } from "@/server/services/categorization";

const userId = "rule_user";
const stranger = "rule_stranger";
let catA: string;
let catB: string;
let groupId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userId, stranger] } } });
  await db.user.create({ data: { id: userId, email: "rule-user@bilan.local" } });
  await db.user.create({ data: { id: stranger, email: "rule-stranger@bilan.local" } });
  catA = (await db.category.create({ data: { name: "Groceries", userId } })).id;
  catB = (await db.category.create({ data: { name: "Salary", userId } })).id;
  const g = await db.group.create({ data: { name: "Foyer Rule", createdById: userId } });
  groupId = g.id;
  await db.groupMember.create({ data: { groupId, userId, role: "OWNER" } });
});

afterAll(async () => {
  await db.categorizationRule.deleteMany({ where: { OR: [{ userId: { in: [userId, stranger] } }, { groupId }] } });
  await db.category.deleteMany({ where: { userId } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.user.deleteMany({ where: { id: { in: [userId, stranger] } } });
  await db.$disconnect();
});

describe("categorization suggest", () => {
  it("returns null when no rule matches", async () => {
    expect(await suggest("UNKNOWN MERCHANT", { userId })).toEqual({ categoryId: null, ruleId: null });
  });

  it("applies a user rule and prefers higher priority", async () => {
    await createRule({ pattern: "carrefour", matchType: "CONTAINS", priority: 100, categoryId: catA }, { id: userId });
    const win = await createRule(
      { pattern: "carrefour city", matchType: "CONTAINS", priority: 500, categoryId: catB },
      { id: userId },
    );
    const res = await suggest("CB CARREFOUR CITY PARIS", { userId });
    expect(res.categoryId).toBe(catB);
    expect(res.ruleId).toBe(win.id);
  });

  it("includes group rules for the user's groups", async () => {
    const r = await createRule(
      { pattern: "edf", matchType: "CONTAINS", priority: 100, categoryId: catA, groupId },
      { id: userId },
    );
    const res = await suggest("PRLV EDF ENERGIE", { userId });
    expect(res.ruleId).toBe(r.id);
  });

  it("ignores disabled rules", async () => {
    const r = await createRule({ pattern: "uber", matchType: "CONTAINS", categoryId: catA }, { id: userId });
    await db.categorizationRule.update({ where: { id: r.id }, data: { enabled: false } });
    expect((await suggest("UBER EATS", { userId })).ruleId).toBeNull();
  });
});

describe("createRule authorization", () => {
  it("blocks creating a group rule for a non-member", async () => {
    await expect(
      createRule({ pattern: "x", matchType: "CONTAINS", categoryId: catA, groupId }, { id: stranger }),
    ).rejects.toBeInstanceOf(RuleAccessError);
  });
});
```

### Step 11: Run to verify it fails

Run: `npm run test:integration -- categorization`
Expected: FAIL — module not found.

### Step 12: Implement the categorization service

Create `src/server/services/categorization/index.ts`:

```typescript
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { requireGroupRole } from "@/server/services/groups/roles";
import { ruleInputSchema, type RuleInput } from "@/lib/validation/rule";
import { pickByPriority, proposeRule, type Rule } from "./match";
import type { RuleMatchType } from "@/lib/validation/rule";

export class RuleAccessError extends Error {}

export type Suggestion = { categoryId: string | null; ruleId: string | null };
export type Scope = { userId: string };

// Suggests a category for a label by matching the user's own + their groups'
// enabled rules, highest priority first. Used by manual entry (3.4) and import (4.x).
export async function suggest(rawLabel: string, scope: Scope): Promise<Suggestion> {
  const memberships = await db.groupMember.findMany({
    where: { userId: scope.userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.categorizationRule.findMany({
    where: { enabled: true, OR: [{ userId: scope.userId }, { groupId: { in: groupIds } }] },
    orderBy: { priority: "desc" },
  });
  const rules: Rule[] = rows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    pattern: r.pattern,
    matchType: r.matchType as RuleMatchType,
    caseSensitive: r.caseSensitive,
    priority: r.priority,
  }));
  const hit = pickByPriority(rules, rawLabel);
  return hit ? { categoryId: hit.categoryId, ruleId: hit.id } : { categoryId: null, ruleId: null };
}

export async function createRule(
  input: RuleInput,
  actor: { id: string },
): Promise<{ id: string }> {
  const data = ruleInputSchema.parse(input);
  if (data.groupId) {
    try {
      await requireGroupRole(data.groupId, actor.id, "ADMIN");
    } catch {
      throw new RuleAccessError("FORBIDDEN");
    }
  }
  const rule = await db.categorizationRule.create({
    data: {
      pattern: data.pattern,
      matchType: data.matchType,
      caseSensitive: data.caseSensitive,
      priority: data.priority,
      categoryId: data.categoryId,
      userId: data.groupId ? null : actor.id,
      groupId: data.groupId ?? null,
    },
  });
  await logEvent({ userId: actor.id, action: "rule.created", entity: "CategorizationRule", entityId: rule.id });
  return { id: rule.id };
}

export async function listRulesForUser(userId: string) {
  const memberships = await db.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);
  return db.categorizationRule.findMany({
    where: { OR: [{ userId }, { groupId: { in: groupIds } }] },
    orderBy: { priority: "desc" },
  });
}

export { proposeRule };
```

### Step 13: Run to verify it passes

Run: `npm run test:integration -- categorization`
Expected: PASS.

### Step 14: Commit

```bash
git add src/server/services/categorization/index.ts tests/integration/categorization.test.ts
git commit -m "feat: add categorization suggest engine and rule creation"
```

### Step 15: Implement the createRule server action

Create `src/server/transport/actions/rules.ts`:

```typescript
"use server";

import { requireSession } from "@/server/auth/permissions";
import { ruleInputSchema } from "@/lib/validation/rule";
import { createRule, RuleAccessError } from "@/server/services/categorization";

export type RuleActionState = { ok: true } | { ok: false; error: string } | null;

export async function createRuleAction(
  _prev: RuleActionState,
  formData: FormData,
): Promise<RuleActionState> {
  const user = await requireSession();
  const parsed = ruleInputSchema.safeParse({
    pattern: formData.get("pattern") ?? "",
    matchType: formData.get("matchType") ?? "CONTAINS",
    caseSensitive: formData.get("caseSensitive") === "true",
    priority: formData.get("priority") ?? 100,
    categoryId: formData.get("categoryId") ?? "",
    groupId: formData.get("groupId") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await createRule(parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof RuleAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}
```

> The recategorize → "create a rule?" UI dialog (`create-rule-dialog.tsx`) is built in Task 3.4 alongside the transactions list, since it is triggered from a transaction row. Its e2e lives in `tests/e2e/categorization.spec.ts` but depends on 3.4's list page; defer the e2e file to 3.4 (see 3.4 Step "recategorize → rule") and only ship the action here.

### Step 16: Run CI, commit, push, PR

Run: `npm run ci`
Expected: PASS.

```bash
git add src/server/transport/actions/rules.ts
git commit -m "feat: add create-rule server action"
git push -u origin feature/3.3-categorization
gh pr create --base develop --title "feat: categorization engine + learning" --body "Closes #20-rules"
```

> Replace with the real 3.3 issue number.

---

## Task 3.4 — Transactions list + manual entry

**Branch:** `feature/3.4-transactions-list`
**Goal:** `/transactions` page (day-grouped cards on mobile, table on desktop), filters (account/category/type/date range), HMAC token search, inline category edit with the "create a rule?" learning dialog, and a manual-entry form that uses `suggest()` to pre-fill the category.

**Files:**
- Modify: `src/server/services/transactions/index.ts` (add `listTransactions`, `recategorizeTransaction`)
- Create: `src/server/transport/actions/transactions.ts`
- Create: `src/app/[locale]/(authenticated)/transactions/page.tsx`
- Create: `src/components/transactions/{transaction-list,transaction-form,transaction-filters,category-picker,create-rule-dialog}.tsx`
- Modify: `messages/fr.json`, `messages/en.json`
- Test: `tests/integration/transactions-list.test.ts`, `tests/e2e/transactions.spec.ts`, `tests/e2e/categorization.spec.ts`

### Step 1: Write failing list/search/recategorize integration tests

Create `tests/integration/transactions-list.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createTransaction, listTransactions, recategorizeTransaction } from "@/server/services/transactions";

const owner = "txl_owner";
const member = "txl_member";
let accountId: string;
let groupId: string;
let catGroceries: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  await db.user.create({ data: { id: owner, email: "txl-owner@bilan.local" } });
  await db.user.create({ data: { id: member, email: "txl-member@bilan.local" } });
  const acc = await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } });
  accountId = acc.id;
  const g = await db.group.create({ data: { name: "Foyer TXL", createdById: owner } });
  groupId = g.id;
  await db.groupMember.createMany({
    data: [
      { groupId, userId: owner, role: "OWNER" },
      { groupId, userId: member, role: "MEMBER" },
    ],
  });
  await db.accountShare.create({ data: { accountId, groupId, permission: "READ", createdById: owner } });
  catGroceries = (await db.category.create({ data: { name: "Groceries", userId: owner } })).id;

  await createTransaction({ accountId, date: "2026-02-01", amount: -10, type: "CARD", label: "Carrefour" }, { id: owner });
  await createTransaction({ accountId, date: "2026-02-02", amount: -20, type: "CARD", label: "Leclerc Drive" }, { id: owner });
  await createTransaction({ accountId, date: "2026-02-03", amount: 1500, type: "TRANSFER", label: "Salaire" }, { id: owner });
});

afterAll(async () => {
  await db.transaction.deleteMany({ where: { accountId } });
  await db.accountShare.deleteMany({ where: { groupId } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.bankAccount.deleteMany({ where: { ownerId: owner } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.user.deleteMany({ where: { id: { in: [owner, member] } } });
  await db.$disconnect();
});

describe("listTransactions", () => {
  it("returns the owner's transactions, decrypted, newest first", async () => {
    const { items, total } = await listTransactions(owner, {});
    expect(total).toBe(3);
    expect(items[0].label).toBe("Salaire");
    expect(items.map((i) => i.label)).toEqual(["Salaire", "Leclerc Drive", "Carrefour"]);
  });

  it("filters by type and by amount via token search", async () => {
    const byType = await listTransactions(owner, { type: "TRANSFER" });
    expect(byType.items.map((i) => i.label)).toEqual(["Salaire"]);

    const bySearch = await listTransactions(owner, { search: "leclerc" });
    expect(bySearch.items.map((i) => i.label)).toEqual(["Leclerc Drive"]);
  });

  it("lets a READ member see shared-account transactions but not write", async () => {
    const { items } = await listTransactions(member, {});
    expect(items.length).toBe(3);
  });

  it("recategorizes a transaction and flags it manuallyCategorized", async () => {
    const { items } = await listTransactions(owner, { search: "carrefour" });
    await recategorizeTransaction(items[0].id, catGroceries, { id: owner });
    const after = await db.transaction.findUniqueOrThrow({ where: { id: items[0].id } });
    expect(after.categoryId).toBe(catGroceries);
    expect(after.manuallyCategorized).toBe(true);
  });
});
```

### Step 2: Run to verify it fails

Run: `npm run test:integration -- transactions-list`
Expected: FAIL — `listTransactions`/`recategorizeTransaction` not exported.

### Step 3: Implement listTransactions + recategorizeTransaction

Append to `src/server/services/transactions/index.ts`:

```typescript
import { hmacForSearch } from "@/server/crypto/hmac";
import { searchKey } from "@/server/crypto/keys";
import { listVisibleForUser } from "@/server/services/accounts";
import type { TransactionType } from "@/lib/validation/transaction";

export type TransactionListItem = TransactionView & { accountName: string };

export type TransactionFilters = {
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  from?: Date;
  to?: Date;
  search?: string; // single normalized word → token match
  take?: number;
  skip?: number;
};

// Lists transactions across every account visible to the user (owned + shared),
// decrypted, newest first. `search` matches one normalized word via the HMAC
// token index (no plaintext ever touches the query).
export async function listTransactions(
  userId: string,
  filters: TransactionFilters,
): Promise<{ items: TransactionListItem[]; total: number }> {
  const visible = await listVisibleForUser(userId);
  const visibleIds = visible.map((a) => a.id);
  const accountName = new Map(visible.map((a) => [a.id, a.name]));
  const accountIds =
    filters.accountId && visibleIds.includes(filters.accountId)
      ? [filters.accountId]
      : visibleIds;
  if (accountIds.length === 0) return { items: [], total: 0 };

  const where: Record<string, unknown> = { accountId: { in: accountIds } };
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.type) where.type = filters.type;
  if (filters.from || filters.to) {
    where.date = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.search?.trim()) {
    where.searchTokens = { some: { tokenHash: hmacForSearch(filters.search, searchKey) } };
  }

  const [rows, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: filters.take ?? 100,
      skip: filters.skip ?? 0,
    }),
    db.transaction.count({ where }),
  ]);

  const items: TransactionListItem[] = rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amount: Number(row.amount),
    type: row.type,
    label: decrypt(row.labelEnc, dataKey),
    note: row.noteEnc ? decrypt(row.noteEnc, dataKey) : null,
    categoryId: row.categoryId,
    manuallyCategorized: row.manuallyCategorized,
    accountName: accountName.get(row.accountId) ?? "",
  }));
  return { items, total };
}

// Sets a transaction's category (manual override). Requires WRITE on the account.
export async function recategorizeTransaction(
  id: string,
  categoryId: string | null,
  actor: { id: string },
): Promise<void> {
  const row = await db.transaction.findUnique({ where: { id } });
  if (!row) throw new TransactionAccessError("NOT_FOUND");
  if (!(await canWriteAccount(actor.id, row.accountId))) throw new TransactionAccessError("FORBIDDEN");
  await db.transaction.update({
    where: { id },
    data: { categoryId, manuallyCategorized: true },
  });
  await logEvent({ userId: actor.id, action: "transaction.recategorized", entity: "Transaction", entityId: id });
}
```

> Note: `search` matches a single word (one HMAC token). Multi-word search (AND of tokens) is a future refinement; one word covers the AC. Document this so the executor doesn't over-build.

### Step 4: Run to verify it passes

Run: `npm run test:integration -- transactions-list`
Expected: PASS.

### Step 5: Commit

```bash
git add src/server/services/transactions/index.ts tests/integration/transactions-list.test.ts
git commit -m "feat: add transaction listing with filters, token search and recategorize"
```

### Step 6: Implement the transactions server actions

Create `src/server/transport/actions/transactions.ts`:

```typescript
"use server";

import { requireSession } from "@/server/auth/permissions";
import { transactionInputSchema } from "@/lib/validation/transaction";
import {
  createTransaction,
  recategorizeTransaction,
  TransactionAccessError,
} from "@/server/services/transactions";
import { suggest } from "@/server/services/categorization";

export type TxActionState = { ok: true; id?: string } | { ok: false; error: string } | null;

function mapError(e: unknown): string {
  return e instanceof TransactionAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

export async function createTransactionAction(
  _prev: TxActionState,
  formData: FormData,
): Promise<TxActionState> {
  const user = await requireSession();
  const parsed = transactionInputSchema.safeParse({
    accountId: formData.get("accountId") ?? "",
    date: formData.get("date") ?? "",
    amount: formData.get("amount") ?? "",
    type: formData.get("type") ?? "OTHER",
    label: formData.get("label") ?? "",
    note: formData.get("note") || undefined,
    categoryId: formData.get("categoryId") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    // If the user didn't pick a category, fall back to the rule engine.
    let categoryId = parsed.data.categoryId ?? null;
    let manual = Boolean(parsed.data.categoryId);
    if (!categoryId) {
      const s = await suggest(parsed.data.label, { userId: user.id });
      categoryId = s.categoryId;
      manual = false;
    }
    const { id } = await createTransaction(
      { ...parsed.data, categoryId: categoryId ?? undefined },
      { id: user.id },
      { manuallyCategorized: manual },
    );
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function recategorizeTransactionAction(
  _prev: TxActionState,
  formData: FormData,
): Promise<TxActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await recategorizeTransaction(id, categoryId, { id: user.id });
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
  return { ok: true };
}
```

### Step 7: Add the `transactions` i18n namespace

In `messages/fr.json` add the top-level namespace:

```json
  "transactions": {
    "title": "Transactions",
    "subtitle": "Vos opérations sur tous les comptes visibles.",
    "empty": "Aucune transaction.",
    "create": "Nouvelle transaction",
    "createTitle": "Ajouter une transaction",
    "account": "Compte",
    "date": "Date",
    "amount": "Montant",
    "type": "Type",
    "label": "Libellé",
    "labelPlaceholder": "Carrefour City",
    "note": "Note",
    "category": "Catégorie",
    "noCategory": "Sans catégorie",
    "search": "Rechercher",
    "searchPlaceholder": "Un mot (≥ 3 lettres)",
    "filters": "Filtres",
    "allAccounts": "Tous les comptes",
    "allCategories": "Toutes les catégories",
    "allTypes": "Tous les types",
    "from": "Du",
    "to": "Au",
    "cancel": "Annuler",
    "save": "Enregistrer",
    "saving": "Enregistrement…",
    "createCta": "Ajouter",
    "types": {
      "CARD": "Carte",
      "TRANSFER": "Virement",
      "DIRECT_DEBIT": "Prélèvement",
      "CHEQUE": "Chèque",
      "ATM": "Retrait",
      "OTHER": "Autre"
    },
    "rulePrompt": {
      "title": "Créer une règle ?",
      "body": "Catégoriser automatiquement les futures transactions contenant « {pattern} » comme {category} ?",
      "pattern": "Motif",
      "scope": "Portée",
      "scopePersonal": "Mes comptes",
      "decline": "Non merci",
      "confirm": "Créer la règle"
    },
    "error": {
      "INVALID": "Vérifiez les champs.",
      "FORBIDDEN": "Action non autorisée.",
      "NOT_FOUND": "Transaction introuvable.",
      "FAILED": "Échec. Réessayez."
    }
  },
```

In `messages/en.json`, mirror:

```json
  "transactions": {
    "title": "Transactions",
    "subtitle": "Your operations across all visible accounts.",
    "empty": "No transactions yet.",
    "create": "New transaction",
    "createTitle": "Add a transaction",
    "account": "Account",
    "date": "Date",
    "amount": "Amount",
    "type": "Type",
    "label": "Label",
    "labelPlaceholder": "Carrefour City",
    "note": "Note",
    "category": "Category",
    "noCategory": "Uncategorized",
    "search": "Search",
    "searchPlaceholder": "One word (≥ 3 letters)",
    "filters": "Filters",
    "allAccounts": "All accounts",
    "allCategories": "All categories",
    "allTypes": "All types",
    "from": "From",
    "to": "To",
    "cancel": "Cancel",
    "save": "Save",
    "saving": "Saving…",
    "createCta": "Add",
    "types": {
      "CARD": "Card",
      "TRANSFER": "Transfer",
      "DIRECT_DEBIT": "Direct debit",
      "CHEQUE": "Cheque",
      "ATM": "ATM",
      "OTHER": "Other"
    },
    "rulePrompt": {
      "title": "Create a rule?",
      "body": "Automatically categorize future transactions containing \"{pattern}\" as {category}?",
      "pattern": "Pattern",
      "scope": "Scope",
      "scopePersonal": "My accounts",
      "decline": "No thanks",
      "confirm": "Create rule"
    },
    "error": {
      "INVALID": "Check the fields.",
      "FORBIDDEN": "Not allowed.",
      "NOT_FOUND": "Transaction not found.",
      "FAILED": "Failed. Try again."
    }
  },
```

### Step 8: Build the category-picker component

Create `src/components/transactions/category-picker.tsx`:

```typescript
"use client";

import { useTranslations } from "next-intl";

export type FlatCategory = { id: string; name: string; depth: number };

// Flattens a category forest into indented <option>s for a native select.
export function flattenCategories(
  tree: { id: string; name: string; children: { id: string; name: string; children: unknown[] }[] }[],
): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (
    nodes: { id: string; name: string; children: unknown[] }[],
    depth: number,
  ) => {
    for (const n of nodes) {
      out.push({ id: n.id, name: n.name, depth });
      walk(n.children as typeof nodes, depth + 1);
    }
  };
  walk(tree as never, 0);
  return out;
}

export function CategoryPicker({
  name,
  categories,
  defaultValue,
  onChange,
}: {
  name: string;
  categories: FlatCategory[];
  defaultValue?: string | null;
  onChange?: (id: string) => void;
}) {
  const t = useTranslations("transactions");
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
    >
      <option value="">{t("noCategory")}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {`${"  ".repeat(c.depth)}${c.name}`}
        </option>
      ))}
    </select>
  );
}
```

### Step 9: Build the create-rule dialog (learning loop)

Create `src/components/transactions/create-rule-dialog.tsx`:

```typescript
"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createRuleAction } from "@/server/transport/actions/rules";

// Shown after a manual recategorization. Pre-filled with a proposed CONTAINS
// pattern (most distinctive token) and the chosen category.
export function CreateRuleDialog({
  open,
  onOpenChange,
  pattern,
  categoryId,
  categoryName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pattern: string;
  categoryId: string;
  categoryName: string;
}) {
  const t = useTranslations("transactions");
  const [pending, startTransition] = useTransition();

  function handleAction(formData: FormData) {
    startTransition(async () => {
      await createRuleAction(null, formData);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("rulePrompt.title")}</DialogTitle>
          <DialogDescription>
            {t("rulePrompt.body", { pattern, category: categoryName })}
          </DialogDescription>
        </DialogHeader>
        <form action={handleAction} className="space-y-4">
          <input type="hidden" name="matchType" value="CONTAINS" />
          <input type="hidden" name="categoryId" value={categoryId} />
          <div className="space-y-2">
            <Label htmlFor="rule-pattern">{t("rulePrompt.pattern")}</Label>
            <Input id="rule-pattern" name="pattern" defaultValue={pattern} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("rulePrompt.decline")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("rulePrompt.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

### Step 10: Build the transaction filters component

Create `src/components/transactions/transaction-filters.tsx`:

```typescript
"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Input } from "@/components/ui/input";
import { TRANSACTION_TYPES } from "@/lib/validation/transaction";

export function TransactionFilters({
  accounts,
  categories,
}: {
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; depth: number }[];
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Input
        type="search"
        placeholder={t("searchPlaceholder")}
        defaultValue={params.get("search") ?? ""}
        onChange={(e) => setParam("search", e.target.value)}
        aria-label={t("search")}
      />
      <select
        aria-label={t("account")}
        defaultValue={params.get("accountId") ?? ""}
        onChange={(e) => setParam("accountId", e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        <option value="">{t("allAccounts")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t("category")}
        defaultValue={params.get("categoryId") ?? ""}
        onChange={(e) => setParam("categoryId", e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        <option value="">{t("allCategories")}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {`${"  ".repeat(c.depth)}${c.name}`}
          </option>
        ))}
      </select>
      <select
        aria-label={t("type")}
        defaultValue={params.get("type") ?? ""}
        onChange={(e) => setParam("type", e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        <option value="">{t("allTypes")}</option>
        {TRANSACTION_TYPES.map((ty) => (
          <option key={ty} value={ty}>
            {t(`types.${ty}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
```

### Step 11: Build the transaction list component (day-grouped cards + inline category edit)

Create `src/components/transactions/transaction-list.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CategoryPicker, type FlatCategory } from "./category-picker";
import { CreateRuleDialog } from "./create-rule-dialog";
import { recategorizeTransactionAction } from "@/server/transport/actions/transactions";

export type ListItem = {
  id: string;
  date: string; // ISO
  amount: number;
  type: string;
  label: string;
  accountName: string;
  categoryId: string | null;
};

function proposePattern(label: string): string {
  const tokens = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  return tokens.length ? tokens.reduce((a, b) => (b.length > a.length ? b : a)) : "";
}

export function TransactionList({
  items,
  categories,
}: {
  items: ListItem[];
  categories: FlatCategory[];
}) {
  const t = useTranslations("transactions");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rule, setRule] = useState<{ pattern: string; categoryId: string; categoryName: string } | null>(null);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  if (items.length === 0) return <p className="text-muted-foreground text-sm">{t("empty")}</p>;

  const nf = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const df = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });

  // Group by ISO day (items already newest-first).
  const groups = new Map<string, ListItem[]>();
  for (const it of items) {
    const day = it.date.slice(0, 10);
    (groups.get(day) ?? groups.set(day, []).get(day)!).push(it);
  }

  function handleRecategorize(it: ListItem, categoryId: string) {
    const fd = new FormData();
    fd.set("id", it.id);
    fd.set("categoryId", categoryId);
    startTransition(async () => {
      const r = await recategorizeTransactionAction(null, fd);
      if (r?.ok) {
        router.refresh();
        if (categoryId) {
          const pattern = proposePattern(it.label);
          if (pattern) setRule({ pattern, categoryId, categoryName: catName.get(categoryId) ?? "" });
        }
      }
    });
  }

  return (
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([day, rows]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            {df.format(new Date(day))}
          </h2>
          <div className="divide-border border-border divide-y rounded-lg border">
            {rows.map((it) => (
              <div
                key={it.id}
                data-slot="transaction-row"
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {it.accountName} · {t(`types.${it.type}`)}
                  </p>
                </div>
                <div className="w-44">
                  <CategoryPicker
                    name={`cat-${it.id}`}
                    categories={categories}
                    defaultValue={it.categoryId}
                    onChange={(id) => handleRecategorize(it, id)}
                  />
                </div>
                <span
                  className={`w-24 text-right text-sm tabular-nums ${it.amount < 0 ? "" : "text-emerald-600"}`}
                >
                  {nf.format(it.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {rule && (
        <CreateRuleDialog
          open={!!rule}
          onOpenChange={(o) => !o && setRule(null)}
          pattern={rule.pattern}
          categoryId={rule.categoryId}
          categoryName={rule.categoryName}
        />
      )}
    </div>
  );
}
```

### Step 12: Build the manual-entry form

Create `src/components/transactions/transaction-form.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CategoryPicker, type FlatCategory } from "./category-picker";
import { TRANSACTION_TYPES } from "@/lib/validation/transaction";
import { createTransactionAction, type TxActionState } from "@/server/transport/actions/transactions";

export function TransactionForm({
  accounts,
  categories,
  defaultAccountId,
  trigger,
}: {
  accounts: { id: string; name: string }[];
  categories: FlatCategory[];
  defaultAccountId?: string;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAction(formData: FormData) {
    startTransition(async () => {
      const result: TxActionState = await createTransactionAction(null, formData);
      if (result?.ok) {
        setError(null);
        setOpen(false);
        router.refresh();
      } else {
        setError(result?.error ?? "FAILED");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(n) => { setOpen(n); if (!n) setError(null); }}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 pt-5 pb-4 text-left">
          <DialogTitle className="font-display text-2xl">{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form action={handleAction} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="tx-account">{t("account")}</Label>
              <select
                id="tx-account"
                name="accountId"
                defaultValue={defaultAccountId ?? accounts[0]?.id ?? ""}
                required
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tx-date">{t("date")}</Label>
                <Input id="tx-date" name="date" type="date" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-amount">{t("amount")}</Label>
                <Input id="tx-amount" name="amount" inputMode="decimal" placeholder="-12,34" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-label">{t("label")}</Label>
              <Input id="tx-label" name="label" placeholder={t("labelPlaceholder")} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tx-type">{t("type")}</Label>
                <select
                  id="tx-type"
                  name="type"
                  defaultValue="CARD"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                >
                  {TRANSACTION_TYPES.map((ty) => (
                    <option key={ty} value={ty}>{t(`types.${ty}`)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tx-category">{t("category")}</Label>
                <CategoryPicker name="categoryId" categories={categories} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tx-note">{t("note")}</Label>
              <Input id="tx-note" name="note" maxLength={1000} />
            </div>
            {error && <p className="text-destructive text-sm">{t(`error.${error}`)}</p>}
          </div>
          <DialogFooter className="bg-muted/40 border-border shrink-0 border-t px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              <Check />
              {pending ? t("saving") : t("createCta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

### Step 13: Build the transactions page

Create `src/app/[locale]/(authenticated)/transactions/page.tsx`:

```typescript
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireSession } from "@/server/auth/permissions";
import { listTransactions } from "@/server/services/transactions";
import { listForUser } from "@/server/services/categories";
import { listVisibleForUser } from "@/server/services/accounts";
import { flattenCategories } from "@/components/transactions/category-picker";
import { TransactionList, type ListItem } from "@/components/transactions/transaction-list";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { Button } from "@/components/ui/button";
import { TRANSACTION_TYPES, type TransactionType } from "@/lib/validation/transaction";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const user = await requireSession();
  const t = await getTranslations("transactions");

  const type =
    sp.type && (TRANSACTION_TYPES as readonly string[]).includes(sp.type)
      ? (sp.type as TransactionType)
      : undefined;

  const [{ items }, tree, accounts] = await Promise.all([
    listTransactions(user.id, {
      accountId: sp.accountId,
      categoryId: sp.categoryId,
      type,
      search: sp.search,
      from: sp.from ? new Date(sp.from) : undefined,
      to: sp.to ? new Date(sp.to) : undefined,
    }),
    listForUser(user.id),
    listVisibleForUser(user.id),
  ]);

  const flatCategories = flattenCategories(tree);
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  const listItems: ListItem[] = items.map((i) => ({
    id: i.id,
    date: i.date.toISOString(),
    amount: i.amount,
    type: i.type,
    label: i.label,
    accountName: i.accountName,
    categoryId: i.categoryId,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <TransactionForm
          accounts={accountOptions}
          categories={flatCategories}
          trigger={
            <Button disabled={accountOptions.length === 0}>
              <Plus />
              {t("create")}
            </Button>
          }
        />
      </header>
      <TransactionFilters accounts={accountOptions} categories={flatCategories} />
      <TransactionList items={listItems} categories={flatCategories} />
    </div>
  );
}
```

### Step 14: Write the e2e tests

Create `tests/e2e/transactions.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("transactions", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("create a manual transaction and find it via search", async ({ page }) => {
    const label = `Boulangerie ${Date.now()}`;
    await page.goto("/fr/transactions");
    // Requires the owner to have at least one account (seeded e2e fixture).
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-15");
    await page.fill('input[name="amount"]', "-8,50");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: label });
    await expect(row.first()).toBeVisible();

    // Token search (first distinctive word).
    await page.getByPlaceholder(/un mot/i).fill("boulangerie");
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
    ).toBeVisible();
  });
});

test("unauthenticated /transactions redirects to login", async ({ page }) => {
  await page.goto("/fr/transactions");
  await expect(page).toHaveURL(/\/login$/);
});
```

Create `tests/e2e/categorization.spec.ts` (recategorize → rule, depends on 3.4's list):

```typescript
import { test, expect } from "@playwright/test";

test.describe("categorization learning", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile dialog/bottom-sheet refinement deferred to Phase 8.3",
  );

  test("recategorizing a transaction offers to create a rule", async ({ page }) => {
    const label = `Leclerc ${Date.now()}`;
    await page.goto("/fr/transactions");
    await page.getByRole("button", { name: /nouvelle transaction/i }).click();
    await page.fill('input[name="date"]', "2026-02-16");
    await page.fill('input[name="amount"]', "-30");
    await page.fill('input[name="label"]', label);
    await page.getByRole("button", { name: /^ajouter$/i }).click();

    const row = page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first();
    await expect(row).toBeVisible();
    // Pick the first real category in the row's select.
    await row.locator("select").selectOption({ index: 1 });

    // The "create a rule?" dialog appears.
    await expect(page.getByRole("dialog")).toContainText(/créer une règle/i);
    await page.getByRole("button", { name: /créer la règle/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
```

> **e2e fixture dependency:** these specs require the `owner@e2e.local` user to have at least one bank account and (via the signup hook) default categories. The owner account fixture is created during e2e auth setup / seed (see Phase 2 e2e). If the owner has no account, add one in `tests/e2e/auth.setup.ts` or the e2e seed before this scope's flows. Confirm `npm run test:e2e -- transactions` is green; if the "new transaction" button is disabled, the fixture lacks an account — fix the fixture, do not weaken the test.

### Step 15: Run CI + e2e

Run: `npm run ci`
Expected: PASS.

Run: `npm run test:e2e -- transactions categorization`
Expected: PASS (chromium + mobile; webkit skipped).

### Step 16: Commit, push, PR

```bash
git add src/server/services/transactions src/server/transport/actions/transactions.ts "src/app/[locale]/(authenticated)/transactions" src/components/transactions messages tests/e2e/transactions.spec.ts tests/e2e/categorization.spec.ts
git commit -m "feat: transactions list with filters, search, inline recategorize and manual entry"
git push -u origin feature/3.4-transactions-list
gh pr create --base develop --title "feat: transactions list + manual entry" --body "Closes #21"
```

> Replace `#21` with the real 3.4 issue number.

---

## Self-Review notes (for the executor)

**Spec coverage (PLAN.md Phase 3 + spec §4.4/§4.5/§5.6):**
- 3.1 Categories user XOR group, default sets fr/en, hierarchical CRUD, XOR enforced → Tasks 3.1 (service XOR + DB CHECK, seed fixtures + wiring, tree CRUD UI). ✅
- 3.2 Transaction (encrypted label/rawLabel/note, HMAC hashes), TransactionSearchToken, crypto → Task 3.2 (`buildSecureFields`, models, `createTransaction` writes tokens). Crypto primitives reused from 0.4 (`tests/unit/crypto/*` already cover round-trip/key-failure — do not duplicate; add the secure-fields unit test instead). ✅
- 3.3 CategorizationRule, `suggest`, "create a rule?" dialog, all match types + priority → Task 3.3 (`match.ts` unit-tested for EXACT/STARTS_WITH/CONTAINS/REGEX + priority + bad-regex safety, `suggest` integration, `createRuleAction`) and the dialog in 3.4. ✅
- 3.4 `/transactions` day-grouped (mobile) / rows (desktop), filters, HMAC token search, inline category edit, manual entry → Task 3.4. ✅

**Type consistency check:**
- `CategoryInput`/`categoryInputSchema`, `TransactionInput`/`transactionInputSchema`, `RuleInput`/`ruleInputSchema` defined once and imported everywhere.
- Service error classes: `CategoryAccessError`, `TransactionAccessError`, `RuleAccessError` — consistent `mapError` in actions.
- `suggest(rawLabel, { userId })` signature matches every caller (action + tests). `createTransaction(input, actor, opts?)` matches action + tests.
- `RuleMatchType` shared between `match.ts`, the service, and validation. `Rule.priority` optional in the pure matcher; the service always passes it.
- `flattenCategories` consumes the `CategoryNode` forest from `listForUser`; `FlatCategory` used by both picker and filters.

**Known deferrals (documented, not gaps):**
- Search matches a single normalized word (one HMAC token). Multi-word AND search is a later refinement.
- `createTransaction` takes `categoryId` verbatim; auto-suggest is applied in the action layer (3.4) and will also be used by the CSV/PDF import pipeline (Phase 4).
- `categories` is surfaced in the desktop sidebar/`WORKSPACE_NAV`; the mobile `BOTTOM_NAV` stays at five tabs (categories reachable via the drawer) per the existing five-tab constraint.
- Mobile bottom-sheet polish + webkit e2e deferred to Phase 8.3 (matches the Phase 2 e2e skip pattern).
- The XOR `CHECK` constraint is hand-appended to the generated `migration.sql`; verify it survived `npm run db:reset` (MariaDB 11 enforces CHECK constraints).

**Before each PR:** `git checkout develop && git pull`, delete merged branches, branch `feature/3.x-...`, run `npm run ci`, GPG-sign commits (ask the user to unlock GPG if signing fails), open the PR with `Closes #<issue>` and the required type label (`enhancement`) plus phase/area labels.

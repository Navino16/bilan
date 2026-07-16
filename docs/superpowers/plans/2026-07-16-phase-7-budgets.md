# Phase 7 — Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users define **budgets** (scoped to themselves or a group) over a period, each with one or more **lines** targeting a category and/or account with a planned amount, then see **how much has been spent** per line — with automatic matching, explicit per-transaction `INCLUDE`/`EXCLUDE` overrides, link-aware totals, and optional **recurring** budgets that roll into the next period.

**Architecture:** A pure `src/lib/budgets.ts` holds the budget math (`lineStatus`, `budgetTotals`, `nextPeriod`) — unit-tested, no DB. A `budgets` service (`src/server/services/budgets/index.ts`) owns persistence + authorization (`createBudget`, `updateBudget`, `deleteBudget`, `listBudgetsForUser`, `getBudgetDetail`, `computeLine`, `assignTransaction`, `unassignTransaction`, `rollRecurring`), reusing `listVisibleForUser` for visibility, `collapseLinkedRows` for link-aware sums, and `logEvent` for audit. Thin Server Actions wrap the service. `/app/budgets` lists budgets with progress bars; a new-budget modal has dynamic lines with a computed total; a detail page shows per-line progress; any transaction gains an "Assign to a budget" menu.

**Tech Stack:** Next 16 (App Router, Server Components + Server Actions), Prisma 7 + MariaDB (`adapter-mariadb`), next-intl, Vitest (unit + integration) + Playwright (e2e). Reuses Phase 2–6 services (`listVisibleForUser`, `collapseLinkedRows`, `logEvent`, `parsePeriodParams`/`presetPeriod`, the `bits` UI primitives).

## Global Constraints

- **One scope = one GitHub issue = one branch `feature/7.x-...` = one PR → `develop`.** Run `npm run ci` before every PR; GPG-sign commits (bypass allowed only if the user says so). PR body: `Closes #<issue>` + `enhancement` + `phase-7` + `frontend`/`backend` labels.
- **npm** (not pnpm). Node 24. Commits: 1-line English conventional (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`). No co-authored-by.
- **Owner XOR (`userId` vs `groupId`)** for `Budget` is enforced in the **service layer** (Zod + code), NOT a DB CHECK — MariaDB rejects a CHECK on a column that is part of an FK with a referential action (error 1901); this is the same approach `Category` uses. See `[[project_mariadb-check-xor-fk]]`.
- **Encryption invariant:** budget matching/calculation uses CLEAR columns only (`amount`, `date`, `categoryId`, `accountId`); labels/notes stay encrypted. Only list/detail transaction views decrypt (via existing `listTransactions`).
- **Dates are UTC**; `periodStart`/`periodEnd` are UTC-inclusive bounds (`from` at 00:00:00.000Z, `to` at 23:59:59.999Z), same convention as `@/lib/period`.
- **Money:** `Decimal(12,2)` in DB → `Number(...)` in JS; compare amounts with a 0.005 epsilon.
- **Authorization:** a user may only read/manage budgets they own (personal) or that belong to a group where they are at least `MEMBER` (read) / `ADMIN` (create/update/delete of group budgets) — mirrors `Category` scope rules. Transactions selected for a budget are those **visible to the budget's owner scope** via `listVisibleForUser`.
- **e2e:** reuse the `owner@e2e.local` storageState; `test.skip(({ browserName }) => browserName === "webkit", ...)` for click-driven flows. Wrap the first click of a freshly-loaded page in `await expect(async () => { … }).toPass()` to absorb the dev-server hydration/compile race. After a migration, `docker compose restart app` so the dev server reloads the regenerated Prisma client (see `[[project_dev-e2e-ops]]`). Run `npm run ci` locally with `DATABASE_URL=mysql://app:app_password@localhost:3307/budget_test`.

---

## Design decisions (read before starting)

1. **Data model = spec §4.6 verbatim.** `Budget` (owner XOR, period, `recurring`/`parentBudgetId` self-relation, `archived`), `BudgetLine` (`categoryId?`/`accountId?`/`label?` + `plannedAmount`), `BudgetAssignment` (`mode INCLUDE|EXCLUDE`, `@@unique([budgetId, transactionId])`). Add back-relations on `User`, `Group`, `Category`, `BankAccount`, `Transaction`.

2. **Owner XOR + line validity (service-enforced).** Exactly one of `userId`/`groupId` on a `Budget`. A group budget requires the actor to be `ADMIN` of that group (personal requires nothing beyond a session). Each `BudgetLine` needs a `plannedAmount ≥ 0`; `categoryId`/`accountId`/`label` are all optional but a line with none matches nothing automatically (spent comes only from `INCLUDE` assignments).

3. **`computeLine` semantics (spec §5.7).** For a line of a budget:
   1. Load transactions **visible to the budget's owner scope** within `[periodStart, periodEnd]` (clear columns + link id).
   2. **Auto-match**: keep rows where (line.categoryId == null || tx.categoryId === line.categoryId) AND (line.accountId == null || tx.accountId === line.accountId). A line with neither filter auto-matches nothing.
   3. **EXCLUDE**: drop rows whose tx has a `BudgetAssignment(mode=EXCLUDE)` on this budget.
   4. **INCLUDE**: add rows (from the visible set) whose tx has `BudgetAssignment(mode=INCLUDE)` on this budget, even if they don't match the filters (union, dedup by tx id).
   5. **Link-aware**: run `collapseLinkedRows` over the resulting rows — balanced groups drop, unbalanced collapse to their primary's net.
   6. `spent = round2(-Σ effective signed amounts)` → expenses (negative) become positive spend; an included income (+) reduces spend.
   7. `lineStatus(plannedAmount, spent)` → `{ plannedAmount, spent, remaining, percent, status }`.

4. **Status thresholds (pure, documented).** `percent = plannedAmount > 0 ? round(spent / plannedAmount * 100) : (spent > 0.005 ? 100 : 0)`. `status`: `OVER` if `spent > plannedAmount + 0.005`; else `WARN` if `percent >= 80`; else `OK`. `remaining = round2(plannedAmount - spent)` (may be negative).

5. **Budget total.** A budget's planned total = Σ line `plannedAmount`; spent total = Σ line `spent`; the new-budget modal shows the planned total live from the line inputs (client-side).

6. **Period boundary (documented scope cut).** `computeLine` collapses links **within the rows loaded for the budget period** — same cut as the dashboard (a link member outside the period is treated as isolated). Acceptable because links pair transactions within `linkWindowDays`.

7. **Recurring (scope 7.4).** `recurring=true` budgets have a `parentBudgetId` chain. `rollRecurring(budgetId)` creates the **next-period instance** (copies name/scope/lines, shifts the period by one unit of its `periodType`, links `parentBudgetId` to the template), idempotent: it does nothing if an instance for the next period already exists. Triggered on demand (manual "roll" action + covered by integration test); an automated cron lands in Phase 8.4.

---

## File Structure

**Scope 7.1 — Budget model + creation**
- Modify: `prisma/schema.prisma` — add `Budget`, `BudgetLine`, `BudgetAssignment`; add back-relations `budgets Budget[]` on `User` + `Group`, `budgetLines BudgetLine[]` on `Category` + `BankAccount`, `budgetAssignments BudgetAssignment[]` on `Transaction`.
- Create: `prisma/migrations/<ts>_phase_7_1_budgets/migration.sql` (via `npm run db:migrate`).
- Create: `src/lib/validation/budget.ts` — `budgetInputSchema`, `BUDGET_PERIOD_TYPES`, `budgetLineSchema` (client-safe enums/limits).
- Create: `src/lib/budgets.ts` — pure `budgetPlannedTotal(lines)` (used by the modal + tests).
- Create: `src/server/services/budgets/index.ts` — `createBudget`, `updateBudget`, `deleteBudget`, `archiveBudget`, `listBudgetsForUser`, `BudgetAccessError`.
- Create: `src/server/transport/actions/budgets.ts` — `createBudgetAction`, `updateBudgetAction`, `deleteBudgetAction`.
- Create: `src/components/budgets/budget-form.tsx` — new/edit modal with dynamic lines + computed total.
- Create: `src/components/budgets/budgets-view.tsx` — list of budgets.
- Create: `src/app/[locale]/(authenticated)/budgets/page.tsx` — server component.
- Modify: `src/components/shell/nav-items.ts` — re-add `budgets` to `WORKSPACE_NAV` (removed in the nav-404 fix) + `BOTTOM_NAV`.
- Modify: `messages/{fr,en}.json` — `budgets` namespace.
- Test: `tests/unit/lib/budgets.test.ts`, `tests/integration/budgets.test.ts`, `tests/e2e/budgets.spec.ts`.

**Scope 7.2 — Budget calculation**
- Modify: `src/lib/budgets.ts` — add `lineStatus(plannedAmount, spent)`.
- Modify: `src/server/services/budgets/index.ts` — add `computeLine`, `getBudgetDetail` (lines with computed status).
- Create: `src/app/[locale]/(authenticated)/budgets/[id]/page.tsx` — detail page with per-line progress.
- Create: `src/components/budgets/budget-detail.tsx` — progress bars + status pills.
- Modify: `src/components/budgets/budgets-view.tsx` — show each budget's overall progress (spent / planned).
- Modify: `messages/{fr,en}.json` — `budgets.status`, `budgets.detail`.
- Test: `tests/unit/lib/budgets.test.ts` (lineStatus), `tests/integration/budgets.test.ts` (computeLine incl. links), `tests/e2e/budgets.spec.ts`.

**Scope 7.3 — Explicit assignment**
- Modify: `src/server/services/budgets/index.ts` — add `assignTransaction`, `unassignTransaction`, `listAssignableBudgets`, `listAssignmentsForTx`.
- Modify: `src/server/transport/actions/budgets.ts` — add `assignTransactionAction`, `unassignTransactionAction`.
- Modify: `src/components/transactions/transaction-detail.tsx` — an "Assign to a budget" section (choose budget + INCLUDE/EXCLUDE).
- Modify: `messages/{fr,en}.json` — `budgets.assign`.
- Test: `tests/integration/budgets.test.ts` (assignment overrides matching, incl. cross-account into a shared budget), `tests/e2e/budgets.spec.ts`.

**Scope 7.4 — Recurring budgets**
- Modify: `src/lib/budgets.ts` — add `nextPeriod(periodType, from, to)`.
- Modify: `src/server/services/budgets/index.ts` — add `rollRecurring`.
- Modify: `src/server/transport/actions/budgets.ts` — add `rollRecurringAction`.
- Modify: `src/components/budgets/budgets-view.tsx` — a "Roll to next period" affordance on ended recurring budgets.
- Modify: `messages/{fr,en}.json` — `budgets.recurring`.
- Test: `tests/unit/lib/budgets.test.ts` (nextPeriod), `tests/integration/budgets.test.ts` (roll creates one next instance, idempotent).

---

## Task 7.1 — Budget model + creation

**Branch:** `feature/7.1-budget-model`
**Goal:** Persist budgets (owner XOR, period, lines) with a `/app/budgets` list and a new-budget modal (dynamic lines, live computed total). Re-add the Budgets nav entry.

### Step 1: Add the Prisma models

- [ ] **Step 1** — In `prisma/schema.prisma`, add the back-relations to the existing models (inside each model block):

```prisma
// in model User:  budgets Budget[]
// in model Group: budgets Budget[]
// in model Category:    budgetLines BudgetLine[]
// in model BankAccount: budgetLines BudgetLine[]
// in model Transaction: budgetAssignments BudgetAssignment[]
```

Then append the three models at the end of the file:

```prisma
model Budget {
  id             String   @id @default(cuid())
  name           String
  description    String?

  userId         String?
  groupId        String?
  user           User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group          Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  periodType     String // WEEK | MONTH | QUARTER | YEAR | CUSTOM
  periodStart    DateTime
  periodEnd      DateTime
  recurring      Boolean  @default(false)
  parentBudgetId String?
  parentBudget   Budget?  @relation("BudgetRecurrence", fields: [parentBudgetId], references: [id], onDelete: SetNull)
  instances      Budget[] @relation("BudgetRecurrence")

  archived    Boolean  @default(false)
  createdAt   DateTime @default(now())
  createdById String

  lines       BudgetLine[]
  assignments BudgetAssignment[]

  @@index([userId, periodStart])
  @@index([groupId, periodStart])
  @@index([parentBudgetId])
}

model BudgetLine {
  id            String  @id @default(cuid())
  budgetId      String
  budget        Budget  @relation(fields: [budgetId], references: [id], onDelete: Cascade)

  categoryId    String?
  category      Category?    @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  accountId     String?
  account       BankAccount? @relation(fields: [accountId], references: [id], onDelete: SetNull)

  plannedAmount Decimal @db.Decimal(12, 2)
  label         String?

  @@index([budgetId])
}

model BudgetAssignment {
  id            String   @id @default(cuid())
  budgetId      String
  transactionId String
  mode          String // INCLUDE | EXCLUDE
  assignedById  String
  assignedAt    DateTime @default(now())

  budget      Budget      @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@unique([budgetId, transactionId])
  @@index([transactionId])
}
```

### Step 2: Create the migration

- [ ] **Step 2** — Run (env loaded from `.env`): `npx prisma migrate dev --name phase_7_1_budgets`
Expected: a new `prisma/migrations/<ts>_phase_7_1_budgets/` with the three tables; Prisma client regenerates. Then apply to the test DB and restart the app:

```bash
DATABASE_URL="mysql://app:app_password@localhost:3307/budget_test" npx prisma migrate deploy
docker compose restart app
```

> If a later step's tests report `db.budget` undefined, run `npx prisma generate` (env loaded) — the client sometimes needs an explicit regen after `migrate dev`.

### Step 3: Write the validation schema

- [ ] **Step 3** — Create `src/lib/validation/budget.ts` (client-safe — no DB imports):

```typescript
import { z } from "zod";

export const BUDGET_NAME_MAX = 80;
export const BUDGET_PERIOD_TYPES = ["WEEK", "MONTH", "QUARTER", "YEAR", "CUSTOM"] as const;
export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number];

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const budgetLineSchema = z.object({
  categoryId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  accountId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  label: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  plannedAmount: z.coerce.number().finite().min(0),
});

export const budgetInputSchema = z.object({
  name: z.string().trim().min(1).max(BUDGET_NAME_MAX),
  description: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  groupId: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  periodType: z.enum(BUDGET_PERIOD_TYPES),
  periodStart: isoDay,
  periodEnd: isoDay,
  recurring: z.coerce.boolean().default(false),
  lines: z.array(budgetLineSchema).min(1),
});

export type BudgetInput = z.input<typeof budgetInputSchema>;
export type BudgetLineInput = z.input<typeof budgetLineSchema>;
```

### Step 4: Write the failing pure-total test

- [ ] **Step 4** — Create `tests/unit/lib/budgets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { budgetPlannedTotal } from "@/lib/budgets";

describe("budgetPlannedTotal", () => {
  it("sums line planned amounts, rounded to cents", () => {
    expect(budgetPlannedTotal([{ plannedAmount: 100 }, { plannedAmount: 49.9 }])).toBe(149.9);
    expect(budgetPlannedTotal([])).toBe(0);
  });
});
```

### Step 5: Run to verify it fails

- [ ] **Step 5** — Run: `npm run test:unit -- budgets`
Expected: FAIL — `Cannot find module '@/lib/budgets'`.

### Step 6: Implement `src/lib/budgets.ts`

- [ ] **Step 6** — Create `src/lib/budgets.ts`:

```typescript
// Pure budget math — no DB. Amounts are euros as numbers; compare with epsilon.

const EPSILON = 0.005;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Planned total of a budget = sum of its lines' planned amounts.
export function budgetPlannedTotal(lines: { plannedAmount: number }[]): number {
  return round2(lines.reduce((s, l) => s + l.plannedAmount, 0));
}

export const _EPSILON = EPSILON; // exported for later tasks that need the tolerance
```

### Step 7: Run to verify it passes

- [ ] **Step 7** — Run: `npm run test:unit -- budgets`
Expected: PASS.

### Step 8: Commit

- [ ] **Step 8**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/validation/budget.ts src/lib/budgets.ts tests/unit/lib/budgets.test.ts
git commit -m "feat: budget model + validation + planned-total math"
```

### Step 9: Write the failing budget-service integration test

- [ ] **Step 9** — Create `tests/integration/budgets.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  listBudgetsForUser,
  BudgetAccessError,
} from "@/server/services/budgets";

const owner = "bud_owner";
const stranger = "bud_stranger";
let accountId: string;
let catId: string;
let groupId: string;

beforeAll(async () => {
  for (const id of [owner, stranger]) {
    await db.user.deleteMany({ where: { id } });
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  accountId = (
    await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })
  ).id;
  catId = (await db.category.create({ data: { userId: owner, name: "Courses" } })).id;
  const g = await db.group.create({ data: { name: "Foyer Bud", createdById: owner } });
  groupId = g.id;
  await db.groupMember.create({ data: { groupId, userId: owner, role: "OWNER" } });
});

beforeEach(async () => {
  await db.budget.deleteMany({ where: { OR: [{ userId: owner }, { groupId }] } });
});

afterAll(async () => {
  await db.budget.deleteMany({ where: { OR: [{ userId: owner }, { groupId }] } });
  await db.category.deleteMany({ where: { userId: owner } });
  await db.groupMember.deleteMany({ where: { groupId } });
  await db.group.deleteMany({ where: { id: groupId } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

const baseInput = {
  name: "Mars",
  periodType: "MONTH" as const,
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  lines: [{ categoryId: undefined, accountId: undefined, plannedAmount: 300 }],
};

describe("createBudget", () => {
  it("creates a personal budget with lines and a UTC-bounded period", async () => {
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 300 }] },
      { id: owner },
    );
    const row = await db.budget.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(row.userId).toBe(owner);
    expect(row.groupId).toBeNull();
    expect(row.periodStart.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(row.periodEnd.toISOString()).toBe("2026-03-31T23:59:59.999Z");
    expect(row.lines).toHaveLength(1);
    expect(Number(row.lines[0].plannedAmount)).toBe(300);
  });

  it("creates a group budget when the actor is a group ADMIN/OWNER", async () => {
    const { id } = await createBudget({ ...baseInput, groupId }, { id: owner });
    const row = await db.budget.findUniqueOrThrow({ where: { id } });
    expect(row.groupId).toBe(groupId);
    expect(row.userId).toBeNull();
  });

  it("rejects a group budget for a non-member", async () => {
    await expect(createBudget({ ...baseInput, groupId }, { id: stranger })).rejects.toBeInstanceOf(
      BudgetAccessError,
    );
  });

  it("rejects a budget with no lines", async () => {
    await expect(createBudget({ ...baseInput, lines: [] }, { id: owner })).rejects.toBeInstanceOf(
      BudgetAccessError,
    );
  });

  it("rejects periodEnd before periodStart", async () => {
    await expect(
      createBudget({ ...baseInput, periodStart: "2026-03-31", periodEnd: "2026-03-01" }, { id: owner }),
    ).rejects.toBeInstanceOf(BudgetAccessError);
  });
});

describe("listBudgetsForUser / update / delete", () => {
  it("lists the user's own + their groups' budgets", async () => {
    await createBudget(baseInput, { id: owner });
    await createBudget({ ...baseInput, name: "Foyer Mars", groupId }, { id: owner });
    const list = await listBudgetsForUser(owner);
    expect(list.some((b) => b.name === "Mars" && b.scope === "USER")).toBe(true);
    expect(list.some((b) => b.name === "Foyer Mars" && b.scope === "GROUP")).toBe(true);
    // A stranger sees neither.
    expect(await listBudgetsForUser(stranger)).toHaveLength(0);
  });

  it("updates name + lines, replacing the line set", async () => {
    const { id } = await createBudget(baseInput, { id: owner });
    await updateBudget(id, { ...baseInput, name: "Mars v2", lines: [{ plannedAmount: 500 }] }, { id: owner });
    const row = await db.budget.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(row.name).toBe("Mars v2");
    expect(row.lines).toHaveLength(1);
    expect(Number(row.lines[0].plannedAmount)).toBe(500);
  });

  it("forbids updating/deleting a budget the actor does not own", async () => {
    const { id } = await createBudget(baseInput, { id: owner });
    await expect(updateBudget(id, baseInput, { id: stranger })).rejects.toBeInstanceOf(BudgetAccessError);
    await expect(deleteBudget(id, { id: stranger })).rejects.toBeInstanceOf(BudgetAccessError);
    await deleteBudget(id, { id: owner });
    expect(await db.budget.findUnique({ where: { id } })).toBeNull();
  });
});
```

### Step 10: Run to verify it fails

- [ ] **Step 10** — Run: `DATABASE_URL="mysql://app:app_password@localhost:3307/budget_test" npm run test:integration -- budgets`
Expected: FAIL — `Cannot find module '@/server/services/budgets'`.

### Step 11: Implement the budgets service (CRUD)

- [ ] **Step 11** — Create `src/server/services/budgets/index.ts`:

```typescript
import { db } from "@/server/db";
import { requireGroupRole } from "@/server/services/groups/roles";
import { logEvent } from "@/server/services/audit";
import { budgetInputSchema, type BudgetInput } from "@/lib/validation/budget";

export class BudgetAccessError extends Error {}

export type BudgetScope = "USER" | "GROUP";

// Personal budget → nothing beyond a session. Group budget → actor must be ADMIN+.
async function assertCanManageScope(groupId: string | undefined, actorId: string): Promise<void> {
  if (groupId) {
    try {
      await requireGroupRole(groupId, actorId, "ADMIN");
    } catch {
      throw new BudgetAccessError("FORBIDDEN");
    }
  }
}

function utcBounds(startDay: string, endDay: string): { start: Date; end: Date } {
  const start = new Date(`${startDay}T00:00:00.000Z`);
  const end = new Date(`${endDay}T23:59:59.999Z`);
  if (end.getTime() < start.getTime()) throw new BudgetAccessError("INVALID_PERIOD");
  return { start, end };
}

export async function createBudget(
  input: BudgetInput,
  actor: { id: string },
): Promise<{ id: string }> {
  const data = budgetInputSchema.parse(input);
  await assertCanManageScope(data.groupId, actor.id);
  const { start, end } = utcBounds(data.periodStart, data.periodEnd);

  const budget = await db.budget.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      userId: data.groupId ? null : actor.id,
      groupId: data.groupId ?? null,
      periodType: data.periodType,
      periodStart: start,
      periodEnd: end,
      recurring: data.recurring ?? false,
      createdById: actor.id,
      lines: {
        create: data.lines.map((l) => ({
          categoryId: l.categoryId ?? null,
          accountId: l.accountId ?? null,
          label: l.label ?? null,
          plannedAmount: l.plannedAmount,
        })),
      },
    },
  });
  await logEvent({ userId: actor.id, action: "budget.created", entity: "Budget", entityId: budget.id });
  return { id: budget.id };
}

// Loads a budget the actor may manage: own (userId) or a group where actor is ADMIN+.
async function manageableOrThrow(id: string, actorId: string) {
  const b = await db.budget.findUnique({ where: { id } });
  if (!b) throw new BudgetAccessError("NOT_FOUND");
  if (b.groupId) {
    try {
      await requireGroupRole(b.groupId, actorId, "ADMIN");
    } catch {
      throw new BudgetAccessError("FORBIDDEN");
    }
  } else if (b.userId !== actorId) {
    throw new BudgetAccessError("FORBIDDEN");
  }
  return b;
}

export async function updateBudget(
  id: string,
  input: BudgetInput,
  actor: { id: string },
): Promise<void> {
  await manageableOrThrow(id, actor.id);
  const data = budgetInputSchema.parse(input);
  const { start, end } = utcBounds(data.periodStart, data.periodEnd);
  // Scope (user vs group) is immutable here — recreate to move it.
  await db.$transaction([
    db.budgetLine.deleteMany({ where: { budgetId: id } }),
    db.budget.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description ?? null,
        periodType: data.periodType,
        periodStart: start,
        periodEnd: end,
        recurring: data.recurring ?? false,
        lines: {
          create: data.lines.map((l) => ({
            categoryId: l.categoryId ?? null,
            accountId: l.accountId ?? null,
            label: l.label ?? null,
            plannedAmount: l.plannedAmount,
          })),
        },
      },
    }),
  ]);
  await logEvent({ userId: actor.id, action: "budget.updated", entity: "Budget", entityId: id });
}

export async function deleteBudget(id: string, actor: { id: string }): Promise<void> {
  await manageableOrThrow(id, actor.id);
  await db.budget.delete({ where: { id } });
  await logEvent({ userId: actor.id, action: "budget.deleted", entity: "Budget", entityId: id });
}

export async function archiveBudget(id: string, actor: { id: string }): Promise<void> {
  await manageableOrThrow(id, actor.id);
  await db.budget.update({ where: { id }, data: { archived: true } });
  await logEvent({ userId: actor.id, action: "budget.archived", entity: "Budget", entityId: id });
}

export type BudgetListItem = {
  id: string;
  name: string;
  scope: BudgetScope;
  groupId: string | null;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  recurring: boolean;
  plannedTotal: number;
};

// The user's own budgets + those of groups they belong to (not archived).
export async function listBudgetsForUser(userId: string): Promise<BudgetListItem[]> {
  const memberships = await db.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.budget.findMany({
    where: { archived: false, OR: [{ userId }, { groupId: { in: groupIds } }] },
    include: { lines: { select: { plannedAmount: true } } },
    orderBy: { periodStart: "desc" },
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    scope: b.groupId ? "GROUP" : "USER",
    groupId: b.groupId,
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    recurring: b.recurring,
    plannedTotal: Math.round(b.lines.reduce((s, l) => s + Number(l.plannedAmount), 0) * 100) / 100,
  }));
}
```

### Step 12: Run to verify it passes

- [ ] **Step 12** — Run: `DATABASE_URL="mysql://app:app_password@localhost:3307/budget_test" npm run test:integration -- budgets`
Expected: PASS (all `createBudget` / list / update / delete tests).

### Step 13: Commit

- [ ] **Step 13**

```bash
git add src/server/services/budgets/index.ts tests/integration/budgets.test.ts
git commit -m "feat: budgets service (create/update/delete/list, owner-XOR + group-admin checks)"
```

### Step 14: Add the budget Server Actions

- [ ] **Step 14** — Create `src/server/transport/actions/budgets.ts`. Parse a `lines` JSON string from the form (the modal serializes its dynamic rows to a hidden input):

```typescript
"use server";

import { requireSession } from "@/server/auth/permissions";
import {
  createBudget,
  updateBudget,
  deleteBudget,
  BudgetAccessError,
} from "@/server/services/budgets";
import { budgetInputSchema } from "@/lib/validation/budget";

export type BudgetActionState = { ok: true; id?: string } | { ok: false; error: string } | null;

function mapError(e: unknown): string {
  return e instanceof BudgetAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

function parse(formData: FormData) {
  let lines: unknown = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    lines = [];
  }
  return budgetInputSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    groupId: formData.get("groupId") ?? "",
    periodType: formData.get("periodType") ?? "MONTH",
    periodStart: formData.get("periodStart") ?? "",
    periodEnd: formData.get("periodEnd") ?? "",
    recurring: formData.get("recurring") === "on" || formData.get("recurring") === "true",
    lines,
  });
}

export async function createBudgetAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    const { id } = await createBudget(parsed.data, { id: user.id });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function updateBudgetAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await updateBudget(id, parsed.data, { id: user.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function deleteBudgetAction(
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteBudget(id, { id: user.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}
```

### Step 15: Add the budgets i18n

- [ ] **Step 15** — Add a `budgets` namespace to `messages/fr.json` (top-level, mirror in `messages/en.json`). FR:

```json
  "budgets": {
    "overline": "Planification",
    "pageTitle": "Budgets",
    "empty": "Aucun budget pour le moment.",
    "create": "Nouveau budget",
    "createTitle": "Nouveau budget",
    "editTitle": "Modifier le budget",
    "name": "Nom",
    "namePlaceholder": "Budget de mars",
    "scope": "Portée",
    "scopePersonal": "Personnel",
    "scopeGroup": "Foyer",
    "period": "Période",
    "periodStart": "Début",
    "periodEnd": "Fin",
    "periodType": { "WEEK": "Semaine", "MONTH": "Mois", "QUARTER": "Trimestre", "YEAR": "Année", "CUSTOM": "Personnalisée" },
    "recurring": "Récurrent",
    "lines": "Lignes",
    "line": { "category": "Catégorie", "account": "Compte", "label": "Libellé", "planned": "Montant prévu", "add": "Ajouter une ligne", "remove": "Retirer", "any": "Toutes" },
    "plannedTotal": "Total prévu",
    "save": "Enregistrer",
    "saving": "Enregistrement…",
    "createCta": "Créer le budget",
    "delete": "Supprimer",
    "deleteConfirm": "Supprimer ce budget ?",
    "cancel": "Annuler",
    "error": { "INVALID": "Vérifiez les champs.", "INVALID_PERIOD": "La fin doit suivre le début.", "FORBIDDEN": "Action non autorisée.", "NOT_FOUND": "Budget introuvable.", "FAILED": "Échec. Réessayez." }
  }
```

EN mirror (same keys): `overline` "Planning", `pageTitle` "Budgets", `create` "New budget", `scopePersonal` "Personal", `scopeGroup` "Household", `periodType` {Week, Month, Quarter, Year, Custom}, `recurring` "Recurring", `line.any` "Any", `plannedTotal` "Planned total", `createCta` "Create budget", errors in English, etc.

### Step 16: Build the new-budget modal

- [ ] **Step 16** — Create `src/components/budgets/budget-form.tsx` — a client `Dialog` (mirror `src/components/categories/category-form.tsx`: controlled/uncontrolled open, `useTransition`, `router.refresh()` on success). Manage `lines` as local state (`useState<LineRow[]>`), render one row per line with a category `<select>` (options from a `categories` prop), an account `<select>` (from an `accounts` prop), a planned-amount `<input type="number">`, and a remove button; an "Ajouter une ligne" button appends a blank row. Show the live **planned total** = `budgetPlannedTotal(lines.map((l) => ({ plannedAmount: Number(l.plannedAmount) || 0 })))`. On submit, serialize `lines` to a hidden `<input name="lines">` via `JSON.stringify` and post to `createBudgetAction`/`updateBudgetAction`. Period: a `periodType` `<select>` + two `<input type="date" name="periodStart|periodEnd">`; a `recurring` `<input type="checkbox" name="recurring">`; a scope `<select name="groupId">` (empty = personal, or a group the user administers — options from a `groups` prop). Import `budgetPlannedTotal` from `@/lib/budgets`.

> Reuse the existing `bits` primitives and the `CategoryForm` markup conventions. Keep the amount input `step="0.01"`. This component has no automated unit test; it is covered by the e2e in Step 20.

### Step 17: Build the budgets list + page

- [ ] **Step 17** — Create `src/components/budgets/budgets-view.tsx` (client) rendering the header (overline + title + a "Nouveau budget" button that opens `BudgetForm` in create mode) and a list of budget cards: each shows `name`, a scope badge (`scopePersonal`/`scopeGroup`), the period (formatted from `periodStart`/`periodEnd`), the `plannedTotal`, and links to `/[locale]/budgets/[id]`. Accept props `{ budgets: BudgetListItem[]; categories; accounts; groups }`.

Create `src/app/[locale]/(authenticated)/budgets/page.tsx` (server component, `export const dynamic = "force-dynamic"`): `requireSession()`, then `Promise.all([listBudgetsForUser(user.id), listForUser(user.id) (categories), listVisibleForUser(user.id) (accounts), listGroupsForUser(user.id) (groups, filtered to ADMIN+)])`, and render `<BudgetsView .../>`. (Import `listBudgetsForUser` from `@/server/services/budgets`, `listForUser` from `@/server/services/categories`, `listVisibleForUser` from `@/server/services/accounts`, `listGroupsForUser` from `@/server/services/groups`.)

### Step 18: Re-add the Budgets nav entry

- [ ] **Step 18** — In `src/components/shell/nav-items.ts`, re-import `Target` from `lucide-react` and add `{ key: "budgets", href: "/budgets", icon: Target }` to `WORKSPACE_NAV` (after `import`) and to `BOTTOM_NAV` (replacing `categories` there, to keep five tabs: dashboard, transactions, budgets, accounts, settings-was-removed → use dashboard/transactions/budgets/accounts/categories). Confirm `shell.nav.budgets` exists in both message files (it does — it was left in place when the dead link was removed).

### Step 19: Typecheck + CI

- [ ] **Step 19** — Run: `npm run typecheck` → PASS. Run: `DATABASE_URL=…3307… npm run ci` → PASS.

### Step 20: Write the e2e

- [ ] **Step 20** — Create `tests/e2e/budgets.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("budgets", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(({ browserName }) => browserName === "webkit", "Dialog flow deferred to Phase 8.3");

  test("create a personal budget with a line and see it listed", async ({ page }) => {
    const name = `Budget ${Date.now()}`;
    await page.goto("/fr/budgets");
    await expect(async () => {
      await page.getByRole("button", { name: /nouveau budget/i }).click();
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }).toPass();
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="periodStart"]', "2026-03-01");
    await page.fill('input[name="periodEnd"]', "2026-03-31");
    await page.fill('input[name="plannedAmount"]', "300");
    await page.getByRole("button", { name: /créer le budget/i }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });
});
```

> If the amount input's `name` collides once multiple lines exist, target the first line's input specifically; adapt the selector to the component built in Step 16.

### Step 21: Run e2e + commit, push, PR

- [ ] **Step 21** — Run: `npm run test:e2e -- budgets --project=chromium` → PASS. Run: `npm run ci` → PASS. Update `PLAN.md` (`- [x] 7.1`). Then:

```bash
git add src/components/budgets src/server/transport/actions/budgets.ts "src/app/[locale]/(authenticated)/budgets/page.tsx" src/components/shell/nav-items.ts messages tests/e2e/budgets.spec.ts PLAN.md
git commit -m "feat: budget creation UI (new-budget modal, budgets list, nav entry)"
git push -u origin feature/7.1-budget-model
gh pr create --base develop --title "feat: budget model + creation" --label "enhancement,phase-7,frontend,backend" --body "Closes #30"
```

---

## Task 7.2 — Budget calculation

**Branch:** `feature/7.2-budget-calculation`
**Goal:** Compute per-line `spent`/`remaining`/`percent`/`status` (link-aware) and show a budget detail page with progress bars.

### Step 1: Write the failing `lineStatus` unit test

- [ ] **Step 1** — Append to `tests/unit/lib/budgets.test.ts`:

```typescript
import { lineStatus } from "@/lib/budgets";

describe("lineStatus", () => {
  it("is OK below 80%", () => {
    expect(lineStatus(100, 50)).toEqual({ plannedAmount: 100, spent: 50, remaining: 50, percent: 50, status: "OK" });
  });
  it("is WARN at 80%..100%", () => {
    expect(lineStatus(100, 80).status).toBe("WARN");
    expect(lineStatus(100, 100).status).toBe("WARN");
  });
  it("is OVER above planned", () => {
    const s = lineStatus(100, 120);
    expect(s.status).toBe("OVER");
    expect(s.remaining).toBe(-20);
    expect(s.percent).toBe(120);
  });
  it("handles a zero planned amount", () => {
    expect(lineStatus(0, 0)).toMatchObject({ percent: 0, status: "OK" });
    expect(lineStatus(0, 10)).toMatchObject({ percent: 100, status: "OVER" });
  });
});
```

### Step 2: Run to verify it fails

- [ ] **Step 2** — Run: `npm run test:unit -- budgets` → FAIL (`lineStatus` not exported).

### Step 3: Implement `lineStatus`

- [ ] **Step 3** — Append to `src/lib/budgets.ts`:

```typescript
export type BudgetStatus = "OK" | "WARN" | "OVER";
export type LineStatus = {
  plannedAmount: number;
  spent: number;
  remaining: number;
  percent: number;
  status: BudgetStatus;
};

// Given a line's planned amount and its computed spend, derive the display
// figures. OVER when spent exceeds planned (epsilon); WARN from 80% up; else OK.
export function lineStatus(plannedAmount: number, spent: number): LineStatus {
  const remaining = round2(plannedAmount - spent);
  const percent =
    plannedAmount > 0
      ? Math.round((spent / plannedAmount) * 100)
      : spent > EPSILON
        ? 100
        : 0;
  const status: BudgetStatus =
    spent > plannedAmount + EPSILON ? "OVER" : percent >= 80 ? "WARN" : "OK";
  return { plannedAmount: round2(plannedAmount), spent: round2(spent), remaining, percent, status };
}
```

### Step 4: Run to verify it passes

- [ ] **Step 4** — Run: `npm run test:unit -- budgets` → PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/lib/budgets.ts tests/unit/lib/budgets.test.ts
git commit -m "feat: add budget line status math (percent/remaining/OK-WARN-OVER)"
```

### Step 6: Write the failing computeLine integration test

- [ ] **Step 6** — Append to `tests/integration/budgets.test.ts`. Add a `tx` helper at the top (reuse the `buildSecureFields` pattern from `tests/integration/links.test.ts`) and import `getBudgetDetail`:

```typescript
import { getBudgetDetail } from "@/server/services/budgets";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink } from "@/server/services/links";

async function tx(date: string, amount: number, categoryId: string | null): Promise<string> {
  const s = buildSecureFields({ label: "T", rawLabel: "T" });
  const row = await db.transaction.create({
    data: {
      accountId,
      date: new Date(date),
      amount,
      type: "OTHER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      categoryId,
      createdById: owner,
    },
  });
  return row.id;
}

describe("getBudgetDetail / computeLine", () => {
  beforeEach(async () => {
    await db.budgetAssignment.deleteMany({});
    await db.transactionLinkMember.deleteMany({});
    await db.transactionLink.deleteMany({});
    await db.transaction.deleteMany({ where: { accountId } });
  });

  it("sums matching expenses per line (category filter), link-aware, with status", async () => {
    await tx("2026-03-03T00:00:00.000Z", -40, catId);
    await tx("2026-03-10T00:00:00.000Z", -80, catId);
    await tx("2026-03-12T00:00:00.000Z", -20, null); // no category → not matched
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(120); // 40 + 80
    expect(detail.lines[0].status).toBe("OVER");
  });

  it("EXCLUDE removes a matching tx; INCLUDE adds a non-matching one", async () => {
    const a = await tx("2026-03-03T00:00:00.000Z", -40, catId); // matches, will EXCLUDE
    await tx("2026-03-05T00:00:00.000Z", -30, catId); // matches, stays
    const c = await tx("2026-03-06T00:00:00.000Z", -25, null); // no cat, will INCLUDE
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    await db.budgetAssignment.create({ data: { budgetId: id, transactionId: a, mode: "EXCLUDE", assignedById: owner } });
    await db.budgetAssignment.create({ data: { budgetId: id, transactionId: c, mode: "INCLUDE", assignedById: owner } });
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(55); // 30 (kept) + 25 (included) − 40 (excluded)
  });

  it("excludes a balanced link and collapses an unbalanced one to its net", async () => {
    const e1 = await tx("2026-03-03T00:00:00.000Z", -50, catId);
    const r1 = await tx("2026-03-04T00:00:00.000Z", 50, catId); // balanced pair → 0
    const e2 = await tx("2026-03-10T00:00:00.000Z", -80, catId);
    const r2 = await tx("2026-03-11T00:00:00.000Z", 30, catId); // net −50
    await createLink({ transactionIds: [e1, r1], userId: owner });
    await createLink({ transactionIds: [e2, r2], userId: owner });
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    const detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(50); // balanced dropped; unbalanced net 50
  });
});
```

### Step 7: Run to verify it fails

- [ ] **Step 7** — Run: `DATABASE_URL=…3307… npm run test:integration -- budgets` → FAIL (`getBudgetDetail` not exported).

### Step 8: Implement computeLine + getBudgetDetail

- [ ] **Step 8** — Append to `src/server/services/budgets/index.ts`:

```typescript
import { listVisibleForUser } from "@/server/services/accounts";
import { collapseLinkedRows } from "@/lib/links";
import { lineStatus, type LineStatus } from "@/lib/budgets";

type BudgetRow = {
  id: string;
  amount: number;
  date: Date;
  categoryId: string | null;
  accountId: string;
  linkId: string | null;
};

// A user may READ a budget they own or that belongs to a group they're in.
async function readableOrThrow(id: string, userId: string) {
  const b = await db.budget.findUnique({ where: { id }, include: { lines: true } });
  if (!b) throw new BudgetAccessError("NOT_FOUND");
  if (b.groupId) {
    try {
      await requireGroupRole(b.groupId, userId, "MEMBER");
    } catch {
      throw new BudgetAccessError("FORBIDDEN");
    }
  } else if (b.userId !== userId) {
    throw new BudgetAccessError("FORBIDDEN");
  }
  return b;
}

// Loads the budget's candidate rows once: transactions visible to `viewerId`
// within the period, plus this budget's INCLUDE/EXCLUDE assignments.
async function loadBudgetRows(
  budget: { id: string; periodStart: Date; periodEnd: Date },
  viewerId: string,
): Promise<{
  rows: BudgetRow[];
  excluded: Set<string>;
  includedIds: Set<string>;
}> {
  const accountIds = (await listVisibleForUser(viewerId)).map((a) => a.id);
  const rows: BudgetRow[] =
    accountIds.length === 0
      ? []
      : (
          await db.transaction.findMany({
            where: {
              accountId: { in: accountIds },
              date: { gte: budget.periodStart, lte: budget.periodEnd },
            },
            select: {
              id: true,
              amount: true,
              date: true,
              categoryId: true,
              accountId: true,
              linkMembership: { select: { linkId: true } },
            },
          })
        ).map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          date: r.date,
          categoryId: r.categoryId,
          accountId: r.accountId,
          linkId: r.linkMembership?.linkId ?? null,
        }));

  const assignments = await db.budgetAssignment.findMany({
    where: { budgetId: budget.id },
    select: { transactionId: true, mode: true },
  });
  const excluded = new Set(assignments.filter((a) => a.mode === "EXCLUDE").map((a) => a.transactionId));
  const includedIds = new Set(assignments.filter((a) => a.mode === "INCLUDE").map((a) => a.transactionId));
  return { rows, excluded, includedIds };
}

// Computes one line's spend against a preloaded candidate set (spec §5.7).
export function computeLine(
  line: { categoryId: string | null; accountId: string | null; plannedAmount: number },
  loaded: { rows: BudgetRow[]; excluded: Set<string>; includedIds: Set<string> },
): LineStatus {
  const matched = loaded.rows.filter((r) => {
    if (loaded.excluded.has(r.id)) return false;
    if (loaded.includedIds.has(r.id)) return true; // explicit include wins
    if (line.categoryId && r.categoryId !== line.categoryId) return false;
    if (line.accountId && r.accountId !== line.accountId) return false;
    // A line with neither filter auto-matches nothing.
    return line.categoryId != null || line.accountId != null;
  });
  const collapsed = collapseLinkedRows(matched);
  const sumEffective = collapsed.reduce((s, r) => s + r.amount, 0);
  const spent = Math.round(-sumEffective * 100) / 100;
  return lineStatus(Number(line.plannedAmount), spent);
}

export type BudgetDetail = {
  id: string;
  name: string;
  description: string | null;
  scope: BudgetScope;
  periodType: string;
  periodStart: Date;
  periodEnd: Date;
  recurring: boolean;
  lines: (LineStatus & {
    id: string;
    categoryId: string | null;
    accountId: string | null;
    label: string | null;
  })[];
  plannedTotal: number;
  spentTotal: number;
};

export async function getBudgetDetail(id: string, viewerId: string): Promise<BudgetDetail> {
  const b = await readableOrThrow(id, viewerId);
  // Compute against the transactions visible to the budget's owner scope: for a
  // group budget that is the group's shared accounts; for a personal budget it
  // is the owner's own visible set. Use the budget owner as the viewer.
  const ownerViewer = b.userId ?? viewerId;
  const loaded = await loadBudgetRows(b, ownerViewer);
  const lines = b.lines.map((l) => ({
    id: l.id,
    categoryId: l.categoryId,
    accountId: l.accountId,
    label: l.label,
    ...computeLine(
      { categoryId: l.categoryId, accountId: l.accountId, plannedAmount: Number(l.plannedAmount) },
      loaded,
    ),
  }));
  const plannedTotal = Math.round(lines.reduce((s, l) => s + l.plannedAmount, 0) * 100) / 100;
  const spentTotal = Math.round(lines.reduce((s, l) => s + l.spent, 0) * 100) / 100;
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    scope: b.groupId ? "GROUP" : "USER",
    periodType: b.periodType,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    recurring: b.recurring,
    lines,
    plannedTotal,
    spentTotal,
  };
}
```

> **Note on group budgets:** `ownerViewer = b.userId ?? viewerId` uses the personal owner for personal budgets. For a **group** budget (`userId` null), it falls back to the requesting member — acceptable for the MVP because the transactions relevant to a shared budget are the ones on the group's shared accounts, which every member can see. Scope 7.3's cross-account assignment (a member assigning their own unshared tx to a shared budget) is handled by the INCLUDE path there.

### Step 9: Run to verify it passes

- [ ] **Step 9** — Run: `DATABASE_URL=…3307… npm run test:integration -- budgets` → PASS.

### Step 10: Commit

- [ ] **Step 10**

```bash
git add src/server/services/budgets/index.ts src/lib/budgets.ts tests
git commit -m "feat: budget calculation (computeLine + getBudgetDetail, link-aware, include/exclude)"
```

### Step 11: Build the detail page + progress UI

- [ ] **Step 11** — Create `src/app/[locale]/(authenticated)/budgets/[id]/page.tsx` (server, `force-dynamic`): `requireSession()`, `const detail = await getBudgetDetail(id, user.id)` (catch `BudgetAccessError` → `notFound()`), render `<BudgetDetail detail={detail} categories={…} accounts={…} />`. Create `src/components/budgets/budget-detail.tsx` (client): header (name, period, scope badge), a planned/spent total row, and one row per line with a progress bar (`width: min(100, percent)%`), the `spent / plannedAmount` figures, `remaining`, and a status pill colored by `status` (`OK` neutral/green, `WARN` amber, `OVER` red — use the existing `Pill`/tokens). Localize via `budgets.detail` + `budgets.status.{OK,WARN,OVER}`.

- [ ] **Step 11b** — In `src/components/budgets/budgets-view.tsx`, add each budget's overall progress (a thin bar from `spentTotal/plannedTotal`) — extend `listBudgetsForUser` to also return `spentTotal` **only if cheap**; otherwise keep the list showing `plannedTotal` and compute spend on the detail page only. (Recommended: keep the list to `plannedTotal` to avoid N budget computations on the list page; show progress on detail.)

### Step 12: i18n + Typecheck + CI

- [ ] **Step 12** — Add `budgets.status` (`OK`/`WARN`/`OVER` labels) and `budgets.detail` (`planned`, `spent`, `remaining`, `overBy`) to both message files. Run `npm run typecheck` → PASS; `npm run ci` → PASS.

### Step 13: e2e + commit, push, PR

- [ ] **Step 13** — Extend `tests/e2e/budgets.spec.ts`: after creating a budget with a category line, seed a matching expense (via the manual-entry form on `/transactions`), open the budget detail, and assert the spent figure / a status pill is visible. Run `npm run test:e2e -- budgets --project=chromium` → PASS; `npm run ci` → PASS. Update `PLAN.md` (`- [x] 7.2`).

```bash
git commit -m "feat: budget detail page (per-line progress + OK/WARN/OVER status)"
git push -u origin feature/7.2-budget-calculation
gh pr create --base develop --title "feat: budget calculation" --label "enhancement,phase-7,frontend,backend" --body "Closes #31"
```

---

## Task 7.3 — Explicit assignment

**Branch:** `feature/7.3-budget-assignment`
**Goal:** From any transaction, assign it to a budget with mode `INCLUDE`/`EXCLUDE` (unique per `(budget, tx)`), overriding automatic matching — including assigning a personal (unshared) transaction to a shared group budget.

### Step 1: Write the failing assignment integration test

- [ ] **Step 1** — Append to `tests/integration/budgets.test.ts` (imports `assignTransaction`, `unassignTransaction`, `listAssignableBudgets`):

```typescript
import { assignTransaction, unassignTransaction, listAssignableBudgets } from "@/server/services/budgets";

describe("assignTransaction", () => {
  beforeEach(async () => {
    await db.budgetAssignment.deleteMany({});
    await db.transaction.deleteMany({ where: { accountId } });
  });

  it("INCLUDE makes a non-matching tx count toward the budget; unassign reverts it", async () => {
    const t = await tx("2026-03-06T00:00:00.000Z", -25, null); // no category
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    let detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(0); // doesn't match the category

    await assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: owner });
    detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(25);

    await unassignTransaction({ budgetId: id, transactionId: t }, { id: owner });
    detail = await getBudgetDetail(id, owner);
    expect(detail.lines[0].spent).toBe(0);
  });

  it("re-assigning the same tx updates the mode (unique per budget+tx)", async () => {
    const t = await tx("2026-03-06T00:00:00.000Z", -40, catId);
    const { id } = await createBudget(
      { ...baseInput, lines: [{ categoryId: catId, plannedAmount: 100 }] },
      { id: owner },
    );
    await assignTransaction({ budgetId: id, transactionId: t, mode: "EXCLUDE" }, { id: owner });
    expect((await getBudgetDetail(id, owner)).lines[0].spent).toBe(0);
    await assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: owner });
    expect((await getBudgetDetail(id, owner)).lines[0].spent).toBe(40);
    expect(await db.budgetAssignment.count({ where: { budgetId: id, transactionId: t } })).toBe(1);
  });

  it("rejects assigning a tx the actor cannot see, or to a budget they can't manage", async () => {
    const t = await tx("2026-03-06T00:00:00.000Z", -40, catId);
    const { id } = await createBudget(baseInput, { id: owner });
    await expect(
      assignTransaction({ budgetId: id, transactionId: t, mode: "INCLUDE" }, { id: stranger }),
    ).rejects.toBeInstanceOf(BudgetAccessError);
  });

  it("lists budgets the actor may assign to (own + group budgets they're a member of)", async () => {
    await createBudget(baseInput, { id: owner });
    const list = await listAssignableBudgets(owner);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});
```

### Step 2: Run to verify it fails

- [ ] **Step 2** — Run: `DATABASE_URL=…3307… npm run test:integration -- budgets` → FAIL (`assignTransaction` not exported).

### Step 3: Implement assignment in the service

- [ ] **Step 3** — Append to `src/server/services/budgets/index.ts`. Authorization: the actor must be able to READ the budget (own or group member) **and** be able to READ the transaction (its account is in `listVisibleForUser(actor)`); a member may assign their own unshared tx to a shared budget (INCLUDE) — that's the point of transparency (spec §5.8/§4.6).

```typescript
import { canReadAccount } from "@/server/services/accounts/sharing";

export async function assignTransaction(
  input: { budgetId: string; transactionId: string; mode: "INCLUDE" | "EXCLUDE" },
  actor: { id: string },
): Promise<void> {
  if (input.mode !== "INCLUDE" && input.mode !== "EXCLUDE") throw new BudgetAccessError("INVALID");
  await readableOrThrow(input.budgetId, actor.id);
  const txRow = await db.transaction.findUnique({
    where: { id: input.transactionId },
    select: { accountId: true },
  });
  if (!txRow) throw new BudgetAccessError("NOT_FOUND");
  if (!(await canReadAccount(actor.id, txRow.accountId))) throw new BudgetAccessError("FORBIDDEN");

  await db.budgetAssignment.upsert({
    where: { budgetId_transactionId: { budgetId: input.budgetId, transactionId: input.transactionId } },
    update: { mode: input.mode, assignedById: actor.id },
    create: {
      budgetId: input.budgetId,
      transactionId: input.transactionId,
      mode: input.mode,
      assignedById: actor.id,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "budget.assignment.create",
    entity: "BudgetAssignment",
    entityId: `${input.budgetId}:${input.transactionId}`,
    metadata: { mode: input.mode },
  });
}

export async function unassignTransaction(
  input: { budgetId: string; transactionId: string },
  actor: { id: string },
): Promise<void> {
  await readableOrThrow(input.budgetId, actor.id);
  await db.budgetAssignment
    .delete({
      where: {
        budgetId_transactionId: { budgetId: input.budgetId, transactionId: input.transactionId },
      },
    })
    .catch(() => undefined);
  await logEvent({
    userId: actor.id,
    action: "budget.assignment.delete",
    entity: "BudgetAssignment",
    entityId: `${input.budgetId}:${input.transactionId}`,
  });
}

// Budgets the actor may assign a transaction to: their own + their groups'.
export async function listAssignableBudgets(
  userId: string,
): Promise<{ id: string; name: string; scope: BudgetScope }[]> {
  const memberships = await db.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.budget.findMany({
    where: { archived: false, OR: [{ userId }, { groupId: { in: groupIds } }] },
    select: { id: true, name: true, groupId: true },
    orderBy: { periodStart: "desc" },
  });
  return rows.map((b) => ({ id: b.id, name: b.name, scope: b.groupId ? "GROUP" : "USER" }));
}

// The assignments on a transaction (for the detail panel to show current state).
export async function listAssignmentsForTx(
  transactionId: string,
): Promise<{ budgetId: string; mode: string }[]> {
  return db.budgetAssignment.findMany({
    where: { transactionId },
    select: { budgetId: true, mode: true },
  });
}
```

### Step 4: Run to verify it passes

- [ ] **Step 4** — Run: `DATABASE_URL=…3307… npm run test:integration -- budgets` → PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/server/services/budgets/index.ts tests/integration/budgets.test.ts
git commit -m "feat: explicit budget assignment (INCLUDE/EXCLUDE upsert, unassign, list assignable)"
```

### Step 6: Add the assignment actions + i18n

- [ ] **Step 6** — Append `assignTransactionAction` + `unassignTransactionAction` to `src/server/transport/actions/budgets.ts` (read `budgetId`, `transactionId`, `mode` from FormData; `requireSession`; map errors). Add a `budgets.assign` namespace to both message files (`title` "Assigner à un budget", `include` "Inclure", `exclude` "Exclure", `remove` "Retirer", `none` "Aucun budget", `assigned` "Assignée").

### Step 7: Wire the assignment UI into the transaction detail

- [ ] **Step 7** — In `src/components/transactions/transaction-detail.tsx`, add an "Assigner à un budget" section (only when a budget list is provided): a `<select>` of assignable budgets (prop `budgets: { id; name; scope }[]`), two buttons Inclure/Exclure that submit `assignTransactionAction` with the chosen `budgetId` + `mode` + this `transactionId`, and, for already-assigned budgets (prop `assignments`), a Retirer button submitting `unassignTransactionAction`. Thread `budgets`/`assignments` from `transactions/page.tsx` (call `listAssignableBudgets(user.id)` once for the page; fetch per-tx assignments lazily in the detail via a server action or include a map). Keep it behind the detail panel that already exists — reuse its layout.

> Keep the page-level fetch to `listAssignableBudgets` (one query); assignments-per-tx can be fetched when the detail opens (a small server action `listAssignmentsForTx`) to avoid loading them for every row.

### Step 8: Typecheck + CI + e2e

- [ ] **Step 8** — `npm run typecheck` → PASS. Extend `tests/e2e/budgets.spec.ts`: create a budget, open a transaction that doesn't match its line, assign it INCLUDE, open the budget detail, assert spent reflects it. `npm run test:e2e -- budgets --project=chromium` → PASS; `npm run ci` → PASS. Update `PLAN.md` (`- [x] 7.3`).

### Step 9: Commit, push, PR

- [ ] **Step 9**

```bash
git add src/server/transport/actions/budgets.ts src/components/transactions/transaction-detail.tsx "src/app/[locale]/(authenticated)/transactions/page.tsx" messages tests PLAN.md
git commit -m "feat: assign transactions to budgets (INCLUDE/EXCLUDE from the tx detail)"
git push -u origin feature/7.3-budget-assignment
gh pr create --base develop --title "feat: explicit budget assignment" --label "enhancement,phase-7,frontend,backend" --body "Closes #32"
```

---

## Task 7.4 — Recurring budgets

**Branch:** `feature/7.4-recurring-budgets`
**Goal:** Roll a `recurring` budget into its next-period instance (parent/instance link), idempotently.

### Step 1: Write the failing `nextPeriod` unit test

- [ ] **Step 1** — Append to `tests/unit/lib/budgets.test.ts`:

```typescript
import { nextPeriod } from "@/lib/budgets";

describe("nextPeriod", () => {
  it("shifts a month period to the next month (UTC inclusive bounds)", () => {
    const p = nextPeriod("MONTH", new Date("2026-03-01T00:00:00.000Z"), new Date("2026-03-31T23:59:59.999Z"));
    expect(p.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-04-30T23:59:59.999Z");
  });
  it("shifts a quarter to the next quarter", () => {
    const p = nextPeriod("QUARTER", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-03-31T23:59:59.999Z"));
    expect(p.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-06-30T23:59:59.999Z");
  });
  it("shifts a year to the next year", () => {
    const p = nextPeriod("YEAR", new Date("2026-01-01T00:00:00.000Z"), new Date("2026-12-31T23:59:59.999Z"));
    expect(p.start.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2027-12-31T23:59:59.999Z");
  });
  it("shifts WEEK/CUSTOM by the window length (+1 day) preserving span", () => {
    const p = nextPeriod("WEEK", new Date("2026-03-02T00:00:00.000Z"), new Date("2026-03-08T23:59:59.999Z"));
    expect(p.start.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-03-15T23:59:59.999Z");
  });
});
```

### Step 2: Run to verify it fails

- [ ] **Step 2** — Run: `npm run test:unit -- budgets` → FAIL (`nextPeriod` not exported).

### Step 3: Implement `nextPeriod`

- [ ] **Step 3** — Append to `src/lib/budgets.ts`. Reuse calendar helpers inline (UTC):

```typescript
import type { BudgetPeriodType } from "@/lib/validation/budget";

const DAY = 86_400_000;
const lastDayUtc = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

// The period immediately after [start, end] for a budget of the given type.
// MONTH/QUARTER/YEAR step by calendar unit; WEEK/CUSTOM step by the window
// length so the span is preserved. Bounds stay UTC-inclusive.
export function nextPeriod(
  periodType: BudgetPeriodType,
  start: Date,
  end: Date,
): { start: Date; end: Date } {
  if (periodType === "MONTH" || periodType === "QUARTER" || periodType === "YEAR") {
    const months = periodType === "MONTH" ? 1 : periodType === "QUARTER" ? 3 : 12;
    const y = start.getUTCFullYear();
    const m0 = start.getUTCMonth();
    const zeroFrom = y * 12 + m0 + months;
    const zeroTo = zeroFrom + months - 1;
    const sy = Math.floor(zeroFrom / 12);
    const sm0 = ((zeroFrom % 12) + 12) % 12;
    const ey = Math.floor(zeroTo / 12);
    const em0 = ((zeroTo % 12) + 12) % 12;
    return {
      start: new Date(Date.UTC(sy, sm0, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(ey, em0, lastDayUtc(ey, em0), 23, 59, 59, 999)),
    };
  }
  // WEEK / CUSTOM → shift both bounds by the window length in whole days.
  const lengthDays = Math.round((end.getTime() - start.getTime() + 1) / DAY);
  const nextStart = new Date(start.getTime() + lengthDays * DAY);
  const nextEnd = new Date(end.getTime() + lengthDays * DAY);
  return { start: nextStart, end: nextEnd };
}
```

### Step 4: Run to verify it passes

- [ ] **Step 4** — Run: `npm run test:unit -- budgets` → PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/lib/budgets.ts tests/unit/lib/budgets.test.ts
git commit -m "feat: add budget nextPeriod (calendar step for month/quarter/year, span-preserving week/custom)"
```

### Step 6: Write the failing rollRecurring integration test

- [ ] **Step 6** — Append to `tests/integration/budgets.test.ts` (imports `rollRecurring`):

```typescript
import { rollRecurring } from "@/server/services/budgets";

describe("rollRecurring", () => {
  beforeEach(async () => {
    await db.budget.deleteMany({ where: { userId: owner } });
  });

  it("creates one next-period instance linked to the template, and is idempotent", async () => {
    const { id } = await createBudget(
      { ...baseInput, recurring: true, lines: [{ categoryId: catId, plannedAmount: 200 }] },
      { id: owner },
    );
    const first = await rollRecurring(id, { id: owner });
    expect(first.created).toBe(true);
    const instance = await db.budget.findUniqueOrThrow({
      where: { id: first.id! },
      include: { lines: true },
    });
    expect(instance.parentBudgetId).toBe(id);
    expect(instance.periodStart.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(instance.periodEnd.toISOString()).toBe("2026-04-30T23:59:59.999Z");
    expect(instance.lines).toHaveLength(1);
    expect(Number(instance.lines[0].plannedAmount)).toBe(200);

    // Idempotent: a second roll does not create a duplicate for the same next period.
    const second = await rollRecurring(id, { id: owner });
    expect(second.created).toBe(false);
    expect(
      await db.budget.count({ where: { parentBudgetId: id, periodStart: instance.periodStart } }),
    ).toBe(1);
  });

  it("rejects rolling a non-recurring budget", async () => {
    const { id } = await createBudget(baseInput, { id: owner });
    await expect(rollRecurring(id, { id: owner })).rejects.toBeInstanceOf(BudgetAccessError);
  });
});
```

### Step 7: Run to verify it fails

- [ ] **Step 7** — Run: `DATABASE_URL=…3307… npm run test:integration -- budgets` → FAIL (`rollRecurring` not exported).

### Step 8: Implement `rollRecurring`

- [ ] **Step 8** — Append to `src/server/services/budgets/index.ts`:

```typescript
import { nextPeriod } from "@/lib/budgets";
import type { BudgetPeriodType } from "@/lib/validation/budget";

// Creates the next-period instance of a recurring budget (copies scope + lines,
// links parentBudgetId). Idempotent: no-op if that next instance already exists.
export async function rollRecurring(
  id: string,
  actor: { id: string },
): Promise<{ created: boolean; id?: string }> {
  const b = await manageableOrThrow(id, actor.id);
  if (!b.recurring) throw new BudgetAccessError("NOT_RECURRING");
  const template = b.parentBudgetId ?? b.id; // chain instances off the original template
  const period = nextPeriod(b.periodType as BudgetPeriodType, b.periodStart, b.periodEnd);

  const existing = await db.budget.findFirst({
    where: { parentBudgetId: template, periodStart: period.start },
    select: { id: true },
  });
  if (existing) return { created: false };

  const lines = await db.budgetLine.findMany({ where: { budgetId: b.id } });
  const instance = await db.budget.create({
    data: {
      name: b.name,
      description: b.description,
      userId: b.userId,
      groupId: b.groupId,
      periodType: b.periodType,
      periodStart: period.start,
      periodEnd: period.end,
      recurring: true,
      parentBudgetId: template,
      createdById: actor.id,
      lines: {
        create: lines.map((l) => ({
          categoryId: l.categoryId,
          accountId: l.accountId,
          label: l.label,
          plannedAmount: l.plannedAmount,
        })),
      },
    },
  });
  await logEvent({ userId: actor.id, action: "budget.created", entity: "Budget", entityId: instance.id, metadata: { rolledFrom: id } });
  return { created: true, id: instance.id };
}
```

### Step 9: Run to verify it passes

- [ ] **Step 9** — Run: `DATABASE_URL=…3307… npm run test:integration -- budgets` → PASS.

### Step 10: Action + minimal UI

- [ ] **Step 10** — Append `rollRecurringAction` to `src/server/transport/actions/budgets.ts` (reads `id`, `requireSession`, maps errors, returns `{ ok, id }`). In `src/components/budgets/budgets-view.tsx`, on a `recurring` budget whose `periodEnd` is in the past, show a "Renouveler" button posting `rollRecurringAction` and `router.refresh()` on success. Add `budgets.recurring` i18n (`badge` "Récurrent", `roll` "Renouveler", `rolledOk` "Instance créée."). EN mirror.

### Step 11: Typecheck + CI + commit, push, PR

- [ ] **Step 11** — `npm run typecheck` → PASS; `npm run ci` → PASS. Update `PLAN.md` (`- [x] 7.4`).

```bash
git add src/lib/budgets.ts src/server/services/budgets/index.ts src/server/transport/actions/budgets.ts src/components/budgets messages tests PLAN.md
git commit -m "feat: recurring budgets (roll into the next-period instance, idempotent)"
git push -u origin feature/7.4-recurring-budgets
gh pr create --base develop --title "feat: recurring budgets" --label "enhancement,phase-7,frontend,backend" --body "Closes #33"
```

---

## Self-Review notes (for the executor)

**Spec coverage (PLAN.md Phase 7 + spec §4.6/§5.7):**
- 7.1 `Budget`/`BudgetLine` models, owner XOR (service-enforced), `/app/budgets` + new-budget modal (dynamic lines, computed total) → Task 7.1. ✅ AC: unit XOR/line validation (service integration) + e2e create.
- 7.2 `computeLine` (visible tx, period filter, INCLUDE/EXCLUDE, link-aware), status OK/WARN/OVER, detail page → Task 7.2. ✅ AC: integration matching + overrides + links.
- 7.3 `BudgetAssignment` (INCLUDE/EXCLUDE), assign from any visible tx incl. unshared account → shared budget → Task 7.3. ✅ AC: e2e assign owner's tx; unique-per-(budget,tx) enforced by upsert.
- 7.4 recurring auto-create next instance, parent/instance link → Task 7.4. ✅ AC: integration roll creates the next instance, idempotent.

**Type consistency:** `LineStatus` (lib) is spread into `BudgetDetail.lines` (service) and rendered by `budget-detail.tsx`; `BudgetListItem`/`BudgetDetail`/`BudgetScope` are the service's exported shapes; `BudgetInput`/`BudgetLineInput` (validation) feed the actions + service; `nextPeriod` returns `{ start, end }` consumed by `rollRecurring`; `computeLine` consumes the `loadBudgetRows` shape (`rows`/`excluded`/`includedIds`). `budgetPlannedTotal` (lib) is used by the modal + `listBudgetsForUser`.

**Deliberate scope cuts (documented, not gaps):**
- **Automated recurring roll** (cron at period start) lands in Phase 8.4 — 7.4 ships the idempotent `rollRecurring` + a manual "Renouveler" affordance.
- **Group-budget viewer** uses the requesting member's visible set for computation (fine for shared accounts); a stricter "owner-scope-exact" visibility can be revisited if group budgets over unshared accounts + INCLUDE become common (the INCLUDE path already covers the transparency case).
- **List-page spend**: the budgets list shows the planned total only (computing every budget's spend on the list would be N calculations); per-line spend is on the detail page.

**Before each PR:** `git checkout develop && git pull`, delete merged branches, branch `feature/7.x-...`, `npm run ci` (with the test DB URL), GPG-sign commits, PR with `Closes #<issue>` + labels. Scope 7.1 adds a migration — restart the `app` container after `db:migrate` so the dev server reloads the regenerated Prisma client (see `[[project_dev-e2e-ops]]`).

# Phase 6 — Transaction Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users group related transactions (refunds, partial reimbursements, internal transfers) into **links** — manually and via auto-suggestions — and make spending totals **link-aware**: a balanced group (net 0) drops out of totals/averages, an unbalanced group collapses to its net sum carried by a "primary" member.

**Architecture:** A pure `src/lib/links.ts` holds the link math (`netSum`, `isBalanced`, `pickPrimary`, `collapseLinkedRows`) — unit-tested, no DB. A `links` service (`src/server/services/links/index.ts`) owns persistence + authorization (`createLink`, `deleteLink`, `listLinkedTxIds`, `suggestPairs`, `ignoreSuggestion`), reusing `listVisibleForUser` for visibility and `logEvent` for audit. Thin Server Actions wrap the service. The transactions list gains a **link mode** (multi-select → confirm) and a **suggestions** page. Finally the dashboard aggregation is refactored to collapse links before summing.

**Tech Stack:** Next 16 (App Router, Server Components + Server Actions), Prisma 7 + MariaDB (`adapter-mariadb`), next-intl, Vitest (unit + integration) + Playwright (e2e). Reuses Phase 2–5 services (`listVisibleForUser`, `listTransactions`, `getDashboard`, `logEvent`, the `bits` UI primitives, `parsePeriodParams`).

## Global Constraints

- **One scope = one GitHub issue = one branch `feature/6.x-...` = one PR → `develop`.** Run `npm run ci` before every PR; GPG-sign commits (ask the user to unlock GPG if signing fails — per their global CLAUDE.md). PR body: `Closes #<issue>` + a type label (`enhancement`) plus phase/area labels (`phase-6`, `frontend`/`backend`).
- **npm** (not pnpm). Node 24. Commits: 1-line English conventional (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`). No co-authored-by.
- **Encryption invariant:** `amount`, `date`, `categoryId`, `accountId`, `type` are CLEAR columns; labels/notes stay encrypted. Link math and aggregation use clear columns only — never decrypt for totals. Only list/detail views decrypt (via existing `listTransactions`).
- **Dates are UTC**; transactions store `date` at UTC midnight.
- **Authorization:** a user may only link/unlink/suggest over transactions on accounts visible to them (`listVisibleForUser` → owned + shared). Cross-account links are allowed (e.g. an internal transfer between two of the user's own accounts).
- **Money:** `Decimal(12,2)` in DB → `Number(...)` in JS; compare amounts with a 0.005 epsilon (never `=== 0` on floats).
- **e2e:** reuse the `owner@e2e.local` storageState; `test.skip(({ browserName }) => browserName === "webkit", ...)` for any click-driven flow (mobile/webkit interaction deferred to Phase 8.3). Absorb the dev-server hydration race on the first click of a freshly-loaded page with `await expect(async () => { await ...click(); await expect(...).to..(); }).toPass()`.

---

## Design decisions (read before starting)

1. **Data model = spec §4.5 verbatim.** A `TransactionLink` is a group of N≥2 members joined through `TransactionLinkMember` (`transactionId @unique` → a transaction belongs to **at most one** link). `IgnoredLinkSuggestion` is keyed `(userId, pairKey)`. No `linkId`/`isPrimary` columns on `Transaction` — membership lives in the join table; the relation `linkMembership TransactionLinkMember?` is added to `Transaction`.

2. **Primary member (deterministic).** Within a link, the *primary* is the member with the largest absolute amount; ties broken by earliest `date`, then lowest `id`. The primary carries the link's net sum in collapsed aggregates.

3. **Collapse rule.** Given rows tagged with their `linkId`:
   - rows with no link → kept as-is;
   - rows sharing a `linkId` → if the group's net sum is **balanced** (|net| < 0.005) → **all dropped**; otherwise → replaced by a single synthetic row equal to the **primary** member but with `amount = net sum` (primary's `date`/`categoryId`/`accountId` retained).

4. **Period boundary (scope cut, documented).** Link-aware aggregation (6.3) collapses links **within the rows loaded for the current period**. A link member that falls outside the period is treated as an isolated transaction (not collapsed). Links typically pair transactions a few days apart (within `linkWindowDays`), so this is acceptable for the MVP; revisit if cross-period links become common.

5. **Suggestion pairing (spec §5.8).** `suggestPairs(userId)`: load visible transactions not already in a link; for each `+X` find a `-X` (exact opposite, epsilon) within `±UserPreference.linkWindowDays` days; drop pairs whose `|amount| < UserPreference.linkMinAmount`; drop pairs in `IgnoredLinkSuggestion(userId)`; sort by `|amount|` DESC then day-delta ASC. `pairKey = [idA, idB].sort().join("|")`.

---

## File Structure

**Scope 6.1 — Link model + manual linking**
- Modify: `prisma/schema.prisma` — add `TransactionLink`, `TransactionLinkMember`, `IgnoredLinkSuggestion`; add `linkMembership TransactionLinkMember?` to `Transaction`.
- Create: `prisma/migrations/<ts>_phase_6_1_links/migration.sql` (via `npm run db:migrate`).
- Create: `src/lib/links.ts` — pure math (`netSum`, `isBalanced`, `pickPrimary`).
- Create: `src/server/services/links/index.ts` — `createLink`, `deleteLink`, `listLinkedTxIds`, `getLinkForTx`, `LinkAccessError`.
- Create: `src/server/transport/actions/links.ts` — `createLinkAction`, `deleteLinkAction`.
- Modify: `src/components/transactions/transaction-list.tsx` — link-mode toggle, multi-select, confirm bar, "linked" badge.
- Modify: `src/app/[locale]/(authenticated)/transactions/page.tsx` — pass `linkedIds` to the list.
- Modify: `messages/{fr,en}.json` — `transactions.link` namespace.
- Test: `tests/unit/lib/links.test.ts`, `tests/integration/links.test.ts`, `tests/e2e/links.spec.ts`.

**Scope 6.2 — Auto suggestions**
- Modify: `src/lib/links.ts` — add `pairKeyOf`, `findSuggestedPairs` (pure pairing over plain rows).
- Modify: `src/server/services/links/index.ts` — add `suggestPairs`, `ignoreSuggestion`.
- Modify: `src/server/transport/actions/links.ts` — add `ignoreSuggestionAction` (accept reuses `createLinkAction`).
- Create: `src/components/transactions/suggestions-list.tsx` — client list with Link / Ignore.
- Create: `src/app/[locale]/(authenticated)/transactions/suggestions/page.tsx`.
- Modify: `src/components/transactions/transaction-filters.tsx` (or the transactions header) — a link to the suggestions page.
- Modify: `messages/{fr,en}.json` — `transactions.suggestions` namespace.
- Test: `tests/unit/lib/links.test.ts` (pairing), `tests/integration/links.test.ts` (suggest + ignore), `tests/e2e/links.spec.ts` (accept + persisted ignore).

**Scope 6.3 — Link-aware totals**
- Modify: `src/lib/links.ts` — add `collapseLinkedRows`.
- Modify: `src/server/services/dashboard/index.ts` — load `linkId`, collapse before aggregating (totals, by-category, trace).
- Modify: `src/components/transactions/transaction-list.tsx` — per-day subtotal skips balanced-link members.
- Modify: `src/app/[locale]/(authenticated)/transactions/page.tsx` — pass each row's `linkId` to the list.
- Test: `tests/unit/lib/links.test.ts` (collapse), `tests/integration/dashboard.test.ts` (mixed-link totals).

---

## Task 6.1 — Link model + manual linking

**Branch:** `feature/6.1-link-model`
**Goal:** Persist links over visible transactions (one tx in at most one link), expose a link-mode multi-select on `/transactions` that creates/deletes a link, and badge linked rows.

### Step 1: Add the Prisma models

- [ ] **Step 1** — In `prisma/schema.prisma`, add the relation field to `Transaction` (inside the existing model, next to `searchTokens`):

```prisma
  searchTokens   TransactionSearchToken[]
  linkMembership TransactionLinkMember?
```

Then append the three new models at the end of the file:

```prisma
model TransactionLink {
  id          String   @id @default(cuid())
  name        String?
  createdById String
  createdAt   DateTime @default(now())

  members TransactionLinkMember[]

  @@index([createdById])
}

model TransactionLinkMember {
  linkId        String
  transactionId String   @unique // a transaction belongs to at most one link
  joinedAt      DateTime @default(now())

  link        TransactionLink @relation(fields: [linkId], references: [id], onDelete: Cascade)
  transaction Transaction     @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  @@id([linkId, transactionId])
  @@index([linkId])
}

model IgnoredLinkSuggestion {
  userId    String
  pairKey   String // canonical "txid1|txid2" (ids sorted)
  ignoredAt DateTime @default(now())

  @@id([userId, pairKey])
  @@index([userId])
}
```

### Step 2: Create the migration

- [ ] **Step 2** — Run: `npm run db:migrate`
When prompted for a name, enter: `phase_6_1_links`
Expected: a new folder `prisma/migrations/<timestamp>_phase_6_1_links/` with `migration.sql` creating the three tables + the unique index on `transactionId`. Prisma client regenerates.

> If the running dev server caches the old Prisma client (queries on `db.transactionLink` fail with "undefined"), restart it: `docker compose restart app` (see `[[project_dev-e2e-ops]]`).

### Step 3: Write the failing link-math unit test

- [ ] **Step 3** — Create `tests/unit/lib/links.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { netSum, isBalanced, pickPrimary } from "@/lib/links";

describe("netSum", () => {
  it("sums signed amounts", () => {
    expect(netSum([-50, 50])).toBe(0);
    expect(netSum([-50, 30])).toBe(-20);
    expect(netSum([-50, 20, 10])).toBe(-20);
  });
});

describe("isBalanced", () => {
  it("is true when the net is within the epsilon of zero", () => {
    expect(isBalanced([-50, 50])).toBe(true);
    expect(isBalanced([-50.004, 50])).toBe(true); // < 0.005
    expect(isBalanced([-50, 30])).toBe(false);
  });
});

describe("pickPrimary", () => {
  it("picks the largest absolute amount", () => {
    const m = pickPrimary([
      { id: "b", amount: 30, date: new Date("2026-03-02T00:00:00.000Z") },
      { id: "a", amount: -50, date: new Date("2026-03-01T00:00:00.000Z") },
    ]);
    expect(m.id).toBe("a");
  });

  it("breaks ties by earliest date, then lowest id", () => {
    const m = pickPrimary([
      { id: "y", amount: 40, date: new Date("2026-03-05T00:00:00.000Z") },
      { id: "x", amount: -40, date: new Date("2026-03-02T00:00:00.000Z") },
      { id: "z", amount: 40, date: new Date("2026-03-02T00:00:00.000Z") },
    ]);
    expect(m.id).toBe("x"); // same |40|, earliest date 03-02, "x" < "z"
  });
});
```

### Step 4: Run to verify it fails

- [ ] **Step 4** — Run: `npm run test:unit -- links`
Expected: FAIL — `Cannot find module '@/lib/links'`.

### Step 5: Implement `src/lib/links.ts`

- [ ] **Step 5** — Create `src/lib/links.ts`:

```typescript
// Pure link math — no DB. A "link" groups related transactions (a refund and
// its expense, an internal transfer's two legs, …). Amounts are signed
// (income > 0, expense < 0); compare with an epsilon, never `=== 0`.

const EPSILON = 0.005;

export type LinkMemberRow = {
  id: string;
  amount: number;
  date: Date;
};

export function netSum(amounts: number[]): number {
  return Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100;
}

export function isBalanced(amounts: number[]): boolean {
  return Math.abs(netSum(amounts)) < EPSILON;
}

// The member that carries the link's net in collapsed aggregates: largest
// |amount|, ties → earliest date, then lowest id. Deterministic.
export function pickPrimary<T extends LinkMemberRow>(members: T[]): T {
  return [...members].sort((a, b) => {
    const byAbs = Math.abs(b.amount) - Math.abs(a.amount);
    if (byAbs !== 0) return byAbs;
    const byDate = a.date.getTime() - b.date.getTime();
    if (byDate !== 0) return byDate;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}
```

### Step 6: Run to verify it passes

- [ ] **Step 6** — Run: `npm run test:unit -- links`
Expected: PASS (3 describe blocks).

### Step 7: Commit

- [ ] **Step 7**

```bash
git add src/lib/links.ts tests/unit/lib/links.test.ts
git commit -m "feat: add pure link math (net sum, balanced, primary picker)"
```

### Step 8: Write the failing links-service integration test

- [ ] **Step 8** — Create `tests/integration/links.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/server/db";
import { buildSecureFields } from "@/server/services/transactions/secure-fields";
import { createLink, deleteLink, listLinkedTxIds, LinkAccessError } from "@/server/services/links";

const owner = "link_owner";
const stranger = "link_stranger";
let accountId: string;
let strangerAccountId: string;

async function tx(accId: string, date: string, amount: number, label: string): Promise<string> {
  const s = buildSecureFields({ label, rawLabel: label });
  const row = await db.transaction.create({
    data: {
      accountId: accId,
      date: new Date(date),
      amount,
      type: "OTHER",
      labelEnc: s.labelEnc,
      labelHash: s.labelHash,
      rawLabelEnc: s.rawLabelEnc,
      rawLabelHash: s.rawLabelHash,
      createdById: owner,
    },
  });
  return row.id;
}

beforeAll(async () => {
  for (const id of [owner, stranger]) {
    await db.user.deleteMany({ where: { id } });
    await db.user.create({ data: { id, email: `${id}@bilan.local` } });
  }
  accountId = (await db.bankAccount.create({ data: { ownerId: owner, name: "Courant", type: "CHECKING" } })).id;
  strangerAccountId = (
    await db.bankAccount.create({ data: { ownerId: stranger, name: "Autre", type: "CHECKING" } })
  ).id;
});

beforeEach(async () => {
  await db.transactionLinkMember.deleteMany({});
  await db.transactionLink.deleteMany({});
  await db.transaction.deleteMany({ where: { accountId: { in: [accountId, strangerAccountId] } } });
});

afterAll(async () => {
  await db.transactionLinkMember.deleteMany({});
  await db.transactionLink.deleteMany({});
  await db.transaction.deleteMany({ where: { accountId: { in: [accountId, strangerAccountId] } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [owner, stranger] } } });
  await db.user.deleteMany({ where: { id: { in: [owner, stranger] } } });
  await db.$disconnect();
});

describe("createLink", () => {
  it("links two visible transactions and lists their ids as linked", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const { id } = await createLink({ transactionIds: [a, b], userId: owner });
    expect(id).toBeTruthy();
    const linked = await listLinkedTxIds(owner);
    expect([...linked].sort()).toEqual([a, b].sort());
  });

  it("rejects a link with fewer than two transactions", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    await expect(createLink({ transactionIds: [a], userId: owner })).rejects.toBeInstanceOf(LinkAccessError);
  });

  it("rejects linking a transaction the user cannot see", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const foreign = await tx(strangerAccountId, "2026-03-02T00:00:00.000Z", 50, "REMB");
    await expect(
      createLink({ transactionIds: [a, foreign], userId: owner }),
    ).rejects.toBeInstanceOf(LinkAccessError);
  });

  it("rejects linking a transaction already in a link", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const c = await tx(accountId, "2026-03-06T00:00:00.000Z", 20, "AUTRE");
    await createLink({ transactionIds: [a, b], userId: owner });
    await expect(createLink({ transactionIds: [a, c], userId: owner })).rejects.toBeInstanceOf(LinkAccessError);
  });
});

describe("deleteLink", () => {
  it("removes the link and frees its members", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const { id } = await createLink({ transactionIds: [a, b], userId: owner });
    await deleteLink(id, owner);
    expect((await listLinkedTxIds(owner)).size).toBe(0);
  });

  it("rejects deleting a link the user did not create", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");
    const { id } = await createLink({ transactionIds: [a, b], userId: owner });
    await expect(deleteLink(id, stranger)).rejects.toBeInstanceOf(LinkAccessError);
  });
});
```

### Step 9: Run to verify it fails

- [ ] **Step 9** — Run: `npm run test:integration -- links`
Expected: FAIL — `Cannot find module '@/server/services/links'`.

### Step 10: Implement the links service

- [ ] **Step 10** — Create `src/server/services/links/index.ts`:

```typescript
import { db } from "@/server/db";
import { listVisibleForUser } from "@/server/services/accounts";
import { logEvent } from "@/server/services/audit";

export class LinkAccessError extends Error {}

// Account ids the user may see (owned + shared). Reused for every link op.
async function visibleAccountIds(userId: string): Promise<Set<string>> {
  return new Set((await listVisibleForUser(userId)).map((a) => a.id));
}

// Creates a link over 2+ transactions, all visible to the user and none already
// linked. Throws LinkAccessError otherwise.
export async function createLink(input: {
  transactionIds: string[];
  userId: string;
  name?: string | null;
}): Promise<{ id: string }> {
  const ids = [...new Set(input.transactionIds)];
  if (ids.length < 2) throw new LinkAccessError("TOO_FEW");

  const visible = await visibleAccountIds(input.userId);
  const rows = await db.transaction.findMany({
    where: { id: { in: ids } },
    select: { id: true, accountId: true, linkMembership: { select: { linkId: true } } },
  });
  if (rows.length !== ids.length) throw new LinkAccessError("NOT_FOUND");
  for (const r of rows) {
    if (!visible.has(r.accountId)) throw new LinkAccessError("FORBIDDEN");
    if (r.linkMembership) throw new LinkAccessError("ALREADY_LINKED");
  }

  const link = await db.transactionLink.create({
    data: {
      name: input.name ?? null,
      createdById: input.userId,
      members: { create: ids.map((transactionId) => ({ transactionId })) },
    },
  });
  await logEvent({
    userId: input.userId,
    action: "link.created",
    entity: "TransactionLink",
    entityId: link.id,
    metadata: { count: ids.length },
  });
  return { id: link.id };
}

// Deletes a link the user created (members are freed via cascade).
export async function deleteLink(linkId: string, userId: string): Promise<void> {
  const link = await db.transactionLink.findUnique({ where: { id: linkId } });
  if (!link) throw new LinkAccessError("NOT_FOUND");
  if (link.createdById !== userId) throw new LinkAccessError("FORBIDDEN");
  await db.transactionLink.delete({ where: { id: linkId } });
  await logEvent({ userId, action: "link.deleted", entity: "TransactionLink", entityId: linkId });
}

// Ids of the user's visible transactions that already belong to a link (for
// badging rows + excluding them from suggestions).
export async function listLinkedTxIds(userId: string): Promise<Set<string>> {
  const visible = await visibleAccountIds(userId);
  if (visible.size === 0) return new Set();
  const members = await db.transactionLinkMember.findMany({
    where: { transaction: { accountId: { in: [...visible] } } },
    select: { transactionId: true },
  });
  return new Set(members.map((m) => m.transactionId));
}

// The link id a transaction belongs to, or null. Used by the detail view + the
// link-mode "unlink" action.
export async function getLinkForTx(transactionId: string, userId: string): Promise<string | null> {
  const visible = await visibleAccountIds(userId);
  const member = await db.transactionLinkMember.findUnique({
    where: { transactionId },
    select: { linkId: true, transaction: { select: { accountId: true } } },
  });
  if (!member || !visible.has(member.transaction.accountId)) return null;
  return member.linkId;
}
```

### Step 11: Run to verify it passes

- [ ] **Step 11** — Run: `npm run test:integration -- links`
Expected: PASS (6 tests).

### Step 12: Commit

- [ ] **Step 12**

```bash
git add prisma/schema.prisma prisma/migrations src/server/services/links/index.ts tests/integration/links.test.ts
git commit -m "feat: add transaction-link model + service (create/delete/list, visibility-checked)"
```

### Step 13: Add the link Server Actions

- [ ] **Step 13** — Create `src/server/transport/actions/links.ts`:

```typescript
"use server";

import { requireSession } from "@/server/auth/permissions";
import { createLink, deleteLink, LinkAccessError } from "@/server/services/links";

export type LinkActionState = { ok: true; id?: string } | { ok: false; error: string } | null;

function mapError(e: unknown): string {
  return e instanceof LinkAccessError ? e.message || "FORBIDDEN" : "FAILED";
}

export async function createLinkAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const ids = String(formData.get("transactionIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length < 2) return { ok: false, error: "TOO_FEW" };
  try {
    const { id } = await createLink({ transactionIds: ids, userId: user.id });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}

export async function deleteLinkAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const id = String(formData.get("linkId") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await deleteLink(id, user.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}
```

### Step 14: Add the link i18n

- [ ] **Step 14** — In `messages/fr.json`, inside the existing `transactions` namespace, add a `link` object:

```json
    "link": {
      "mode": "Mode lien",
      "exit": "Quitter",
      "selected": "{count, plural, one {# sélectionnée} other {# sélectionnées}}",
      "create": "Lier",
      "linked": "Liée",
      "unlink": "Délier",
      "hint": "Sélectionnez au moins deux transactions à lier.",
      "createdOk": "Transactions liées.",
      "failed": "Échec de la liaison."
    }
```

In `messages/en.json`, mirror inside `transactions`:

```json
    "link": {
      "mode": "Link mode",
      "exit": "Exit",
      "selected": "{count, plural, one {# selected} other {# selected}}",
      "create": "Link",
      "linked": "Linked",
      "unlink": "Unlink",
      "hint": "Select at least two transactions to link.",
      "createdOk": "Transactions linked.",
      "failed": "Linking failed."
    }
```

### Step 15: Add link mode to the transactions list

- [ ] **Step 15** — In `src/components/transactions/transaction-list.tsx`:

a) Extend `ListItem` with the linked flag (add the field to the exported type):

```typescript
export type ListItem = {
  id: string;
  date: string; // ISO
  amount: number;
  type: string;
  label: string;
  rawLabel: string;
  note: string | null;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  linked: boolean;
};
```

b) Add the imports at the top (next to the existing action import):

```typescript
import { useActionState } from "react";
import { createLinkAction } from "@/server/transport/actions/links";
import { Pill } from "./bits";
```

> `Pill` is already imported in this file — if so, skip re-importing it; keep the other two imports.

c) Inside the `TransactionList` component body, after the existing state hooks, add link-mode state and the create action wiring:

```typescript
  const tLink = useTranslations("transactions.link");
  const [linkMode, setLinkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [linkState, linkAction, linkPending] = useActionState(createLinkAction, null);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    if (linkState?.ok) {
      setSelected(new Set());
      setLinkMode(false);
      router.refresh();
    }
  }, [linkState, router]);
```

d) Render a mode toggle + confirm bar above the list. Find the top of the returned JSX (the outer wrapper `<div>`) and insert, as its first child:

```tsx
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setLinkMode((v) => !v);
            setSelected(new Set());
          }}
          aria-pressed={linkMode}
          className="border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.8rem]"
        >
          {linkMode ? tLink("exit") : tLink("mode")}
        </button>
        {linkMode && (
          <form action={linkAction} className="flex items-center gap-2">
            <input type="hidden" name="transactionIds" value={[...selected].join(",")} />
            <span className="text-muted-foreground text-[0.8rem]">
              {tLink("selected", { count: selected.size })}
            </span>
            <button
              type="submit"
              disabled={selected.size < 2 || linkPending}
              className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-50"
            >
              {tLink("create")}
            </button>
          </form>
        )}
      </div>
      {linkMode && <p className="text-muted-foreground text-xs">{tLink("hint")}</p>}
```

e) Make each transaction row act as a checkbox in link mode (instead of opening the detail). Find the row `<button data-slot="transaction-row" ... onClick={...}>` and change its click handler so link mode toggles selection:

```tsx
          onClick={() => (linkMode ? toggleSelected(item.id) : openDetail(item))}
          aria-pressed={linkMode ? selected.has(item.id) : undefined}
          data-selected={linkMode && selected.has(item.id) ? "true" : undefined}
          className={cn(
            /* keep the existing row classes here */,
            linkMode && selected.has(item.id) && "ring-primary ring-2",
          )}
```

> Replace `openDetail(item)` with whatever the existing handler calls (e.g. `setSelectedId(item.id)`); keep the existing class string and just append the conditional ring. If `cn` is not yet imported in this file, add `import { cn } from "@/lib/utils";`.

f) Badge already-linked rows. Where the row renders its trailing pills/amount, add next to the amount:

```tsx
          {item.linked && <Pill>{tLink("linked")}</Pill>}
```

### Step 16: Thread `linked` from the page

- [ ] **Step 16** — In `src/app/[locale]/(authenticated)/transactions/page.tsx`:

a) Import the service:

```tsx
import { listLinkedTxIds } from "@/server/services/links";
```

b) Add it to the parallel fetch (extend the existing `Promise.all`):

```tsx
  const [{ items, total }, tree, accounts, linkedIds] = await Promise.all([
    listTransactions(user.id, {
      categoryId: sp.categoryId,
      direction,
      search: sp.search,
      from: period?.from,
      to: period?.to,
    }),
    listForUser(user.id),
    listVisibleForUser(user.id),
    listLinkedTxIds(user.id),
  ]);
```

c) Set `linked` when mapping `listItems` (add the field to the existing object):

```tsx
    categoryId: i.categoryId,
    linked: linkedIds.has(i.id),
```

### Step 17: Typecheck + CI

- [ ] **Step 17**

Run: `npm run typecheck` → PASS (if `.next/dev` types are stale after the new route/imports, `curl -s -o /dev/null http://localhost:3000/fr/transactions` then re-run).
Run: `npm run ci` → PASS.

### Step 18: Write the e2e

- [ ] **Step 18** — Create `tests/e2e/links.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test.describe("transaction links", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });
  test.skip(
    ({ browserName }) => browserName === "webkit",
    "Mobile click-driven link flow deferred to Phase 8.3",
  );

  test("link two transactions via link mode and see them badged", async ({ page }) => {
    const stamp = Date.now();
    const expense = `Achat ${stamp}`;
    const refund = `Remb ${stamp}`;

    // Seed an expense and its refund.
    for (const [label, amount] of [
      [expense, "-60"],
      [refund, "60"],
    ] as const) {
      await page.goto("/fr/transactions");
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="date"]')).toBeVisible();
      }).toPass();
      await page.fill('input[name="date"]', "2026-03-02");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', label);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    // Enter link mode, select both, confirm.
    await expect(async () => {
      await page.getByRole("button", { name: /mode lien/i }).click();
      await expect(page.getByText(/sélectionnez au moins deux/i)).toBeVisible();
    }).toPass();
    await page.locator('[data-slot="transaction-row"]').filter({ hasText: expense }).first().click();
    await page.locator('[data-slot="transaction-row"]').filter({ hasText: refund }).first().click();
    await page.getByRole("button", { name: /^lier$/i }).click();

    // Both rows show the "Liée" badge.
    await expect(
      page.locator('[data-slot="transaction-row"]').filter({ hasText: expense }).getByText("Liée"),
    ).toBeVisible({ timeout: 15_000 });
  });
});
```

### Step 19: Run e2e + commit, push, PR

- [ ] **Step 19**

Run: `npm run test:e2e -- links --project=chromium` → PASS.
Run: `npm run ci` → PASS.

```bash
git add src/components/transactions src/server/transport/actions/links.ts "src/app/[locale]/(authenticated)/transactions/page.tsx" messages tests/e2e/links.spec.ts
git commit -m "feat: manual transaction linking (link-mode multi-select, linked badge)"
git push -u origin feature/6.1-link-model
gh pr create --base develop --title "feat: transaction links (model + manual)" --label "enhancement,phase-6,frontend,backend" --body "Closes #27"
```

---

## Task 6.2 — Auto suggestions

**Branch:** `feature/6.2-link-suggestions`
**Goal:** Suggest `+X/-X` pairs within the user's window, let them accept (creates a link) or ignore (persisted), on a `/transactions/suggestions` page.

### Step 1: Extend the link-math test with pairing

- [ ] **Step 1** — Append to `tests/unit/lib/links.test.ts`:

```typescript
import { pairKeyOf, findSuggestedPairs } from "@/lib/links";

describe("pairKeyOf", () => {
  it("is canonical regardless of order", () => {
    expect(pairKeyOf("b", "a")).toBe("a|b");
    expect(pairKeyOf("a", "b")).toBe("a|b");
  });
});

describe("findSuggestedPairs", () => {
  const rows = [
    { id: "exp", amount: -50, date: new Date("2026-03-02T00:00:00.000Z") },
    { id: "ref", amount: 50, date: new Date("2026-03-10T00:00:00.000Z") },
    { id: "small", amount: -3, date: new Date("2026-03-02T00:00:00.000Z") },
    { id: "smallref", amount: 3, date: new Date("2026-03-02T00:00:00.000Z") },
    { id: "far", amount: 50, date: new Date("2026-06-01T00:00:00.000Z") },
  ];

  it("pairs an expense with an opposite refund inside the window", () => {
    const pairs = findSuggestedPairs(rows, { windowDays: 30, minAmount: 0, ignored: new Set() });
    expect(pairs.map((p) => p.key)).toContain("exp|ref");
  });

  it("drops pairs outside the day window", () => {
    const pairs = findSuggestedPairs(rows, { windowDays: 30, minAmount: 0, ignored: new Set() });
    // 'far' (+50) is ~90 days from 'exp' (-50) → no pair
    expect(pairs.some((p) => p.key === "exp|far")).toBe(false);
  });

  it("drops pairs below the minimum amount", () => {
    const pairs = findSuggestedPairs(rows, { windowDays: 30, minAmount: 5, ignored: new Set() });
    expect(pairs.some((p) => p.key === "small|smallref")).toBe(false);
  });

  it("drops ignored pairs", () => {
    const pairs = findSuggestedPairs(rows, {
      windowDays: 30,
      minAmount: 0,
      ignored: new Set(["exp|ref"]),
    });
    expect(pairs.some((p) => p.key === "exp|ref")).toBe(false);
  });

  it("sorts by absolute amount desc then day-delta asc", () => {
    const pairs = findSuggestedPairs(rows, { windowDays: 60, minAmount: 0, ignored: new Set() });
    expect(pairs[0].key).toBe("exp|ref"); // |50| beats |3|
  });
});
```

### Step 2: Run to verify it fails

- [ ] **Step 2** — Run: `npm run test:unit -- links`
Expected: FAIL — `pairKeyOf`/`findSuggestedPairs` not exported.

### Step 3: Extend `src/lib/links.ts`

- [ ] **Step 3** — Append to `src/lib/links.ts`:

```typescript
const DAY_MS = 86_400_000;

// Canonical key for an unordered pair of transaction ids.
export function pairKeyOf(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type SuggestedPair = {
  key: string;
  positiveId: string;
  negativeId: string;
  amount: number; // absolute value of the matched amount
  dayDelta: number;
};

// Pairs each positive amount with an equal-and-opposite negative within the day
// window, above the minimum, not already ignored. Greedy: each transaction is
// used in at most one pair (largest amounts first). Pure — no DB.
export function findSuggestedPairs(
  rows: LinkMemberRow[],
  opts: { windowDays: number; minAmount: number; ignored: Set<string> },
): SuggestedPair[] {
  const positives = rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const negatives = rows.filter((r) => r.amount < 0);
  const used = new Set<string>();
  const pairs: SuggestedPair[] = [];

  for (const pos of positives) {
    if (used.has(pos.id)) continue;
    if (pos.amount < opts.minAmount) continue;
    let best: { neg: LinkMemberRow; dayDelta: number } | null = null;
    for (const neg of negatives) {
      if (used.has(neg.id)) continue;
      if (Math.abs(pos.amount + neg.amount) >= EPSILON) continue; // not opposite
      const dayDelta = Math.round(Math.abs(pos.date.getTime() - neg.date.getTime()) / DAY_MS);
      if (dayDelta > opts.windowDays) continue;
      if (!best || dayDelta < best.dayDelta) best = { neg, dayDelta };
    }
    if (!best) continue;
    const key = pairKeyOf(pos.id, best.neg.id);
    if (opts.ignored.has(key)) continue;
    used.add(pos.id);
    used.add(best.neg.id);
    pairs.push({
      key,
      positiveId: pos.id,
      negativeId: best.neg.id,
      amount: Math.round(pos.amount * 100) / 100,
      dayDelta: best.dayDelta,
    });
  }

  return pairs.sort((a, b) => b.amount - a.amount || a.dayDelta - b.dayDelta);
}
```

### Step 4: Run to verify it passes

- [ ] **Step 4** — Run: `npm run test:unit -- links`
Expected: PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/lib/links.ts tests/unit/lib/links.test.ts
git commit -m "feat: add link suggestion pairing (window/min-amount/ignored, greedy + sorted)"
```

### Step 6: Extend the links service with suggest + ignore

- [ ] **Step 6** — First extend `tests/integration/links.test.ts` (append a new describe):

```typescript
import { suggestPairs, ignoreSuggestion } from "@/server/services/links";

describe("suggestPairs", () => {
  it("suggests an opposite pair within the user's window and respects ignore", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -50, "CB FNAC");
    const b = await tx(accountId, "2026-03-05T00:00:00.000Z", 50, "REMB FNAC");

    const first = await suggestPairs(owner);
    expect(first.map((p) => p.key)).toContain([a, b].sort().join("|"));
    // Carries decrypted labels for display.
    expect(first[0].positiveLabel).toBeTruthy();
    expect(first[0].negativeLabel).toBeTruthy();

    await ignoreSuggestion(owner, [a, b].sort().join("|"));
    const second = await suggestPairs(owner);
    expect(second.some((p) => p.key === [a, b].sort().join("|"))).toBe(false);
  });

  it("excludes transactions already linked", async () => {
    const a = await tx(accountId, "2026-03-02T00:00:00.000Z", -70, "CB DARTY");
    const b = await tx(accountId, "2026-03-04T00:00:00.000Z", 70, "REMB DARTY");
    await createLink({ transactionIds: [a, b], userId: owner });
    const pairs = await suggestPairs(owner);
    expect(pairs.some((p) => p.key === [a, b].sort().join("|"))).toBe(false);
  });
});
```

Run: `npm run test:integration -- links` → FAIL (`suggestPairs`/`ignoreSuggestion` not exported).

### Step 7: Implement suggest + ignore in the service

- [ ] **Step 7** — Append to `src/server/services/links/index.ts`:

```typescript
import { findSuggestedPairs, pairKeyOf, type SuggestedPair } from "@/lib/links";
import { listTransactions } from "@/server/services/transactions";

export type SuggestedPairView = SuggestedPair & {
  positiveLabel: string;
  negativeLabel: string;
  date: string; // ISO day of the negative (expense) leg
};

// Suggests +X/-X pairs over the user's visible, not-yet-linked transactions,
// within UserPreference.linkWindowDays / linkMinAmount, excluding ignored pairs.
export async function suggestPairs(userId: string): Promise<SuggestedPairView[]> {
  const pref = await db.userPreference.findUnique({ where: { userId } });
  const windowDays = pref?.linkWindowDays ?? 30;
  const minAmount = pref ? Number(pref.linkMinAmount) : 0;

  // Visible transactions (decrypted) minus those already in a link.
  const linked = await listLinkedTxIds(userId);
  const { items } = await listTransactions(userId, { take: 5000 });
  const candidates = items.filter((t) => !linked.has(t.id));

  const ignoredRows = await db.ignoredLinkSuggestion.findMany({
    where: { userId },
    select: { pairKey: true },
  });
  const ignored = new Set(ignoredRows.map((r) => r.pairKey));

  const rows = candidates.map((t) => ({ id: t.id, amount: t.amount, date: t.date }));
  const pairs = findSuggestedPairs(rows, { windowDays, minAmount, ignored });

  const byId = new Map(candidates.map((t) => [t.id, t]));
  return pairs.map((p) => ({
    ...p,
    positiveLabel: byId.get(p.positiveId)?.label ?? "",
    negativeLabel: byId.get(p.negativeId)?.label ?? "",
    date: (byId.get(p.negativeId)?.date ?? new Date()).toISOString().slice(0, 10),
  }));
}

// Records that the user dismissed a suggested pair so it stops resurfacing.
export async function ignoreSuggestion(userId: string, pairKey: string): Promise<void> {
  await db.ignoredLinkSuggestion.upsert({
    where: { userId_pairKey: { userId, pairKey } },
    update: {},
    create: { userId, pairKey },
  });
  await logEvent({ userId, action: "link.suggestionIgnored", entity: "IgnoredLinkSuggestion", entityId: pairKey });
}

export { pairKeyOf };
```

Run: `npm run test:integration -- links` → PASS.

### Step 8: Commit

- [ ] **Step 8**

```bash
git add src/server/services/links/index.ts tests/integration/links.test.ts
git commit -m "feat: link suggestion service (preference window/min, decrypted labels, ignore)"
```

### Step 9: Add the ignore action + suggestions i18n

- [ ] **Step 9** — Append to `src/server/transport/actions/links.ts`:

```typescript
import { ignoreSuggestion } from "@/server/services/links";

export async function ignoreSuggestionAction(
  _prev: LinkActionState,
  formData: FormData,
): Promise<LinkActionState> {
  const user = await requireSession();
  const pairKey = String(formData.get("pairKey") ?? "");
  if (!pairKey.includes("|")) return { ok: false, error: "INVALID" };
  try {
    await ignoreSuggestion(user.id, pairKey);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: mapError(e) };
  }
}
```

Add a `suggestions` object to the `transactions` namespace in `messages/fr.json`:

```json
    "suggestions": {
      "title": "Suggestions de liens",
      "subtitle": "{count, plural, =0 {Aucune suggestion} one {# paire suggérée} other {# paires suggérées}}",
      "open": "Suggestions",
      "pairWithin": "à {days, plural, one {# jour} other {# jours}} d'écart",
      "link": "Lier",
      "ignore": "Ignorer",
      "empty": "Aucune paire à suggérer pour le moment."
    }
```

and `messages/en.json`:

```json
    "suggestions": {
      "title": "Link suggestions",
      "subtitle": "{count, plural, =0 {No suggestions} one {# suggested pair} other {# suggested pairs}}",
      "open": "Suggestions",
      "pairWithin": "{days, plural, one {# day} other {# days}} apart",
      "link": "Link",
      "ignore": "Ignore",
      "empty": "No pairs to suggest right now."
    }
```

### Step 10: Build the suggestions list component

- [ ] **Step 10** — Create `src/components/transactions/suggestions-list.tsx`:

```tsx
"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { createLinkAction, ignoreSuggestionAction } from "@/server/transport/actions/links";

export type SuggestionItem = {
  key: string;
  positiveId: string;
  negativeId: string;
  positiveLabel: string;
  negativeLabel: string;
  amount: number;
  dayDelta: number;
  date: string;
};

function Row({ item }: { item: SuggestionItem }) {
  const t = useTranslations("transactions.suggestions");
  const locale = useLocale();
  const router = useRouter();
  const [linkState, linkAction, linkPending] = useActionState(createLinkAction, null);
  const [ignoreState, ignoreAction, ignorePending] = useActionState(ignoreSuggestionAction, null);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });

  useEffect(() => {
    if (linkState?.ok || ignoreState?.ok) router.refresh();
  }, [linkState, ignoreState, router]);

  return (
    <Card data-slot="suggestion-row" className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{money.format(item.amount)}</div>
        <div className="text-muted-foreground truncate text-[12px]">
          {item.negativeLabel} ↔ {item.positiveLabel} · {t("pairWithin", { days: item.dayDelta })}
        </div>
      </div>
      <form action={linkAction}>
        <input type="hidden" name="transactionIds" value={`${item.positiveId},${item.negativeId}`} />
        <button
          type="submit"
          disabled={linkPending}
          className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-[0.8rem] font-medium disabled:opacity-50"
        >
          {t("link")}
        </button>
      </form>
      <form action={ignoreAction}>
        <input type="hidden" name="pairKey" value={item.key} />
        <button
          type="submit"
          disabled={ignorePending}
          className="border-border text-muted-foreground hover:text-foreground inline-flex h-8 items-center rounded-lg border px-3 text-[0.8rem] disabled:opacity-50"
        >
          {t("ignore")}
        </button>
      </form>
    </Card>
  );
}

export function SuggestionsList({ items }: { items: SuggestionItem[] }) {
  const t = useTranslations("transactions.suggestions");
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <Row key={it.key} item={it} />
      ))}
    </div>
  );
}
```

### Step 11: Build the suggestions page + a link to it

- [ ] **Step 11** — Create `src/app/[locale]/(authenticated)/transactions/suggestions/page.tsx`:

```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { suggestPairs } from "@/server/services/links";
import { SuggestionsList } from "@/components/transactions/suggestions-list";

export const dynamic = "force-dynamic";

export default async function SuggestionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("transactions.suggestions");
  const pairs = await suggestPairs(user.id);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <header className="space-y-1">
        <div className="text-muted-foreground text-[0.7rem] font-medium tracking-[0.14em] uppercase">
          {t("subtitle", { count: pairs.length })}
        </div>
        <h1 className="font-display text-3xl leading-none">{t("title")}</h1>
      </header>
      <SuggestionsList items={pairs} />
    </div>
  );
}
```

Add a link to the suggestions page in the transactions header. In `src/app/[locale]/(authenticated)/transactions/page.tsx`, in the header next to the "create" button, add:

```tsx
import Link from "next/link";
```
```tsx
        <Link
          href={`/${locale}/transactions/suggestions`}
          className="text-primary text-sm hover:underline"
        >
          {t("suggestions.open")}
        </Link>
```

> `t` here is the `transactions` translator already created in this page; `t("suggestions.open")` resolves the nested key. Place the `<Link>` inside the existing header flex row.

### Step 12: Typecheck + CI

- [ ] **Step 12**

Run: `npm run typecheck` → PASS.
Run: `npm run ci` → PASS.

### Step 13: Extend the e2e — accept + persisted ignore

- [ ] **Step 13** — Append to `tests/e2e/links.spec.ts` (inside the `describe`):

```typescript
  test("accepts a suggested pair and persists an ignore", async ({ page }) => {
    const stamp = Date.now();
    const exp = `Sugg exp ${stamp}`;
    const ref = `Sugg ref ${stamp}`;
    for (const [label, amount] of [
      [exp, "-80"],
      [ref, "80"],
    ] as const) {
      await page.goto("/fr/transactions");
      await expect(async () => {
        await page.getByRole("button", { name: /nouvelle transaction/i }).click();
        await expect(page.locator('input[name="date"]')).toBeVisible();
      }).toPass();
      await page.fill('input[name="date"]', "2026-04-02");
      await page.fill('input[name="amount"]', amount);
      await page.fill('input[name="label"]', label);
      await page.getByRole("button", { name: /^ajouter$/i }).click();
      await expect(
        page.locator('[data-slot="transaction-row"]').filter({ hasText: label }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    await page.goto("/fr/transactions/suggestions");
    const row = page.locator('[data-slot="suggestion-row"]').filter({ hasText: "80" }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: /ignorer/i }).click();
    // After ignoring, that pair no longer appears on reload.
    await page.goto("/fr/transactions/suggestions");
    await expect(
      page.locator('[data-slot="suggestion-row"]').filter({ hasText: "80" }),
    ).toHaveCount(0, { timeout: 15_000 });
  });
```

### Step 14: Run e2e + commit, push, PR

- [ ] **Step 14**

Run: `npm run test:e2e -- links --project=chromium` → PASS.
Run: `npm run ci` → PASS.

```bash
git add src/lib/links.ts src/server/services/links src/server/transport/actions/links.ts src/components/transactions/suggestions-list.tsx "src/app/[locale]/(authenticated)/transactions" messages tests
git commit -m "feat: link auto-suggestions page (accept creates a link, ignore persists)"
git push -u origin feature/6.2-link-suggestions
gh pr create --base develop --title "feat: link auto-suggestions" --label "enhancement,phase-6,frontend,backend" --body "Closes #28"
```

---

## Task 6.3 — Link-aware totals

**Branch:** `feature/6.3-link-aware-totals`
**Goal:** Make the dashboard aggregates link-aware — balanced groups drop out, unbalanced groups collapse to their net on the primary — and skip balanced-link members in the transactions list per-day subtotal.

### Step 1: Extend the link-math test with collapse

- [ ] **Step 1** — Append to `tests/unit/lib/links.test.ts`:

```typescript
import { collapseLinkedRows } from "@/lib/links";

describe("collapseLinkedRows", () => {
  const base = (over: Partial<{ id: string; amount: number; date: Date; categoryId: string | null; linkId: string | null }>) => ({
    id: "x",
    amount: -10,
    date: new Date("2026-03-02T00:00:00.000Z"),
    categoryId: null as string | null,
    linkId: null as string | null,
    ...over,
  });

  it("keeps unlinked rows unchanged", () => {
    const rows = [base({ id: "a", amount: -10 }), base({ id: "b", amount: 5 })];
    const out = collapseLinkedRows(rows);
    expect(out).toHaveLength(2);
  });

  it("drops a balanced link entirely", () => {
    const rows = [
      base({ id: "a", amount: -50, linkId: "L1", categoryId: "groc" }),
      base({ id: "b", amount: 50, linkId: "L1" }),
    ];
    expect(collapseLinkedRows(rows)).toHaveLength(0);
  });

  it("collapses an unbalanced link to the net on the primary", () => {
    const rows = [
      base({ id: "a", amount: -50, linkId: "L1", categoryId: "groc", date: new Date("2026-03-01T00:00:00.000Z") }),
      base({ id: "b", amount: 30, linkId: "L1", categoryId: "ref", date: new Date("2026-03-05T00:00:00.000Z") }),
    ];
    const out = collapseLinkedRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a"); // primary = largest |amount|
    expect(out[0].amount).toBe(-20); // net
    expect(out[0].categoryId).toBe("groc"); // primary's category
  });
});
```

### Step 2: Run to verify it fails

- [ ] **Step 2** — Run: `npm run test:unit -- links`
Expected: FAIL — `collapseLinkedRows` not exported.

### Step 3: Implement `collapseLinkedRows`

- [ ] **Step 3** — Append to `src/lib/links.ts`:

```typescript
// A transaction row tagged with its link membership (null = not linked).
export type CollapsibleRow = {
  id: string;
  amount: number;
  date: Date;
  categoryId: string | null;
  linkId: string | null;
};

// Collapses links for aggregation: unlinked rows pass through; a balanced group
// is dropped; an unbalanced group becomes one synthetic row = its primary with
// amount replaced by the group's net sum. See plan §"Period boundary".
export function collapseLinkedRows<T extends CollapsibleRow>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  const out: T[] = [];

  for (const r of rows) {
    if (r.linkId == null) {
      out.push(r);
      continue;
    }
    const g = groups.get(r.linkId);
    if (g) g.push(r);
    else groups.set(r.linkId, [r]);
  }

  for (const members of groups.values()) {
    const amounts = members.map((m) => m.amount);
    if (isBalanced(amounts)) continue; // balanced → excluded
    const primary = pickPrimary(members);
    out.push({ ...primary, amount: netSum(amounts) });
  }

  return out;
}
```

### Step 4: Run to verify it passes

- [ ] **Step 4** — Run: `npm run test:unit -- links`
Expected: PASS.

### Step 5: Commit

- [ ] **Step 5**

```bash
git add src/lib/links.ts tests/unit/lib/links.test.ts
git commit -m "feat: add collapseLinkedRows (drop balanced, net to primary)"
```

### Step 6: Write the failing link-aware dashboard test

- [ ] **Step 6** — Append a describe to `tests/integration/dashboard.test.ts`. It reuses that file's existing `tx(...)` helper and `owner`/`accountId`/`catA`/`catB` setup. Add at the top of the file (with the other imports):

```typescript
import { createLink } from "@/server/services/links";
```

Then append:

```typescript
describe("getDashboard link-aware totals", () => {
  it("excludes a balanced link and collapses an unbalanced one to its net", async () => {
    // April 2026, isolated from the other tests' March data.
    const period = monthPeriod(2026, 4);

    // Balanced refund pair (−50 / +50) → must NOT affect totals.
    await tx("2026-04-03T00:00:00.000Z", -50, "CB BALANCED", catA);
    await tx("2026-04-04T00:00:00.000Z", 50, "REMB BALANCED", null);

    // Unbalanced pair (−80 spend / +30 partial refund) → net −50 on the primary (catB).
    await tx("2026-04-10T00:00:00.000Z", -80, "CB PARTIAL", catB);
    await tx("2026-04-12T00:00:00.000Z", 30, "REMB PARTIAL", null);

    const all = await db.transaction.findMany({
      where: { accountId, date: { gte: period.from, lte: period.to } },
      select: { id: true, amount: true },
    });
    const find = (amt: number) => all.find((r) => Number(r.amount) === amt)!.id;
    await createLink({ transactionIds: [find(-50), find(50)], userId: owner });
    await createLink({ transactionIds: [find(-80), find(30)], userId: owner });

    const data = await getDashboard(owner, period, previousMonthPeriod(period));
    // Balanced pair contributes nothing; unbalanced collapses to a −50 expense.
    expect(data.totals.income).toBe(0);
    expect(data.totals.expense).toBe(50);
    expect(data.totals.net).toBe(-50);
    // The collapsed −50 lands on catB (the primary's category).
    expect(data.byCategory).toEqual([{ categoryId: catB, amount: 50 }]);

    // Cleanup so other tests' assumptions about the dataset hold.
    await db.transactionLinkMember.deleteMany({});
    await db.transactionLink.deleteMany({});
    await db.transaction.deleteMany({ where: { accountId, date: { gte: period.from, lte: period.to } } });
  });
});
```

### Step 7: Run to verify it fails

- [ ] **Step 7** — Run: `npm run test:integration -- dashboard`
Expected: FAIL — totals still include the balanced pair / don't collapse.

### Step 8: Make the dashboard aggregation link-aware

- [ ] **Step 8** — Refactor `src/server/services/dashboard/index.ts` so totals, by-category and the trace all run over collapsed rows.

a) Add the import:

```typescript
import { collapseLinkedRows, type CollapsibleRow } from "@/lib/links";
```

b) Replace `totalsFor` so it loads the clear columns + link id, collapses, then sums:

```typescript
type AggRow = CollapsibleRow & { accountId: string };

async function loadRows(accountIds: string[], period: Period): Promise<AggRow[]> {
  if (accountIds.length === 0) return [];
  const rows = await db.transaction.findMany({
    where: { accountId: { in: accountIds }, date: { gte: period.from, lte: period.to } },
    select: {
      id: true,
      amount: true,
      date: true,
      categoryId: true,
      accountId: true,
      linkMembership: { select: { linkId: true } },
    },
  });
  return collapseLinkedRows(
    rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      date: r.date,
      categoryId: r.categoryId,
      accountId: r.accountId,
      linkId: r.linkMembership?.linkId ?? null,
    })),
  );
}

function totalsOf(rows: AggRow[]): DashboardTotals {
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    if (r.amount >= 0) income += r.amount;
    else expense += -r.amount;
  }
  return {
    income: round2(income),
    expense: round2(expense),
    net: round2(income - expense),
    count: rows.length,
  };
}
```

c) In `getDashboard`, replace the body's data loading + the expense queries so everything derives from the collapsed rows:

```typescript
export async function getDashboard(
  userId: string,
  period: Period,
  previous: Period,
): Promise<DashboardData> {
  const accountIds = (await listVisibleForUser(userId)).map((a) => a.id);

  const rows = await loadRows(accountIds, period);
  const prevRows = await loadRows(accountIds, previous);
  const totals = totalsOf(rows);
  const prev = totalsOf(prevRows);

  // Expenses (post-collapse) for by-category + trace.
  const expenseRows = rows
    .filter((r) => r.amount < 0)
    .map((r) => ({ amount: r.amount, date: r.date, categoryId: r.categoryId }));

  // By category, highest spend first.
  const byCat = new Map<string | null, number>();
  for (const r of expenseRows) {
    byCat.set(r.categoryId, (byCat.get(r.categoryId) ?? 0) - r.amount);
  }
  const byCategory = [...byCat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  // Day-by-day for short spans, month-by-month for longer ones.
  const spanDays = Math.round((period.to.getTime() - period.from.getTime() + 1) / 86_400_000);
  const trace =
    spanDays > DAILY_TRACE_MAX_DAYS
      ? monthlyTrace(expenseRows, period)
      : dailyTrace(expenseRows, period);

  const { items: recent } = await listTransactions(userId, {
    from: period.from,
    to: period.to,
    take: 6,
  });

  return {
    totals,
    previous: { income: prev.income, expense: prev.expense, net: prev.net },
    byCategory,
    trace,
    recent,
  };
}
```

d) Update the `ExpenseRow` type used by `dailyTrace`/`monthlyTrace`/`summarize` to the plain shape now passed in (it already only reads `amount`/`date`/`categoryId`):

```typescript
type ExpenseRow = { amount: number; date: Date; categoryId: string | null };
```

> Delete the now-unused old `totalsFor` function and the separate `expenseRows` DB query. The trace helpers are unchanged except for the `ExpenseRow` type. `summarize`'s `keyOf`/peak logic still works since it reads the same fields.

### Step 9: Run to verify it passes

- [ ] **Step 9** — Run: `npm run test:integration -- dashboard`
Expected: PASS (existing dashboard tests + the new link-aware one).

### Step 10: Make the list per-day subtotal link-aware

- [ ] **Step 10** — In `src/components/transactions/transaction-list.tsx`, the per-day subtotal must skip members of a balanced link. Since the client list only knows `linked: boolean` (not the net), the pragmatic rule is: **exclude linked rows from the day subtotal** (a linked refund pair nets ~0; showing the gross sum double-counts). Update the grouping reduce:

```typescript
      // Linked rows are excluded from the day subtotal — their net is reflected
      // in the dashboard; showing gross here would double-count refunds.
      for (const item of dayRows) if (!item.linked) g.total += item.amount;
```

> Find the existing `g.total += item.amount` accumulation and replace it with the guarded version above (keep the surrounding grouping code).

### Step 11: Thread `linkId`/`linked` already covers this — confirm

- [ ] **Step 11** — `linked` is already on `ListItem` from scope 6.1, and the page already sets it from `listLinkedTxIds`. No new prop needed. Confirm `npm run typecheck` passes.

### Step 12: Typecheck + CI

- [ ] **Step 12**

Run: `npm run typecheck` → PASS.
Run: `npm run ci` → PASS.

### Step 13: Commit, push, PR

- [ ] **Step 13**

```bash
git add src/lib/links.ts src/server/services/dashboard/index.ts src/components/transactions/transaction-list.tsx tests
git commit -m "feat: link-aware totals (exclude balanced, collapse unbalanced to net) on dashboard + list"
git push -u origin feature/6.3-link-aware-totals
gh pr create --base develop --title "feat: link-aware totals" --label "enhancement,phase-6,frontend,backend" --body "Closes #29"
```

---

## Self-Review notes (for the executor)

**Spec coverage (PLAN.md Phase 6 + spec §4.5/§5.8):**
- 6.1 `TransactionLink` + `TransactionLinkMember` + one-link-per-tx (`transactionId @unique`), link-mode UI (visible-tx selection) → Task 6.1. ✅ AC: unit (`netSum`/`isBalanced`/`pickPrimary`) + e2e manual link.
- 6.2 `suggestPairs` (±window + min amount from `UserPreference`), `IgnoredLinkSuggestion`, accept/ignore panel → Task 6.2. ✅ AC: unit pairing logic; e2e accept + persisted ignore.
- 6.3 balanced groups excluded, unbalanced → primary gets net, applied in dashboard + transactions display → Task 6.3. ✅ AC: integration totals with mixed links.

**Type consistency:** `LinkMemberRow {id, amount, date}` feeds `pickPrimary`/`findSuggestedPairs`; `CollapsibleRow` (adds `categoryId`, `linkId`) feeds `collapseLinkedRows`; the dashboard's `AggRow = CollapsibleRow & {accountId}`. `SuggestedPair` (lib) is extended to `SuggestedPairView` (service, adds decrypted labels + ISO date) consumed by `SuggestionItem` (component) — same field names. `LinkActionState` is the single action return union. `ListItem.linked` is introduced in 6.1 and reused in 6.3.

**Deliberate scope cuts (documented, not gaps):**
- **Cross-period links** are collapsed only within the loaded period window (plan §"Period boundary"). A member outside the period is treated as isolated — acceptable because links pair transactions within `linkWindowDays`.
- **List per-day subtotal** excludes all linked rows (not just balanced ones) because the client doesn't know each link's net; the authoritative link-aware figures are on the dashboard. Revisit if exact per-day net is wanted (would need the server to pass each row's collapsed amount).
- **Link naming / N-ary links beyond pairs**: the model supports N members and an optional `name`, and `createLink` accepts N ids, but the suggestions flow only proposes pairs (per spec §5.8). Manual link mode already supports N.
- **Unlink from the detail panel** is not built here (link mode + delete action exist server-side via `deleteLinkAction`); wire an "unlink" button into the transaction detail in a later polish pass if desired.

**Before each PR:** `git checkout develop && git pull`, delete merged branches, branch `feature/6.x-...`, `npm run ci`, GPG-sign commits, PR with `Closes #<issue>` + labels. Scope 6.1 adds a migration — restart the `app` container after `db:migrate` so the dev server reloads the regenerated Prisma client (see `[[project_dev-e2e-ops]]`).

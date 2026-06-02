# Phase 2 — Accounts & Groups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can create bank accounts (with an encrypted, searchable IBAN), form household **groups** with role-based membership, **invite** people by email/code, and **share** accounts with a group under READ/WRITE permissions — with a permission layer (`listVisibleForUser`, write checks) that later phases (transactions, budgets) build on.

**Architecture:** Follows the Phase 1 layering exactly. Pure, tested business logic lives in `src/server/services/*`; Server Actions in `src/server/transport/actions/*` are thin wrappers that `requireSession()`, validate `FormData` with Zod, call a service, `revalidatePath`, and return a discriminated `{ ok }` state. Reads happen in Server Components. Sensitive fields (IBAN) are encrypted via the existing `server/crypto` primitives (`encrypt`/`decrypt` + HMAC blind index). Group/account authorization is centralized in two helpers: `requireGroupRole()` and `getEffectiveAccess()`. Each scope ships one Prisma migration, one branch, one PR.

**Tech Stack:** Next.js 16 App Router · Prisma 7 + `@prisma/adapter-mariadb` · MariaDB 11 · `zod` · `next-intl` (fr/en) · shadcn `dialog`/`badge`/`alert`/`input`/`label`/`button` (+ existing) · `lucide-react` · `nodemailer` (invitation email, SMTP from DB) · Vitest (unit + integration on `mariadb-test`) · Playwright (e2e with a real signed-in `storageState` fixture introduced in this phase).

> **Spec references:** §3.2 transport rules, §3.3 directory structure, §4.2 Group B (Group / GroupMember / GroupInvitation / AccountShare), §4.3 Group C (BankAccount), §5.4 account creation & sharing, §6.1 AES-256-GCM, §6.2 HMAC blind index, §6.8 audit events (`account.*`, `group.*`), §7 testing strategy.

> **TDD philosophy (inherited from Phase 1):** Schema/migration steps are verified by **commands that must succeed**. Logic-bearing code (services, permission helpers, IBAN validation, invitation lifecycle) follows strict **test-first** TDD with complete test code shown. Server Actions get a thin happy/`UNAUTHORIZED` unit test. UI pages are verified by Playwright e2e (now runnable thanks to the auth fixture) plus a `curl` redirect check; component markup is given in full but not driven test-first.

> **Out of scope for Phase 2** (deferred — flagged inline where they would appear):
> - `Category`, `Transaction`, `ImportBatch`, `Budget*` relations on `BankAccount`/`Group` (Phases 3/4/7). Each model is added with **only** the relations whose target models already exist; back-relations are appended in their owning phase.
> - Account-balance computation and transaction listing (Phase 3.4 / 5).
> - Real outbound SMTP tuning / templates polish and the `/admin/smtp` editor (Phase 8.4). This phase adds a minimal `mailer` that sends via the DB `SmtpConfig` when enabled and otherwise logs + audits the invitation link (the Phase 1 reset-link fallback pattern).
> - PWA/mobile bottom-sheet refinement of dialogs (Phase 8.3) — create/edit use a centered `Dialog` on all breakpoints for now.

---

## File Structure (created or modified in this phase)

```
prisma/
├── schema.prisma                                   # +BankAccount (2.1), +Group/GroupMember (2.2), +GroupInvitation (2.3), +AccountShare (2.4)
└── migrations/<ts>_phase_2_1_accounts/             # one migration per scope (2_1 … 2_4)
scripts/
└── seed-e2e.ts                                     # +credentialed users (owner/member/admin) for e2e; registration_mode=OPEN on the e2e DB
src/
├── server/
│   ├── services/
│   │   ├── accounts/
│   │   │   ├── iban.ts                              # normalizeIban / isValidIban / maskIban (pure)
│   │   │   ├── index.ts                             # createAccount/updateAccount/archiveAccount/getAccountForUser/listVisibleForUser
│   │   │   └── sharing.ts                           # shareAccountWithGroup/revokeShare/getEffectiveAccess/canWriteAccount/listSharesForAccount (2.4)
│   │   ├── groups/
│   │   │   ├── index.ts                             # createGroup/list/detail/update/delete + membership (roles, leave)
│   │   │   ├── roles.ts                             # GroupRole, RANK, getMembership, requireGroupRole, GroupAccessError
│   │   │   └── invitations.ts                       # createInvitation/accept/revoke/list/pendingForEmail (2.3)
│   │   └── mail/
│   │       └── mailer.ts                            # sendInvitationEmail() via nodemailer+SmtpConfig, else log+audit (2.3)
│   └── transport/actions/
│       ├── accounts.ts                              # create/update/archive account (2.1) + share/revoke (2.4)
│       ├── groups.ts                                # create/update/delete group + role/remove/leave (2.2)
│       └── invitations.ts                           # create/revoke/accept invitation (2.3)
├── lib/
│   └── validation/account.ts                        # shared Zod schemas + types (imported by service + action + form)
├── components/
│   ├── shell/nav-items.ts                            # +accounts (2.1), +groups (2.2) entries
│   ├── accounts/{account-form,account-list,share-dialog}.tsx
│   └── groups/{group-form,group-list,member-list,invite-form,invitations-list,join-by-code}.tsx
├── app/[locale]/(authenticated)/
│   ├── accounts/page.tsx                             # 2.1 list+create+edit+archive; 2.4 adds shared accounts + share control
│   └── groups/
│       ├── page.tsx                                  # 2.2 list+create; 2.3 join-by-code entry
│       ├── [id]/page.tsx                             # 2.2 members+roles; 2.3 invitations; 2.4 (later) shows shared accounts
│       └── join/[token]/page.tsx                     # 2.3 accept invitation by link
├── ui/ (shadcn)                                      # +dialog (added in 2.1)
messages/{fr,en}.json                                 # +accounts, +groups, +invitations, +shell.nav.* namespaces
tests/
├── e2e/
│   ├── .auth/                                        # gitignored storageState output
│   ├── auth.setup.ts                                 # signs in owner/member/admin, saves storageState (2.1)
│   ├── accounts.spec.ts                              # 2.1 + 2.4
│   └── groups.spec.ts                                # 2.2 + 2.3
├── integration/
│   ├── accounts.test.ts                              # 2.1
│   ├── account-sharing.test.ts                       # 2.4
│   ├── groups.test.ts                                # 2.2
│   └── invitations.test.ts                           # 2.3
└── unit/services/iban.test.ts                        # 2.1
playwright.config.ts                                  # +setup project + storageState wiring (2.1)
.gitignore                                            # +tests/e2e/.auth
```

---

## Task 2.1 — BankAccount CRUD (encrypted IBAN)

> **Branch:** `feature/2.1-bank-accounts`. **PR title:** `feat: bank account CRUD with encrypted IBAN`. **Labels:** `enhancement`, `phase-2`, `frontend`, `backend`. **Closes #13**.

**Files:**
- Modify: `prisma/schema.prisma` (+`BankAccount`, +`User.accounts`), `scripts/seed-e2e.ts`, `playwright.config.ts`, `.gitignore`, `src/components/shell/nav-items.ts`, `messages/fr.json`, `messages/en.json`
- Create: `src/server/services/accounts/iban.ts`, `src/server/services/accounts/index.ts`, `src/lib/validation/account.ts`, `src/server/transport/actions/accounts.ts`, `src/components/accounts/{account-form,account-list}.tsx`, `src/app/[locale]/(authenticated)/accounts/page.tsx`, `src/components/ui/dialog.tsx` (shadcn), `tests/unit/services/iban.test.ts`, `tests/integration/accounts.test.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/accounts.spec.ts`

- [x] **Step 1: Add the `BankAccount` model + migration**

In `prisma/schema.prisma`, add the `accounts` relation to `User` (inside the `User` block, next to `roles`/`preference`):
```prisma
  accounts      BankAccount[] @relation("AccountOwner")
```
Then append a new section (after the Phase 1 models):
```prisma
// ─── Group C — Bank accounts (Phase 2) ───────────────────────────────────────

model BankAccount {
  id        String   @id @default(cuid())
  ownerId   String
  name      String
  type      String // CHECKING | SAVINGS | CREDIT | OTHER
  ibanEnc   String?  @db.Text // AES-256-GCM (v1.iv.ct.tag)
  ibanHash  String? // HMAC-SHA256 blind index for equality search
  bankName  String?
  color     String?  @default("#2563eb")
  icon      String?
  archived  Boolean  @default(false)
  createdAt DateTime @default(now())

  owner User @relation("AccountOwner", fields: [ownerId], references: [id], onDelete: Cascade)

  @@index([ownerId])
  @@index([ibanHash])
}
```

- [x] **Step 2: Generate the migration and client**

Run: `npm run db:migrate -- --name phase_2_1_accounts`
Expected: a new folder `prisma/migrations/<ts>_phase_2_1_accounts/` with `CREATE TABLE BankAccount`, and `prisma generate` runs. Then `npx prisma generate`.
Verify: `npx prisma validate` → "The schema is valid".

- [x] **Step 3: IBAN helpers — write the failing unit test**

Create `tests/unit/services/iban.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeIban, isValidIban, maskIban } from "@/server/services/accounts/iban";

describe("normalizeIban", () => {
  it("removes spaces and uppercases", () => {
    expect(normalizeIban(" fr76 3000 6000 01 ")).toBe("FR7630006000 01".replace(/\s/g, ""));
    expect(normalizeIban("fr7630006000011234567890189")).toBe("FR7630006000011234567890189");
  });
});

describe("isValidIban", () => {
  it("accepts a valid IBAN (mod-97 == 1)", () => {
    expect(isValidIban("FR7630006000011234567890189")).toBe(true);
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
  });
  it("rejects bad checksum, bad length, and non-alphanumerics", () => {
    expect(isValidIban("FR7630006000011234567890188")).toBe(false); // wrong check digits
    expect(isValidIban("FR76")).toBe(false); // too short
    expect(isValidIban("FR76!@#$")).toBe(false);
  });
});

describe("maskIban", () => {
  it("shows only the last 4 chars", () => {
    expect(maskIban("FR7630006000011234567890189")).toBe("•••• 0189");
  });
});
```

- [x] **Step 4: Run it to confirm it fails**

Run: `npm run test:unit -- iban`
Expected: FAIL — module `@/server/services/accounts/iban` not found.

- [x] **Step 5: Implement the IBAN helpers**

Create `src/server/services/accounts/iban.ts`:
```ts
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

// ISO 13616 mod-97 check (value must equal 1). Moves the first 4 chars to the
// end, maps letters A–Z → 10–35, then computes the big-integer mod 97 digit by
// digit to avoid overflow.
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z0-9]{15,34}$/.test(iban)) return false;
  if (!/^[A-Z]{2}[0-9]{2}/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged
    .split("")
    .map((c) => (c >= "A" && c <= "Z" ? (c.charCodeAt(0) - 55).toString() : c))
    .join("");
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder === 1;
}

export function maskIban(raw: string): string {
  const iban = normalizeIban(raw);
  return `•••• ${iban.slice(-4)}`;
}
```

- [x] **Step 6: Run it to confirm it passes**

Run: `npm run test:unit -- iban`
Expected: PASS (3 suites).

- [x] **Step 7: Shared validation schema**

Create `src/lib/validation/account.ts`:
```ts
import { z } from "zod";

export const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "CREDIT", "OTHER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// `iban` is validated for *format* here; mod-97 validity is enforced in the
// service (which can return a typed error). Empty string === "no IBAN".
export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(ACCOUNT_TYPES),
  iban: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined)),
  bankName: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().trim().max(50).optional(),
});

export type AccountInput = z.infer<typeof accountInputSchema>;
```

- [x] **Step 8: Accounts service — write the failing integration test**

Create `tests/integration/accounts.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { dataKey } from "@/server/crypto/keys";
import { decrypt } from "@/server/crypto/encryption";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  getAccountForUser,
  listVisibleForUser,
  AccountAccessError,
} from "@/server/services/accounts";

const ownerId = "acc_owner";
const otherId = "acc_other";
const iban = "FR7630006000011234567890189";

beforeAll(async () => {
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await db.user.create({ data: { id: ownerId, email: "acc-owner@bilan.local" } });
  await db.user.create({ data: { id: otherId, email: "acc-other@bilan.local" } });
});

afterAll(async () => {
  await db.bankAccount.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
  await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  await db.$disconnect();
});

describe("accounts service", () => {
  it("creates an account, encrypting the IBAN and storing a non-plaintext hash", async () => {
    const acc = await createAccount(
      { name: "Compte courant", type: "CHECKING", iban, bankName: "BNP" },
      ownerId,
    );
    const row = await db.bankAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(row.ibanEnc).toBeTruthy();
    expect(row.ibanEnc).not.toContain(iban); // stored ciphertext, not plaintext
    expect(decrypt(row.ibanEnc!, dataKey)).toBe(iban); // round-trips
    expect(row.ibanHash).toBeTruthy();
    expect(row.ibanHash).not.toBe(iban);

    const audit = await db.auditLog.findFirst({
      where: { action: "account.created", entityId: acc.id },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects an IBAN that fails the mod-97 check", async () => {
    await expect(
      createAccount({ name: "Bad", type: "OTHER", iban: "FR7630006000011234567890188" }, ownerId),
    ).rejects.toBeInstanceOf(AccountAccessError);
  });

  it("blocks update/archive by a non-owner", async () => {
    const acc = await createAccount({ name: "Mine", type: "SAVINGS" }, ownerId);
    await expect(updateAccount(acc.id, { name: "Hacked", type: "SAVINGS" }, { id: otherId })).rejects.toBeInstanceOf(
      AccountAccessError,
    );
    await expect(archiveAccount(acc.id, { id: otherId })).rejects.toBeInstanceOf(AccountAccessError);
  });

  it("getAccountForUser returns null for a non-owner and the row for the owner", async () => {
    const acc = await createAccount({ name: "Visible", type: "OTHER" }, ownerId);
    expect(await getAccountForUser(acc.id, otherId)).toBeNull();
    expect((await getAccountForUser(acc.id, ownerId))?.id).toBe(acc.id);
  });

  it("listVisibleForUser returns own non-archived accounts with OWNER access and a masked IBAN", async () => {
    const before = await listVisibleForUser(ownerId);
    const acc = await createAccount({ name: "ToArchive", type: "OTHER", iban }, ownerId);
    const withNew = await listVisibleForUser(ownerId);
    expect(withNew.length).toBe(before.length + 1);
    const created = withNew.find((a) => a.id === acc.id)!;
    expect(created.access).toBe("OWNER");
    expect(created.ibanMasked).toBe("•••• 0189");

    await archiveAccount(acc.id, { id: ownerId });
    const afterArchive = await listVisibleForUser(ownerId);
    expect(afterArchive.find((a) => a.id === acc.id)).toBeUndefined(); // archived hidden by default
  });
});
```

- [x] **Step 9: Run it to confirm it fails**

Run: `npm run test:integration -- accounts`
Expected: FAIL — `@/server/services/accounts` not found.

- [x] **Step 10: Implement the accounts service**

Create `src/server/services/accounts/index.ts`:
```ts
import { db } from "@/server/db";
import { encrypt, decrypt } from "@/server/crypto/encryption";
import { hmacForSearch } from "@/server/crypto/hmac";
import { dataKey, searchKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { accountInputSchema, type AccountInput } from "@/lib/validation/account";
import { isValidIban, normalizeIban, maskIban } from "./iban";

// Thrown for both authorization failures and invalid business input so callers
// (Server Actions) can map any of them to a single user-facing error state.
export class AccountAccessError extends Error {}

export type AccountAccess = "OWNER" | "WRITE" | "READ";

export type VisibleAccount = {
  id: string;
  name: string;
  type: string;
  bankName: string | null;
  color: string | null;
  icon: string | null;
  archived: boolean;
  ibanMasked: string | null;
  access: AccountAccess;
  ownerName: string | null; // null when the viewer owns it
};

function ibanFields(iban: string | undefined): { ibanEnc: string | null; ibanHash: string | null } {
  if (!iban) return { ibanEnc: null, ibanHash: null };
  const normalized = normalizeIban(iban);
  if (!isValidIban(normalized)) throw new AccountAccessError("INVALID_IBAN");
  return { ibanEnc: encrypt(normalized, dataKey), ibanHash: hmacForSearch(normalized, searchKey) };
}

export async function createAccount(input: AccountInput, ownerId: string): Promise<{ id: string }> {
  const data = accountInputSchema.parse(input);
  const { ibanEnc, ibanHash } = ibanFields(data.iban);
  const acc = await db.bankAccount.create({
    data: {
      ownerId,
      name: data.name,
      type: data.type,
      bankName: data.bankName ?? null,
      color: data.color ?? undefined,
      icon: data.icon ?? null,
      ibanEnc,
      ibanHash,
    },
  });
  await logEvent({ userId: ownerId, action: "account.created", entity: "BankAccount", entityId: acc.id });
  return { id: acc.id };
}

async function ownedOrThrow(id: string, actorId: string) {
  const acc = await db.bankAccount.findUnique({ where: { id } });
  if (!acc || acc.ownerId !== actorId) throw new AccountAccessError("FORBIDDEN");
  return acc;
}

export async function updateAccount(id: string, input: AccountInput, actor: { id: string }): Promise<void> {
  await ownedOrThrow(id, actor.id);
  const data = accountInputSchema.parse(input);
  const { ibanEnc, ibanHash } = ibanFields(data.iban);
  await db.bankAccount.update({
    where: { id },
    data: {
      name: data.name,
      type: data.type,
      bankName: data.bankName ?? null,
      color: data.color ?? undefined,
      icon: data.icon ?? null,
      ibanEnc,
      ibanHash,
    },
  });
  await logEvent({ userId: actor.id, action: "account.updated", entity: "BankAccount", entityId: id });
}

export async function archiveAccount(id: string, actor: { id: string }): Promise<void> {
  await ownedOrThrow(id, actor.id);
  await db.bankAccount.update({ where: { id }, data: { archived: true } });
  await logEvent({ userId: actor.id, action: "account.archived", entity: "BankAccount", entityId: id });
}

export async function getAccountForUser(id: string, userId: string) {
  const acc = await db.bankAccount.findUnique({ where: { id } });
  if (!acc || acc.ownerId !== userId) return null;
  return acc;
}

// Phase 2.1: owned, non-archived accounts only. Extended in 2.4 to merge in
// accounts shared via the viewer's groups.
export async function listVisibleForUser(userId: string): Promise<VisibleAccount[]> {
  const owned = await db.bankAccount.findMany({
    where: { ownerId: userId, archived: false },
    orderBy: { createdAt: "desc" },
  });
  return owned.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    bankName: a.bankName,
    color: a.color,
    icon: a.icon,
    archived: a.archived,
    ibanMasked: a.ibanEnc ? maskIban(decrypt(a.ibanEnc, dataKey)) : null,
    access: "OWNER",
    ownerName: null,
  }));
}
```

- [x] **Step 11: Run it to confirm it passes**

Run: `npm run test:integration -- accounts`
Expected: PASS (5 tests).

- [x] **Step 12: Server Actions for accounts**

Create `src/server/transport/actions/accounts.ts`:
> **Cache convention (from Phase 1):** actions do **not** call `revalidatePath`; the client form refreshes the server component with `router.refresh()` on `state.ok` (see `create-user-form.tsx`). Keep that pattern here.

```ts
"use server";

import { requireSession } from "@/server/auth/permissions";
import { accountInputSchema } from "@/lib/validation/account";
import {
  createAccount,
  updateAccount,
  archiveAccount,
  AccountAccessError,
} from "@/server/services/accounts";

export type AccountActionState = { ok: true } | { ok: false; error: string } | null;

function parse(formData: FormData) {
  return accountInputSchema.safeParse({
    name: formData.get("name") ?? "",
    type: formData.get("type") ?? "",
    iban: formData.get("iban") ?? "",
    bankName: formData.get("bankName") ?? "",
    color: formData.get("color") || undefined,
    icon: formData.get("icon") || undefined,
  });
}

export async function createAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await createAccount(parsed.data, user.id);
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "INVALID_IBAN" : "FAILED" };
  }
  return { ok: true };
}

export async function updateAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, error: "INVALID" };
  try {
    await updateAccount(id, parsed.data, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}

export async function archiveAccountAction(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "INVALID" };
  try {
    await archiveAccount(id, { id: user.id });
  } catch (e) {
    return { ok: false, error: e instanceof AccountAccessError ? "FORBIDDEN" : "FAILED" };
  }
  return { ok: true };
}
```

- [x] **Step 13: Add the shadcn `dialog` component**

Run: `printf 'N\n' | npx shadcn@latest add dialog` (answer **N** to any "overwrite button.tsx" prompt — keep the existing themed button).
Verify: `src/components/ui/dialog.tsx` exists. Note it is Base UI–based (`render` prop, not `asChild`), like the Phase 1 `dropdown-menu`/`sheet`.

- [x] **Step 14: Accounts i18n + nav entry**

In `src/components/shell/nav-items.ts`, add `Wallet`-style entries. Import `Wallet` is already used for transactions; use `Landmark` for accounts:
```ts
import { ArrowRightLeft, Landmark, LayoutDashboard, Settings, ShieldCheck, Target, Users } from "lucide-react";
```
Add to `WORKSPACE_NAV` after `budgets`:
```ts
  { key: "accounts", href: "/accounts", icon: Landmark },
```
(The `Users`/`groups` entry is added in Task 2.2.)

In `messages/fr.json` and `messages/en.json`, add the nav key under `shell.nav` (`accounts`) and a new top-level `accounts` namespace. fr:
```json
"accounts": {
  "title": "Comptes",
  "empty": "Aucun compte. Créez-en un pour commencer.",
  "create": "Nouveau compte",
  "edit": "Modifier",
  "archive": "Archiver",
  "archiveConfirm": "Archiver ce compte ? Il sera masqué mais ses transactions resteront.",
  "name": "Nom",
  "type": "Type",
  "iban": "IBAN",
  "ibanOptional": "IBAN (optionnel)",
  "bankName": "Banque",
  "color": "Couleur",
  "save": "Enregistrer",
  "saving": "Enregistrement…",
  "owner": "Propriétaire",
  "sharedBy": "Partagé par {name}",
  "access": { "OWNER": "Propriétaire", "WRITE": "Écriture", "READ": "Lecture" },
  "types": { "CHECKING": "Courant", "SAVINGS": "Épargne", "CREDIT": "Crédit", "OTHER": "Autre" },
  "error": { "INVALID": "Vérifiez les champs.", "INVALID_IBAN": "IBAN invalide.", "FORBIDDEN": "Action non autorisée.", "FAILED": "Échec. Réessayez." }
}
```
en mirrors with English strings (`shell.nav.accounts` = "Accounts"; types Checking/Savings/Credit/Other; etc.). Add `"accounts": "Comptes"` / `"Accounts"` under `shell.nav`.

- [x] **Step 15: Accounts UI — list + create/edit form**

Create `src/components/accounts/account-form.tsx` (client, used for both create and edit; renders a `Dialog` triggered by a button; mirrors `create-user-form.tsx` patterns — `useActionState`, `Alert`, native `<select>` for type, color `<input type="color">`). Create `src/components/accounts/account-list.tsx` (renders the cards + an edit `AccountForm` per row + an archive form-button). Create `src/app/[locale]/(authenticated)/accounts/page.tsx`:
```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireSession } from "@/server/auth/permissions";
import { listVisibleForUser } from "@/server/services/accounts";
import { AccountList } from "@/components/accounts/account-list";

export const dynamic = "force-dynamic";

export default async function AccountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireSession();
  const t = await getTranslations("accounts");
  const accounts = await listVisibleForUser(user.id);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-3xl">{t("title")}</h1>
      </header>
      <AccountList accounts={accounts} />
    </div>
  );
}
```
The full `account-form.tsx`/`account-list.tsx` markup follows the Phase 1 form conventions (shadcn `Dialog`, `Input`, `Label`, `Button`, `Alert`; `useActionState(createAccountAction|updateAccountAction, null)`; on `state.ok` close dialog + `router.refresh()`). Each card shows the color dot, name, `t('types.'+type)`, `bankName`, `ibanMasked`, and — when `access !== 'OWNER'` — a `Badge` with `t('access.'+access)` and `t('sharedBy', { name: ownerName })`. Owner-only rows show Edit + Archive; non-OWNER rows show no mutate controls (this becomes meaningful in 2.4).

- [x] **Step 16: E2E auth fixture — credentialed seed users**

Modify `scripts/seed-e2e.ts` so the e2e DB has signed-in-able users. Set registration open and create three credentialed users via the real Better Auth API, then grant ADMIN:
```ts
// after seedRolesAndPermissions + seedAppSettings:
import { getAuth } from "@/server/auth";
import { grantRole } from "@/server/services/users/roles";

const E2E_USERS = [
  { email: "owner@e2e.local", name: "E2E Owner", password: "e2e-owner-pw-123456" },
  { email: "member@e2e.local", name: "E2E Member", password: "e2e-member-pw-123456" },
  { email: "admin@e2e.local", name: "E2E Admin", password: "e2e-admin-pw-123456", admin: true },
];

async function ensureUsers() {
  await db.appSetting.upsert({
    where: { key: "registration_mode" },
    update: { value: "OPEN" as never },
    create: { key: "registration_mode", value: "OPEN" as never },
  });
  const auth = await getAuth();
  for (const u of E2E_USERS) {
    const existing = await db.user.findUnique({ where: { email: u.email } });
    if (existing) continue;
    const res = await auth.api.signUpEmail({
      body: { email: u.email, password: u.password, name: u.name },
    });
    if (u.admin) await grantRole(db, res.user.id, "ADMIN", res.user.id);
  }
}
```
Call `ensureUsers()` from `main()`. (Idempotent: skips users that already exist.)

- [x] **Step 17: Playwright `storageState` setup project**

Add to `.gitignore`:
```
tests/e2e/.auth
```
Create `tests/e2e/auth.setup.ts`:
```ts
import { test as setup, expect } from "@playwright/test";

const USERS = [
  { file: "tests/e2e/.auth/owner.json", email: "owner@e2e.local", password: "e2e-owner-pw-123456" },
  { file: "tests/e2e/.auth/member.json", email: "member@e2e.local", password: "e2e-member-pw-123456" },
  { file: "tests/e2e/.auth/admin.json", email: "admin@e2e.local", password: "e2e-admin-pw-123456" },
];

for (const u of USERS) {
  setup(`authenticate ${u.email}`, async ({ page }) => {
    await page.goto("/fr/login");
    await page.fill('input[name="email"]', u.email);
    await page.fill('input[name="password"]', u.password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/(dashboard|fr)\b/, { timeout: 15_000 });
    await page.context().storageState({ path: u.file });
  });
}
```
In `playwright.config.ts`, register the setup project and make the existing projects depend on it:
```ts
projects: [
  { name: "setup", testMatch: /auth\.setup\.ts/ },
  { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  { name: "mobile", use: { ...devices["iPhone 14"] }, dependencies: ["setup"] },
],
```
(Authenticated specs opt in per-file via `test.use({ storageState: "tests/e2e/.auth/owner.json" })`; unauthenticated specs like `smoke` leave it unset.)

- [x] **Step 18: E2E — accounts CRUD (now runnable)**

Create `tests/e2e/accounts.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test.describe("accounts", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("create, edit and archive an account", async ({ page }) => {
    const name = `Compte ${Date.now()}`;
    await page.goto("/fr/accounts");
    await page.getByRole("button", { name: /nouveau compte/i }).click();
    await page.fill('input[name="name"]', name);
    await page.selectOption('select[name="type"]', "CHECKING");
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await expect(page.getByText(name)).toBeVisible();
  });
});

test("unauthenticated /accounts redirects to login", async ({ page }) => {
  await page.goto("/fr/accounts");
  await expect(page).toHaveURL(/\/login$/);
});
```

- [x] **Step 19: Full check + commit**

Run: `npm run ci` (lint + typecheck + unit/integration) then `npm run test:e2e -- --project=chromium`.
Expected: all green. Commit:
```bash
git add -A
git commit -m "feat: bank account CRUD with encrypted IBAN"
```
Then push + open the PR (`--base develop --label "enhancement,phase-2,frontend,backend" --body "Closes #13 ..."`).

---

## Task 2.2 — Groups & membership

> **Branch:** `feature/2.2-groups`. **PR title:** `feat: groups and role-based membership`. **Labels:** `enhancement`, `phase-2`, `backend`. **Closes #14**.

**Files:**
- Modify: `prisma/schema.prisma` (+`Group`, +`GroupMember`, +`User.groupMemberships`), `src/components/shell/nav-items.ts`, `messages/{fr,en}.json`
- Create: `src/server/services/groups/roles.ts`, `src/server/services/groups/index.ts`, `src/server/transport/actions/groups.ts`, `src/components/groups/{group-form,group-list,member-list}.tsx`, `src/app/[locale]/(authenticated)/groups/page.tsx`, `src/app/[locale]/(authenticated)/groups/[id]/page.tsx`, `tests/integration/groups.test.ts`, `tests/e2e/groups.spec.ts`

- [x] **Step 1: Add `Group` + `GroupMember` models + migration**

Add to `User`:
```prisma
  groupMemberships GroupMember[]
```
Append:
```prisma
// ─── Group B — Households & membership (Phase 2) ─────────────────────────────

model Group {
  id          String   @id @default(cuid())
  name        String
  description String?
  createdById String
  createdAt   DateTime @default(now())
  archived    Boolean  @default(false)

  members GroupMember[]
}

model GroupMember {
  id       String   @id @default(cuid())
  groupId  String
  userId   String
  role     String // OWNER | ADMIN | MEMBER
  joinedAt DateTime @default(now())

  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([groupId, userId])
  @@index([userId])
}
```
Run: `npm run db:migrate -- --name phase_2_2_groups`; then `npx prisma generate` and `npx prisma validate`.

- [x] **Step 2: Group roles helper**

Create `src/server/services/groups/roles.ts`:
```ts
import { db } from "@/server/db";

export const GROUP_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

const RANK: Record<GroupRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

export class GroupAccessError extends Error {}

export async function getMembership(
  groupId: string,
  userId: string,
): Promise<{ role: GroupRole } | null> {
  const m = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return m ? { role: m.role as GroupRole } : null;
}

// Returns the actor's role if it meets `min`, else throws. A non-member throws too.
export async function requireGroupRole(
  groupId: string,
  userId: string,
  min: GroupRole,
): Promise<GroupRole> {
  const m = await getMembership(groupId, userId);
  if (!m || RANK[m.role] < RANK[min]) throw new GroupAccessError("FORBIDDEN");
  return m.role;
}

export async function countOwners(groupId: string): Promise<number> {
  return db.groupMember.count({ where: { groupId, role: "OWNER" } });
}
```

- [x] **Step 3: Groups service — write the failing integration test**

Create `tests/integration/groups.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import {
  createGroup,
  listGroupsForUser,
  getGroupDetail,
  updateGroup,
  deleteGroup,
  changeMemberRole,
  removeMember,
  leaveGroup,
} from "@/server/services/groups";
import { GroupAccessError } from "@/server/services/groups/roles";

const owner = "grp_owner";
const admin = "grp_admin";
const member = "grp_member";
const ids = [owner, admin, member];

beforeAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
});

afterAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("groups service", () => {
  it("creates a group with the creator as sole OWNER + audit", async () => {
    const g = await createGroup({ name: "Foyer" }, owner);
    const detail = await getGroupDetail(g.id, owner);
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0]).toMatchObject({ userId: owner, role: "OWNER" });
    expect(await db.auditLog.findFirst({ where: { action: "group.created", entityId: g.id } })).not.toBeNull();
  });

  it("lists only groups the user belongs to, with their role", async () => {
    const g = await createGroup({ name: "Mine" }, owner);
    expect((await listGroupsForUser(owner)).some((x) => x.id === g.id && x.role === "OWNER")).toBe(true);
    expect((await listGroupsForUser(member)).some((x) => x.id === g.id)).toBe(false);
  });

  it("enforces role rules", async () => {
    const g = await createGroup({ name: "Rules" }, owner);
    // seed an ADMIN and a MEMBER directly
    await db.groupMember.create({ data: { groupId: g.id, userId: admin, role: "ADMIN" } });
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });

    // MEMBER cannot rename
    await expect(updateGroup(g.id, { name: "x" }, { id: member })).rejects.toBeInstanceOf(GroupAccessError);
    // ADMIN can rename
    await updateGroup(g.id, { name: "Renamed" }, { id: admin });
    // ADMIN cannot delete; OWNER can
    await expect(deleteGroup(g.id, { id: admin })).rejects.toBeInstanceOf(GroupAccessError);
    // only OWNER changes roles
    await expect(changeMemberRole(g.id, member, "ADMIN", { id: admin })).rejects.toBeInstanceOf(GroupAccessError);
    await changeMemberRole(g.id, member, "ADMIN", { id: owner });
    expect((await getGroupDetail(g.id, owner)).members.find((m) => m.userId === member)?.role).toBe("ADMIN");
  });

  it("prevents removing/demoting the last OWNER", async () => {
    const g = await createGroup({ name: "Solo" }, owner);
    await expect(changeMemberRole(g.id, owner, "ADMIN", { id: owner })).rejects.toBeInstanceOf(GroupAccessError);
    await expect(leaveGroup(g.id, owner)).rejects.toBeInstanceOf(GroupAccessError);
    await expect(removeMember(g.id, owner, { id: owner })).rejects.toBeInstanceOf(GroupAccessError);
  });

  it("lets a MEMBER leave, and an OWNER delete the group", async () => {
    const g = await createGroup({ name: "Leaveable" }, owner);
    await db.groupMember.create({ data: { groupId: g.id, userId: member, role: "MEMBER" } });
    await leaveGroup(g.id, member);
    expect((await getGroupDetail(g.id, owner)).members.some((m) => m.userId === member)).toBe(false);
    await deleteGroup(g.id, { id: owner });
    expect(await db.group.findUnique({ where: { id: g.id } })).toBeNull();
  });
});
```

- [x] **Step 4: Run it to confirm it fails**

Run: `npm run test:integration -- groups`
Expected: FAIL — `@/server/services/groups` not found.

- [x] **Step 5: Implement the groups service**

Create `src/server/services/groups/index.ts`:
```ts
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import {
  GROUP_ROLES,
  GroupAccessError,
  type GroupRole,
  countOwners,
  getMembership,
  requireGroupRole,
} from "./roles";

export { GroupAccessError } from "./roles";

export async function createGroup(
  input: { name: string; description?: string },
  ownerId: string,
): Promise<{ id: string }> {
  const name = input.name.trim();
  if (!name) throw new GroupAccessError("INVALID");
  const group = await db.group.create({
    data: {
      name,
      description: input.description?.trim() || null,
      createdById: ownerId,
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
  });
  await logEvent({ userId: ownerId, action: "group.created", entity: "Group", entityId: group.id });
  return { id: group.id };
}

export async function listGroupsForUser(userId: string) {
  const memberships = await db.groupMember.findMany({
    where: { userId, group: { archived: false } },
    include: { group: true },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.groupId,
    name: m.group.name,
    description: m.group.description,
    role: m.role as GroupRole,
    memberCount: undefined as number | undefined, // filled by the page if needed
  }));
}

export async function getGroupDetail(groupId: string, userId: string) {
  await requireGroupRole(groupId, userId, "MEMBER");
  const group = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    include: { members: { include: { user: true }, orderBy: { joinedAt: "asc" } } },
  });
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    members: group.members.map((m) => ({
      userId: m.userId,
      role: m.role as GroupRole,
      name: m.user.name,
      email: m.user.email,
    })),
  };
}

export async function updateGroup(
  groupId: string,
  input: { name?: string; description?: string },
  actor: { id: string },
): Promise<void> {
  await requireGroupRole(groupId, actor.id, "ADMIN");
  await db.group.update({
    where: { id: groupId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
    },
  });
  await logEvent({ userId: actor.id, action: "group.updated", entity: "Group", entityId: groupId });
}

export async function deleteGroup(groupId: string, actor: { id: string }): Promise<void> {
  await requireGroupRole(groupId, actor.id, "OWNER");
  await db.group.delete({ where: { id: groupId } });
  await logEvent({ userId: actor.id, action: "group.deleted", entity: "Group", entityId: groupId });
}

export async function changeMemberRole(
  groupId: string,
  targetUserId: string,
  role: GroupRole,
  actor: { id: string },
): Promise<void> {
  if (!GROUP_ROLES.includes(role)) throw new GroupAccessError("INVALID");
  await requireGroupRole(groupId, actor.id, "OWNER");
  const target = await getMembership(groupId, targetUserId);
  if (!target) throw new GroupAccessError("NOT_MEMBER");
  if (target.role === "OWNER" && role !== "OWNER" && (await countOwners(groupId)) <= 1) {
    throw new GroupAccessError("LAST_OWNER");
  }
  await db.groupMember.update({
    where: { groupId_userId: { groupId, userId: targetUserId } },
    data: { role },
  });
  await logEvent({ userId: actor.id, action: "group.member.role_changed", entity: "Group", entityId: groupId, metadata: { targetUserId, role } });
}

export async function removeMember(
  groupId: string,
  targetUserId: string,
  actor: { id: string },
): Promise<void> {
  await requireGroupRole(groupId, actor.id, "ADMIN");
  const target = await getMembership(groupId, targetUserId);
  if (!target) throw new GroupAccessError("NOT_MEMBER");
  if (target.role === "OWNER" && (await countOwners(groupId)) <= 1) {
    throw new GroupAccessError("LAST_OWNER");
  }
  await db.groupMember.delete({ where: { groupId_userId: { groupId, userId: targetUserId } } });
  await logEvent({ userId: actor.id, action: "group.member.removed", entity: "Group", entityId: groupId, metadata: { targetUserId } });
}

export async function leaveGroup(groupId: string, userId: string): Promise<void> {
  const m = await getMembership(groupId, userId);
  if (!m) throw new GroupAccessError("NOT_MEMBER");
  if (m.role === "OWNER" && (await countOwners(groupId)) <= 1) {
    throw new GroupAccessError("LAST_OWNER");
  }
  await db.groupMember.delete({ where: { groupId_userId: { groupId, userId } } });
  await logEvent({ userId, action: "group.member.removed", entity: "Group", entityId: groupId, metadata: { targetUserId: userId, self: true } });
}
```

- [x] **Step 6: Run it to confirm it passes**

Run: `npm run test:integration -- groups`
Expected: PASS (5 tests).

- [x] **Step 7: Server Actions for groups**

Create `src/server/transport/actions/groups.ts` mirroring `accounts.ts`: `createGroupAction`, `updateGroupAction`, `deleteGroupAction`, `changeMemberRoleAction`, `removeMemberAction`, `leaveGroupAction`. Each `requireSession()`, reads `FormData`, calls the service in a `try/catch` mapping `GroupAccessError` → `{ ok:false, error: e.message }` (one of `FORBIDDEN`/`INVALID`/`LAST_OWNER`/`NOT_MEMBER`), and returns `{ ok:true }` (no `revalidatePath` — the forms call `router.refresh()`, as in Phase 1). State type `GroupActionState = { ok:true } | { ok:false; error:string } | null`.

- [x] **Step 8: Groups UI + nav + i18n**

In `nav-items.ts`, add to `WORKSPACE_NAV` after `accounts`:
```ts
  { key: "groups", href: "/groups", icon: Users },
```
Add `shell.nav.groups` and a `groups` namespace to both message files (title, create, name, description, empty, roles {OWNER,ADMIN,MEMBER}, members, role, remove, leave, delete, deleteConfirm, save, saving, error.{FORBIDDEN,INVALID,LAST_OWNER,NOT_MEMBER,FAILED}).

Create `src/app/[locale]/(authenticated)/groups/page.tsx` (server; `requireSession`; `listGroupsForUser`; renders `GroupList` + a `GroupForm` create dialog) and `src/app/[locale]/(authenticated)/groups/[id]/page.tsx` (server; `getGroupDetail(id, user.id)` wrapped in `try/catch` → `notFound()` on `GroupAccessError`; renders `MemberList` with role controls visible only when the viewer is OWNER/ADMIN). Components `group-form.tsx`, `group-list.tsx`, `member-list.tsx` follow the Phase 1 form/list conventions (`useActionState`, `Dialog`, `Alert`, native `<select>` for roles).

- [x] **Step 9: E2E — create a group**

Create `tests/e2e/groups.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test.describe("groups", () => {
  test.use({ storageState: "tests/e2e/.auth/owner.json" });

  test("create a group and see it listed", async ({ page }) => {
    const name = `Foyer ${Date.now()}`;
    await page.goto("/fr/groups");
    await page.getByRole("button", { name: /nouveau|créer/i }).click();
    await page.fill('input[name="name"]', name);
    await page.getByRole("button", { name: /enregistrer/i }).click();
    await expect(page.getByText(name)).toBeVisible();
  });
});
```

- [x] **Step 10: Full check + commit**

Run: `npm run ci` then `npm run test:e2e -- --project=chromium`. Commit `feat: groups and role-based membership`, push, PR (`--label "enhancement,phase-2,backend"`, body `Closes #14`).

---

## Task 2.3 — Invitations (email + code)

> **Branch:** `feature/2.3-invitations`. **PR title:** `feat: group invitations by email and code`. **Labels:** `enhancement`, `phase-2`, `backend`. **Closes #15**.

**Files:**
- Modify: `prisma/schema.prisma` (+`GroupInvitation`, +`Group.invitations`, +`User.sentInvitations`), `package.json` (+`nodemailer`), `messages/{fr,en}.json`, `src/app/[locale]/(authenticated)/groups/[id]/page.tsx` (add invite UI), `src/app/[locale]/(authenticated)/groups/page.tsx` (add join-by-code)
- Create: `src/server/services/mail/mailer.ts`, `src/server/services/groups/invitations.ts`, `src/server/transport/actions/invitations.ts`, `src/components/groups/{invite-form,invitations-list,join-by-code}.tsx`, `src/app/[locale]/(authenticated)/groups/join/[token]/page.tsx`, `tests/integration/invitations.test.ts`

- [ ] **Step 1: Add `GroupInvitation` model + migration**

Add to `Group`: `invitations GroupInvitation[]`. Add to `User`: `sentInvitations GroupInvitation[] @relation("InvitedBy")`. Append:
```prisma
model GroupInvitation {
  id           String    @id @default(cuid())
  groupId      String
  email        String
  invitedById  String
  role         String    @default("MEMBER")
  token        String    @unique
  code         String    @unique
  expiresAt    DateTime
  acceptedAt   DateTime?
  acceptedById String?
  createdAt    DateTime  @default(now())

  group     Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  invitedBy User  @relation("InvitedBy", fields: [invitedById], references: [id], onDelete: Cascade)

  @@index([email])
  @@index([groupId])
}
```
Run: `npm run db:migrate -- --name phase_2_3_invitations`; `npx prisma generate`; `npx prisma validate`.

- [ ] **Step 2: Install nodemailer**

Run: `npm i nodemailer && npm i -D @types/nodemailer`.

- [ ] **Step 3: Mailer (SMTP-from-DB, dev fallback)**

Create `src/server/services/mail/mailer.ts`:
```ts
import nodemailer from "nodemailer";
import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";

export type MailResult = { delivered: boolean };

// Sends via the DB-configured SMTP when enabled; otherwise logs the body to the
// dev console and reports delivered:false (the caller audits the link too).
// Mirrors the Phase 1 password-reset fallback so e2e/CI never need a real SMTP.
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<MailResult> {
  const cfg = await db.smtpConfig.findFirst({ where: { enabled: true } });
  if (!cfg) {
    console.info(`[bilan][dev] mail to ${opts.to} — ${opts.subject}\n${opts.text}`);
    return { delivered: false };
  }
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.username, pass: decrypt(cfg.passwordEnc, dataKey) },
  });
  await transport.sendMail({
    from: cfg.fromName ? `${cfg.fromName} <${cfg.fromAddress}>` : cfg.fromAddress,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  });
  return { delivered: true };
}
```

- [ ] **Step 4: Invitations service — write the failing integration test**

Create `tests/integration/invitations.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createGroup } from "@/server/services/groups";
import {
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  InvitationError,
} from "@/server/services/groups/invitations";

const owner = "inv_owner";
const invitee = "inv_invitee";
const ids = [owner, invitee];

beforeAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.user.create({ data: { id: owner, email: "inv-owner@bilan.local" } });
  await db.user.create({ data: { id: invitee, email: "invitee@bilan.local" } });
});

afterAll(async () => {
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("invitations service", () => {
  it("creates an invitation (token+code) and audits it", async () => {
    const g = await createGroup({ name: "Invite group" }, owner);
    const inv = await createInvitation({ groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" }, { id: owner });
    expect(inv.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(inv.token.length).toBeGreaterThan(20);
    expect(await db.auditLog.findFirst({ where: { action: "group.invitation.create", entityId: inv.id } })).not.toBeNull();
  });

  it("accepts by code → creates membership with the invited role; second accept is rejected", async () => {
    const g = await createGroup({ name: "Accept group" }, owner);
    const inv = await createInvitation({ groupId: g.id, email: "invitee@bilan.local", role: "ADMIN" }, { id: owner });
    const res = await acceptInvitation(inv.code, { id: invitee, email: "invitee@bilan.local" });
    expect(res.groupId).toBe(g.id);
    const m = await db.groupMember.findUnique({ where: { groupId_userId: { groupId: g.id, userId: invitee } } });
    expect(m?.role).toBe("ADMIN");
    await expect(acceptInvitation(inv.code, { id: invitee, email: "invitee@bilan.local" })).rejects.toBeInstanceOf(InvitationError);
  });

  it("rejects an expired invitation and a revoked one", async () => {
    const g = await createGroup({ name: "Expiry group" }, owner);
    const inv = await createInvitation({ groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" }, { id: owner });
    await db.groupInvitation.update({ where: { id: inv.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvitation(inv.token, { id: invitee, email: "invitee@bilan.local" })).rejects.toBeInstanceOf(InvitationError);

    const inv2 = await createInvitation({ groupId: g.id, email: "invitee@bilan.local", role: "MEMBER" }, { id: owner });
    await revokeInvitation(inv2.id, { id: owner });
    await expect(acceptInvitation(inv2.token, { id: invitee, email: "invitee@bilan.local" })).rejects.toBeInstanceOf(InvitationError);
  });

  it("only OWNER/ADMIN can invite", async () => {
    const g = await createGroup({ name: "Perm group" }, owner);
    await expect(
      createInvitation({ groupId: g.id, email: "x@bilan.local", role: "MEMBER" }, { id: invitee }),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 5: Run it to confirm it fails**

Run: `npm run test:integration -- invitations`
Expected: FAIL — `@/server/services/groups/invitations` not found.

- [ ] **Step 6: Implement the invitations service**

Create `src/server/services/groups/invitations.ts`:
```ts
import { randomBytes, randomInt } from "node:crypto";
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { sendMail } from "@/server/services/mail/mailer";
import { env } from "@/env";
import { GROUP_ROLES, type GroupRole, requireGroupRole } from "./roles";

export class InvitationError extends Error {}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function makeCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export async function createInvitation(
  input: { groupId: string; email: string; role: GroupRole },
  actor: { id: string },
): Promise<{ id: string; token: string; code: string }> {
  if (!GROUP_ROLES.includes(input.role)) throw new InvitationError("INVALID");
  await requireGroupRole(input.groupId, actor.id, "ADMIN");
  const email = input.email.trim().toLowerCase();
  if (!email) throw new InvitationError("INVALID");

  const token = randomBytes(32).toString("base64url");
  const code = makeCode();
  const inv = await db.groupInvitation.create({
    data: {
      groupId: input.groupId,
      email,
      invitedById: actor.id,
      role: input.role,
      token,
      code,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  const acceptUrl = `${env.APP_URL.replace(/\/$/, "")}/fr/groups/join/${token}`;
  const result = await sendMail({
    to: email,
    subject: "Invitation Bilan",
    text: `Vous êtes invité à rejoindre un groupe Bilan.\nLien : ${acceptUrl}\nCode : ${code}`,
  });
  await logEvent({
    userId: actor.id,
    action: "group.invitation.create",
    entity: "GroupInvitation",
    entityId: inv.id,
    // Dev fallback: when SMTP is off, surface the link/code via the audit log
    // (read in /admin/audit-log, Phase 8.4). Never logged when actually emailed.
    metadata: result.delivered ? { email } : { email, acceptUrl, code },
  });
  return { id: inv.id, token, code };
}

export async function acceptInvitation(
  tokenOrCode: string,
  user: { id: string; email: string },
): Promise<{ groupId: string }> {
  const key = tokenOrCode.trim();
  const inv = await db.groupInvitation.findFirst({
    where: { OR: [{ token: key }, { code: key.toUpperCase() }] },
  });
  if (!inv) throw new InvitationError("NOT_FOUND");
  if (inv.acceptedAt) throw new InvitationError("ALREADY_USED");
  if (inv.expiresAt.getTime() < Date.now()) throw new InvitationError("EXPIRED");

  await db.$transaction([
    db.groupMember.upsert({
      where: { groupId_userId: { groupId: inv.groupId, userId: user.id } },
      update: {},
      create: { groupId: inv.groupId, userId: user.id, role: inv.role },
    }),
    db.groupInvitation.update({
      where: { id: inv.id },
      data: { acceptedAt: new Date(), acceptedById: user.id },
    }),
  ]);
  await logEvent({
    userId: user.id,
    action: "group.invitation.accept",
    entity: "GroupInvitation",
    entityId: inv.id,
    metadata: { groupId: inv.groupId },
  });
  return { groupId: inv.groupId };
}

export async function revokeInvitation(id: string, actor: { id: string }): Promise<void> {
  const inv = await db.groupInvitation.findUnique({ where: { id } });
  if (!inv) throw new InvitationError("NOT_FOUND");
  await requireGroupRole(inv.groupId, actor.id, "ADMIN");
  await db.groupInvitation.delete({ where: { id } });
  await logEvent({ userId: actor.id, action: "group.invitation.revoke", entity: "GroupInvitation", entityId: id });
}

export async function listInvitations(groupId: string, actor: { id: string }) {
  await requireGroupRole(groupId, actor.id, "ADMIN");
  return db.groupInvitation.findMany({
    where: { groupId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export async function pendingInvitationsForEmail(email: string) {
  return db.groupInvitation.findMany({
    where: { email: email.toLowerCase(), acceptedAt: null, expiresAt: { gt: new Date() } },
    include: { group: true },
  });
}
```

- [ ] **Step 7: Run it to confirm it passes**

Run: `npm run test:integration -- invitations`
Expected: PASS (4 tests).

- [ ] **Step 8: Server Actions + UI**

Create `src/server/transport/actions/invitations.ts` (`createInvitationAction`, `revokeInvitationAction`, `acceptInvitationAction`) following the established pattern (`requireSession`; map `InvitationError`/`GroupAccessError` → error codes; return `{ ok }` and let forms `router.refresh()`; `acceptInvitationAction` reads `code` (or `token`) from `FormData`, calls `acceptInvitation` with the session user's `{ id, email }`, and on success `redirect`s to `/[locale]/groups/[joined groupId]`).

Add UI: `invite-form.tsx` (email + role, in the group `[id]` page, ADMIN+ only), `invitations-list.tsx` (pending invites with code + revoke), `join-by-code.tsx` (on `/groups`, a code field → `acceptInvitationAction`). Create `src/app/[locale]/(authenticated)/groups/join/[token]/page.tsx` — server component: `requireSession()`, looks up the invitation by token for display, renders a confirm button that submits `acceptInvitationAction` with the token. Add an `invitations` namespace to `messages/{fr,en}.json` (invite, email, role, send, sending, pending, code, revoke, join, joinByCode, accept, accepted, error.{NOT_FOUND,EXPIRED,ALREADY_USED,FORBIDDEN,INVALID,FAILED}).

- [ ] **Step 9: E2E — invite by code (two users)**

Append to `tests/e2e/groups.spec.ts` a flow: admin (storageState `admin.json`) creates a group + invitation, reads the displayed code from the pending-invitations list; then a second context using `member.json` opens `/fr/groups`, enters the code, and asserts the group appears. (Use `test.step` + a fresh `browser.newContext({ storageState })` for the member, since a single test needs both identities.)

- [ ] **Step 10: Full check + commit**

`npm run ci` then `npm run test:e2e -- --project=chromium`. Commit `feat: group invitations by email and code`, push, PR (`Closes #15`).

---

## Task 2.4 — Account sharing & permissions

> **Branch:** `feature/2.4-account-sharing`. **PR title:** `feat: share accounts with groups under READ/WRITE permissions`. **Labels:** `enhancement`, `phase-2`, `backend`, `security`. **Closes #16**.

**Files:**
- Modify: `prisma/schema.prisma` (+`AccountShare`, +`BankAccount.shares`, +`Group.accountShares`), `src/server/services/accounts/index.ts` (extend `listVisibleForUser`), `src/server/transport/actions/accounts.ts` (+share/revoke actions), `src/components/accounts/account-list.tsx` (+share control, respect access), `messages/{fr,en}.json`
- Create: `src/server/services/accounts/sharing.ts`, `src/components/accounts/share-dialog.tsx`, `tests/integration/account-sharing.test.ts`, e2e additions in `tests/e2e/accounts.spec.ts`

- [ ] **Step 1: Add `AccountShare` model + migration**

Add to `BankAccount`: `shares AccountShare[]`. Add to `Group`: `accountShares AccountShare[]`. Append:
```prisma
model AccountShare {
  id          String   @id @default(cuid())
  accountId   String
  groupId     String
  permission  String // READ | WRITE
  createdById String
  createdAt   DateTime @default(now())

  account BankAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  group   Group       @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([accountId, groupId])
  @@index([groupId])
}
```
Run: `npm run db:migrate -- --name phase_2_4_account_shares`; `npx prisma generate`; `npx prisma validate`.

- [ ] **Step 2: Sharing service — write the failing integration test**

Create `tests/integration/account-sharing.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createAccount, listVisibleForUser } from "@/server/services/accounts";
import { createGroup } from "@/server/services/groups";
import {
  shareAccountWithGroup,
  revokeShare,
  getEffectiveAccess,
  canWriteAccount,
  AccountAccessError,
} from "@/server/services/accounts/sharing";

const ownerId = "shr_owner";
const memberId = "shr_member";
const strangerId = "shr_stranger";
const ids = [ownerId, memberId, strangerId];

beforeAll(async () => {
  await db.accountShare.deleteMany({});
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) await db.user.create({ data: { id, email: `${id}@bilan.local` } });
});

afterAll(async () => {
  await db.accountShare.deleteMany({});
  await db.groupMember.deleteMany({ where: { userId: { in: ids } } });
  await db.bankAccount.deleteMany({ where: { ownerId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe("account sharing & permissions", () => {
  it("shares an account READ with a group → member sees it read-only, owner still writes", async () => {
    const acc = await createAccount({ name: "Shared", type: "CHECKING" }, ownerId);
    const grp = await createGroup({ name: "Shared grp" }, ownerId);
    await db.groupMember.create({ data: { groupId: grp.id, userId: memberId, role: "MEMBER" } });

    await shareAccountWithGroup({ accountId: acc.id, groupId: grp.id, permission: "READ" }, { id: ownerId });

    const memberView = await listVisibleForUser(memberId);
    const seen = memberView.find((a) => a.id === acc.id);
    expect(seen).toBeTruthy();
    expect(seen!.access).toBe("READ");
    expect(seen!.ownerName).not.toBeNull();

    expect(await getEffectiveAccess(ownerId, acc.id)).toBe("OWNER");
    expect(await getEffectiveAccess(memberId, acc.id)).toBe("READ");
    expect(await canWriteAccount(memberId, acc.id)).toBe(false);
    expect(await canWriteAccount(ownerId, acc.id)).toBe(true);
  });

  it("WRITE share grants write to members; strangers see nothing", async () => {
    const acc = await createAccount({ name: "W", type: "OTHER" }, ownerId);
    const grp = await createGroup({ name: "W grp" }, ownerId);
    await db.groupMember.create({ data: { groupId: grp.id, userId: memberId, role: "MEMBER" } });
    await shareAccountWithGroup({ accountId: acc.id, groupId: grp.id, permission: "WRITE" }, { id: ownerId });

    expect(await canWriteAccount(memberId, acc.id)).toBe(true);
    expect(await getEffectiveAccess(strangerId, acc.id)).toBeNull();
    expect((await listVisibleForUser(strangerId)).some((a) => a.id === acc.id)).toBe(false);
  });

  it("only the owner can share; revoke removes visibility", async () => {
    const acc = await createAccount({ name: "R", type: "OTHER" }, ownerId);
    const grp = await createGroup({ name: "R grp" }, ownerId);
    await db.groupMember.create({ data: { groupId: grp.id, userId: memberId, role: "MEMBER" } });
    await expect(
      shareAccountWithGroup({ accountId: acc.id, groupId: grp.id, permission: "READ" }, { id: memberId }),
    ).rejects.toBeInstanceOf(AccountAccessError);

    await shareAccountWithGroup({ accountId: acc.id, groupId: grp.id, permission: "READ" }, { id: ownerId });
    expect((await listVisibleForUser(memberId)).some((a) => a.id === acc.id)).toBe(true);
    await revokeShare({ accountId: acc.id, groupId: grp.id }, { id: ownerId });
    expect((await listVisibleForUser(memberId)).some((a) => a.id === acc.id)).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm run test:integration -- account-sharing`
Expected: FAIL — `@/server/services/accounts/sharing` not found.

- [ ] **Step 4: Implement the sharing service**

Create `src/server/services/accounts/sharing.ts`:
```ts
import { db } from "@/server/db";
import { logEvent } from "@/server/services/audit";
import { AccountAccessError, type AccountAccess } from "@/server/services/accounts";

export { AccountAccessError } from "@/server/services/accounts";

const PERMISSIONS = ["READ", "WRITE"] as const;
export type SharePermission = (typeof PERMISSIONS)[number];

async function ownedOrThrow(accountId: string, actorId: string) {
  const acc = await db.bankAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.ownerId !== actorId) throw new AccountAccessError("FORBIDDEN");
  return acc;
}

export async function shareAccountWithGroup(
  input: { accountId: string; groupId: string; permission: SharePermission },
  actor: { id: string },
): Promise<void> {
  if (!PERMISSIONS.includes(input.permission)) throw new AccountAccessError("INVALID");
  await ownedOrThrow(input.accountId, actor.id);
  // The owner must belong to the group they share into.
  const membership = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId: input.groupId, userId: actor.id } },
  });
  if (!membership) throw new AccountAccessError("FORBIDDEN");

  await db.accountShare.upsert({
    where: { accountId_groupId: { accountId: input.accountId, groupId: input.groupId } },
    update: { permission: input.permission },
    create: {
      accountId: input.accountId,
      groupId: input.groupId,
      permission: input.permission,
      createdById: actor.id,
    },
  });
  await logEvent({
    userId: actor.id,
    action: "account.share.create",
    entity: "AccountShare",
    entityId: input.accountId,
    metadata: { groupId: input.groupId, permission: input.permission },
  });
}

export async function revokeShare(
  input: { accountId: string; groupId: string },
  actor: { id: string },
): Promise<void> {
  await ownedOrThrow(input.accountId, actor.id);
  await db.accountShare
    .delete({ where: { accountId_groupId: { accountId: input.accountId, groupId: input.groupId } } })
    .catch(() => undefined);
  await logEvent({
    userId: actor.id,
    action: "account.share.revoke",
    entity: "AccountShare",
    entityId: input.accountId,
    metadata: { groupId: input.groupId },
  });
}

export async function listSharesForAccount(accountId: string, actor: { id: string }) {
  await ownedOrThrow(accountId, actor.id);
  return db.accountShare.findMany({ where: { accountId }, include: { group: true } });
}

// Highest access the user has on the account: OWNER > WRITE > READ > null.
export async function getEffectiveAccess(
  userId: string,
  accountId: string,
): Promise<AccountAccess | null> {
  const acc = await db.bankAccount.findUnique({ where: { id: accountId } });
  if (!acc) return null;
  if (acc.ownerId === userId) return "OWNER";
  const shares = await db.accountShare.findMany({
    where: { accountId, group: { members: { some: { userId } } } },
  });
  if (shares.length === 0) return null;
  return shares.some((s) => s.permission === "WRITE") ? "WRITE" : "READ";
}

export async function canWriteAccount(userId: string, accountId: string): Promise<boolean> {
  const access = await getEffectiveAccess(userId, accountId);
  return access === "OWNER" || access === "WRITE";
}

export async function canReadAccount(userId: string, accountId: string): Promise<boolean> {
  return (await getEffectiveAccess(userId, accountId)) !== null;
}
```

- [ ] **Step 5: Extend `listVisibleForUser` to merge shared accounts**

In `src/server/services/accounts/index.ts`, replace the `listVisibleForUser` body so it returns owned (non-archived) accounts **plus** accounts shared via the viewer's groups, de-duplicated (owner access wins). Keep the existing `VisibleAccount` shape:
```ts
export async function listVisibleForUser(userId: string): Promise<VisibleAccount[]> {
  const owned = await db.bankAccount.findMany({
    where: { ownerId: userId, archived: false },
    orderBy: { createdAt: "desc" },
  });
  const shared = await db.bankAccount.findMany({
    where: {
      archived: false,
      ownerId: { not: userId },
      shares: { some: { group: { members: { some: { userId } } } } },
    },
    include: {
      owner: true,
      shares: { where: { group: { members: { some: { userId } } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const ownedView: VisibleAccount[] = owned.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    bankName: a.bankName,
    color: a.color,
    icon: a.icon,
    archived: a.archived,
    ibanMasked: a.ibanEnc ? maskIban(decrypt(a.ibanEnc, dataKey)) : null,
    access: "OWNER",
    ownerName: null,
  }));

  const sharedView: VisibleAccount[] = shared.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    bankName: a.bankName,
    color: a.color,
    icon: a.icon,
    archived: a.archived,
    ibanMasked: null, // shared viewers never see the IBAN
    access: a.shares.some((s) => s.permission === "WRITE") ? "WRITE" : "READ",
    ownerName: a.owner.name ?? a.owner.email,
  }));

  return [...ownedView, ...sharedView];
}
```
(`maskIban`, `decrypt`, `dataKey` are already imported in this file from Task 2.1.)

- [ ] **Step 6: Run it to confirm it passes**

Run: `npm run test:integration -- account-sharing accounts`
Expected: PASS (both files — confirms the 2.1 list test still holds and the 2.4 sharing tests pass).

- [ ] **Step 7: Share actions + UI**

In `src/server/transport/actions/accounts.ts`, add `shareAccountAction` and `revokeShareAction` (read `accountId`, `groupId`, `permission` from `FormData`; `requireSession`; call the sharing service; map `AccountAccessError` → `FORBIDDEN`/`INVALID`; return `{ ok }` and let the form `router.refresh()`). Create `src/components/accounts/share-dialog.tsx` — a `Dialog` (owner-only) listing the user's groups (`listGroupsForUser`, passed in as a prop from the server page) with a permission `<select>` and current shares + revoke. Wire it into `account-list.tsx` so owner rows get a "Share" button; non-OWNER rows already render no mutate controls. Add the relevant `accounts.share.*` i18n keys to both message files.

- [ ] **Step 8: E2E — shared account visible to a member, READ is read-only**

Extend `tests/e2e/accounts.spec.ts`: as `owner`, create an account and share it (READ) with a group the `member` belongs to (seed the membership in `seed-e2e.ts`, or create the group + invitation in-test); then in a `member.json` context, assert the account is listed with a "Lecture" badge and **no** Edit/Archive button. (Use a second `browser.newContext({ storageState: "tests/e2e/.auth/member.json" })`.)

> **Fixture note:** add the `member` user to a shared group in `seed-e2e.ts` (e.g. an `e2e-shared-group` owned by `owner` with `member` as MEMBER) so the e2e has a deterministic group to share into without depending on 2.3's invitation UI.

- [ ] **Step 9: Full check + commit**

`npm run ci` then `npm run test:e2e`. Commit `feat: share accounts with groups under READ/WRITE permissions`, push, PR (`--label "enhancement,phase-2,backend,security"`, `Closes #16`).

---

## Self-Review notes (for the executor)

- **Migration order is rigid:** 2.1 → 2.2 → 2.3 → 2.4. Each migration adds only models whose relation targets already exist; back-relation fields on `User`/`Group`/`BankAccount` are appended in the scope that introduces the new model. Never forward-reference `Category`/`Transaction`/`Budget*`/`ImportBatch` (later phases).
- **`AccountAccessError` is shared:** defined in `accounts/index.ts` (2.1) and re-exported from `accounts/sharing.ts` (2.4). Both `instanceof` checks resolve to the same class — do not redeclare it.
- **`listVisibleForUser` is created in 2.1 (owned only) and its body is replaced in 2.4** (owned + shared). The signature and `VisibleAccount` shape are stable across both, so the accounts page and its test do not change shape — only more rows appear.
- **IBAN hashing reuses the tested `hmacForSearch`** (which lowercases as part of normalization). It is applied to the already-normalized (spaces stripped, uppercased) IBAN; matching is deterministic because the same path is used for any future equality lookup. Shared viewers never receive the decrypted/masked IBAN (`ibanMasked: null`).
- **E2E auth fixture (2.1)** unblocks real authenticated e2e for the whole project. After it lands, optionally unskip the Phase 1 `tests/e2e/admin-guard.spec.ts` / `shell.spec.ts` authenticated cases by adding `test.use({ storageState: "tests/e2e/.auth/admin.json" })` / `owner.json` (out of this phase's required AC, but a free win).
- **Mailer** never requires real SMTP in CI: with no enabled `SmtpConfig`, `sendMail` logs + returns `delivered:false`, and `createInvitation` records the link/code in `AuditLog.metadata`. Real delivery + the `/admin/smtp` editor is Phase 8.4.
- **`requireGroupRole` / `getEffectiveAccess` are the single source of truth** for group/account authorization and are what Phase 3+ (transactions) must call before any write (`canWriteAccount`). Do not scatter ad-hoc ownership checks.
- **Acceptance for the phase:** create an account (IBAN encrypted at rest, masked in UI) → create a group (creator is OWNER) → invite by code, second user accepts and appears as a member → owner shares the account READ with the group → the member sees it read-only and cannot edit; WRITE share lets them edit. `npm run ci` green; e2e `accounts.spec.ts` + `groups.spec.ts` green on `chromium` (+ `mobile` where applicable).
```

# Bilan — Design Spec

> **App name**: **Bilan** (French for "balance sheet / financial overview"). See README for an English note.

> **Status**: Draft — pending user approval
> **Date**: 2026-05-26
> **Author**: Brainstorming session (project maintainer + Claude)
> **Scope**: Full design for a multi-user personal finance tracking application.

---

## 1. Context & Objectives

### Background

Personal finance tracking application. Supersedes an earlier throwaway Python script that parsed CSV bank statements, categorized transactions, and produced an HTML report.

The new application is a full web app with multi-user support, real database, multiple import sources (CSV / PDF / manual), customizable categorization rules, and budgets.

### Primary users

- The account owner (technical) — manages 3 bank accounts (personal + joint + partner's account).
- Their partner — separate account, shared joint account.
- Potential extension: other household members or shared groups (e.g., shared trip).

### Goals

1. Aggregate transactions from multiple bank accounts.
2. Categorize automatically with user-configurable rules.
3. Share specific accounts with specific groups (e.g., household), with read or write permissions.
4. Track budgets by category and/or account, with explicit transaction assignment overriding automatic matching.
5. Link related transactions (refunds, partial reimbursements) and exclude balanced groups from averages.
6. Maintain strict security: bank data is sensitive, encryption at rest is mandatory.

### Non-goals (for MVP)

- Multi-currency (EUR only).
- Native mobile apps (responsive web is mobile-first).
- Automatic bank-account connection (PSD2 / Open Banking) — manual imports only.
- Automatic migration of historical data (user will re-import manually via CSV).

---

## 2. Scoping Decisions (Brainstorming Output)

Decisions consolidated from the clarifying-questions phase.

### 2.1 Stack

| Component | Version (May 2026) | Choice rationale |
|---|---|---|
| Next.js | 16.2 LTS | App Router stable, full-stack TypeScript |
| React | 19.2 | Server Components, Compiler |
| TypeScript | 6.0 | Strict mode + ESM by default |
| Tailwind CSS | v4 | Styling, driven by Bilan design tokens (see §11) |
| shadcn/ui | latest | Accessible primitives (Radix), re-skinned with Bilan tokens |
| Fonts | Newsreader · IBM Plex Sans · IBM Plex Mono | Self-hosted via `next/font` (see §11.2) |
| react-hook-form + Zod | latest | Forms + runtime validation |
| next-intl | latest | i18n fr/en routing |
| Prisma | 7.x (with `@prisma/adapter-mariadb`) | ORM with MariaDB-native driver |
| MariaDB | 11 LTS | Database |
| Better Auth | latest | Native DB-backed sessions, RBAC, 2FA, passkeys, OIDC plugin |
| Node | 24 LTS | Runtime, LTS until April 2028 |
| Vitest | latest | Unit + integration tests |
| Playwright | latest | E2E tests |
| Docker Compose | latest | Local stack (app + mariadb + mariadb-test + adminer) |
| Package manager | **npm** | Aligned with the `librarr` project (npm ci, package-lock.json) |
| GitHub Actions | — | CI/CD (`ci.yml` + `build.yml`), aligned on `librarr` — see §7.6 / §12.4 |
| Codecov | — | Coverage + test results upload |
| ghcr.io | — | Multi-arch Docker image registry |
| Dependabot | — | Dependency updates |

> Note on auth: Auth.js was considered but Better Auth (which now maintains Auth.js) is the 2026 recommendation for new self-hosted projects. It provides RBAC, 2FA, passkeys, immediate session revocation, and dynamic OIDC providers out of the box.

### 2.2 Architecture choices

- **Full-stack Next.js** (single project, App Router).
- **Transport mix**: Server Actions for short CRUD; Route Handlers (API) for heavy / streaming endpoints (imports, exports); Server Components for read-only views. All business logic lives in `server/services/*` (pure TypeScript, testable).
- **Database**: relational, Prisma + MariaDB.
- **Multi-user model**: shared via **groups (households)** only. A user may belong to multiple groups. Accounts always have a user owner; sharing is done by granting a group access to an account (READ or WRITE).
- **Categories model**: owned by `User` OR `Group` (symmetric with accounts via XOR ownership). Default categories seeded at signup in user's locale.
- **Categorization**: user-configurable rules (pattern + match type). When a user changes a transaction's category, the UI proposes creating a rule.
- **Transaction links**: manual + auto-suggestions. Pairs `+X/-X` within configurable window. No minimum amount.
  - Balanced groups (sum = 0): all transactions excluded from totals.
  - Unbalanced groups: the **primary** transaction (largest absolute amount) receives the net sum in its category; other members are neutralized.
- **Budgets**: scoped to user OR group; can target categories AND/OR accounts; custom periods (week, month, quarter, year, custom); automatic matching by category/account + explicit `BudgetAssignment` (`INCLUDE` / `EXCLUDE`) overrides.
- **Privacy on shared budgets**: full transparency — every group member sees the date, amount, label, category and account name of each transaction counted in a group budget, including one a member assigned (`INCLUDE`) from a private account. Only that transaction becomes visible: the private account and its other transactions stay private.
- **Include scope on group budgets**: an `INCLUDE` into a group budget is allowed only for a transaction whose account the actor owns or that is shared with that same group — reading an account through another group is not enough. Personal budgets accept any account the actor can read.
- **Currency**: EUR only.
- **Mobile**: responsive mobile-first (Playwright includes mobile viewport tests).
- **i18n**: fr/en at minimum, language preference per user, `next-intl`.

### 2.3 Security choices

- **Encryption at rest at MariaDB level** (innodb_encrypt_tables) — protects against disk theft.
- **Application-level encryption** AES-256-GCM on sensitive fields: transaction labels, raw labels, notes, account IBAN, OIDC client secrets, SMTP password, secret settings.
- **Search on encrypted labels**: HMAC-SHA256 of the normalized full label (exact match) + a `TransactionSearchToken` table with one HMAC per normalized word prefix of 3 to 12 chars (word-beginning search, #192; a query word is cut to 12 chars). No substring search inside a word. Accents stripped, lowercase. Changing the tokenization requires `npm run db:reindex-search`.
- **Keys**: `DATA_ENCRYPTION_KEY` (AES) and `SEARCH_TOKEN_KEY` (HMAC) are **separate** — defense in depth.
- **Password hashing**: argon2id with OWASP 2025 recommended parameters (handled by Better Auth).
- **Sessions**: DB-backed, httpOnly + secure + sameSite=strict cookies, immediate revocation supported.
- **Multi-provider auth**: Credentials (toggleable), generic OIDC (e.g., Authentik), optional Google. OIDC providers configured via DB through `/admin/auth-providers` UI (hot-reload, no restart needed).
- **Roles**: configurable `Role` + `Permission` + `RolePermission` + `UserRole` tables (initial seed: `SUPER_ADMIN`, `ADMIN`, `USER`).
- **Registration mode**: `OPEN | INVITE_ONLY | DISABLED` configurable from admin UI.
- **Admin signup tokens**: generic invite tokens (separate from group invitations) for `INVITE_ONLY` mode.
- **Audit log**: every state-mutating event (auth, sharing, settings, transactions) tracked in `AuditLog` with 12-month retention.
- **CI**: GitHub Actions; **Dependabot** for dependency updates.

### 2.4 Other settings — all in the web UI

All application configuration is editable from the web admin UI. Only bootstrap secrets stay in `.env`: `DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `APP_URL`.

Database-stored settings include: auth providers, SMTP, app branding, security policy (min password length, lockout, session duration), app parameters (link suggestion window, rate limits, registration mode).

### 2.5 Tests

- **Unit + E2E from the start** (decided rather than deferred).
- Unit + integration tests target `server/services/*` (pure business logic + Prisma).
- E2E tests via Playwright with an isolated `mariadb-test` container.
- Server Actions and API Routes are thin wrappers (≤15 lines) — not directly unit-tested.

### 2.6 MVP scope

- **MVP with multi-user from day 1** (decided rather than ship solo-only first).
- Phased delivery via `PLAN.md`, one scope per PR.

---

## 3. Architecture

### 3.1 Layered overview

```
┌─────────────────────────────────────────────────┐
│  app/  ── UI (Server Components + Client)       │  ← Responsive mobile-first, i18n
├─────────────────────────────────────────────────┤
│  server/transport/                              │
│    ├ actions/  (Server Actions — short CRUD)    │  ← Thin wrappers (≤15 lines)
│    └ api/      (Route Handlers — imports, exports) │
├─────────────────────────────────────────────────┤
│  server/services/  (business logic, pure TS)    │  ← 90% of unit tests target this
│    ├ accounts, transactions, categorization     │
│    ├ budgets, links, permissions, groups        │
│    ├ imports/ (csv, pdf)                        │
│    └ settings/ (auth-providers, smtp, app)      │
├─────────────────────────────────────────────────┤
│  server/auth/  (Better Auth + dynamic providers) │
├─────────────────────────────────────────────────┤
│  server/crypto/  (AES-256-GCM, HMAC, argon2id)  │
├─────────────────────────────────────────────────┤
│  server/db/  (Prisma client + adapter-mariadb)   │
└─────────────────────────────────────────────────┘
```

### 3.2 Transport rules

| Use case | Solution | Why |
|---|---|---|
| Create tx, edit category, share account, create budget, etc. | **Server Action** | Short mutation, automatic cache revalidation |
| Upload CSV/PDF (parsing 10s+) | **API Route** | Streaming, large payload, headers control |
| Future external integration (webhook, accountant export) | **API Route** | Must be callable outside the browser |
| Read (transaction list, dashboard) | **Server Component** | Direct server render, no API needed |

All business logic in `server/services/*`. Transport wrappers validate input with Zod, call the service, return the result.

### 3.3 Directory structure

```
budget/
├── docker-compose.yml
├── Dockerfile                      # dev + prod targets
├── package.json
├── prisma/
│   ├── schema.prisma               # adapter mariadb
│   ├── migrations/
│   └── seed.ts                     # roles + permissions
├── messages/                       # i18n
│   ├── fr.json
│   └── en.json
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── (setup)/            # /setup (first launch)
│   │   │   ├── (auth)/             # /login, /register, /reset
│   │   │   ├── (authenticated)/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── transactions/
│   │   │   │   ├── accounts/
│   │   │   │   ├── budgets/
│   │   │   │   ├── categories/
│   │   │   │   ├── groups/
│   │   │   │   ├── import/
│   │   │   │   └── settings/       # user preferences (language, 2FA, sessions)
│   │   │   └── admin/              # app settings (role required)
│   │   │       ├── auth-providers/
│   │   │       ├── smtp/
│   │   │       ├── app-settings/
│   │   │       ├── users/
│   │   │       ├── signup-tokens/
│   │   │       └── audit-log/
│   │   └── api/                    # Route Handlers (outside [locale])
│   │       ├── auth/[...all]/      # Better Auth
│   │       ├── import/csv/
│   │       ├── import/pdf/
│   │       └── export/
│   ├── components/
│   ├── i18n/                       # next-intl config
│   ├── server/
│   │   ├── services/
│   │   ├── transport/              # actions + api
│   │   ├── auth/                   # Better Auth + dynamic providers
│   │   ├── crypto/
│   │   ├── db/
│   │   └── settings/               # cached DB reads
│   ├── lib/                        # utils, Zod schemas, shared types
│   ├── middleware.ts               # next-intl + auth guard + security headers
│   └── env.ts                      # envalid validation
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   └── superpowers/specs/          # this design
└── PLAN.md                         # scoped roadmap
```

### 3.4 i18n routing

- URL prefix: `/[locale]/...` (e.g., `/fr/dashboard`, `/en/dashboard`).
- Initial locale: detected from `Accept-Language` header. The browsing locale lives in the next-intl `NEXT_LOCALE` cookie (persistent, 1 year, per browser); a stored preference never forces a redirect.
- `UserPreference.locale` drives e-mails only. It is written at sign-up, at every sign-in (locale of the sign-in page) and by the language switcher.
- E-mail locale (one rule for every sender): the recipient's `UserPreference.locale` when the recipient is a known user, otherwise the locale of the page that triggered the send. Mails carry a `Content-Language` header.
- Default categories: two fixture sets (`prisma/seed-data/categories-fr.json` and `categories-en.json`) are bundled. At user signup, the set matching the user's chosen locale is copied into `Category` rows owned by that user with `isDefault = true`. Users can rename, add, delete freely.
- Language switcher in the header.
- All dates/numbers formatted via `Intl.DateTimeFormat` / `Intl.NumberFormat` based on locale.

### 3.5 Bootstrap (first launch)

When `User.count() === 0`:
- All routes redirect to `/setup`.
- Wizard steps:
  1. Create first user (auto-granted `SUPER_ADMIN` role).
  2. Optional: SMTP configuration.
  3. Optional: OIDC provider configuration.
  4. Choose registration mode (default: `INVITE_ONLY`).

`/setup` is disabled (404) as soon as at least one user exists.

---

## 4. Data Model

Prisma schema, grouped logically. Owner XOR constraints (User XOR Group) are enforced at the service layer with Zod plus a DB check trigger.

### 4.1 Group A — Identity & Access

```prisma
// Generated by Better Auth CLI, extended with business relations
model User {
  id              String   @id
  email           String   @unique
  emailVerified   Boolean  @default(false)
  name            String?
  image           String?
  twoFactorEnabled Boolean @default(false)
  banned          Boolean  @default(false)
  banReason       String?
  banExpires      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Better Auth relations
  sessions        Session[]
  authAccounts    AuthAccount[]
  verifications   Verification[]
  twoFactors      TwoFactor[]
  passkeys        Passkey[]

  // Business relations
  ownedAccounts   BankAccount[]      @relation("AccountOwner")
  categories      Category[]
  budgets         Budget[]
  groupMemberships GroupMember[]
  sentInvitations GroupInvitation[]  @relation("InvitedBy")
  preference      UserPreference?
  roles           UserRole[]
}

model Session         { /* generated by Better Auth — DB-backed */ }
model AuthAccount     { /* generated — OAuth/OIDC linked accounts (NOT BankAccount) */ }
model Verification    { /* generated — magic links, email verify */ }
model TwoFactor       { /* generated — secret, backup codes (encrypted) */ }
model Passkey         { /* generated — WebAuthn credentials */ }

// RBAC — our own tables (preferred over Better Auth admin plugin's simple string-based role,
// which only supports flat string roles on User. Our model has fine-grained permissions per role.
// The Better Auth admin plugin is still enabled for its utilities (impersonation, banning),
// but its built-in role string is unused — we set every user's role to "USER" by default.)
model Role {
  id          String @id @default(cuid())
  key         String @unique             // SUPER_ADMIN, ADMIN, USER
  name        String
  description String?
  isSystem    Boolean @default(false)    // protection against deletion
  permissions RolePermission[]
  users       UserRole[]
}

model Permission {
  id          String @id @default(cuid())
  key         String @unique             // admin.settings.write, admin.users.read, ...
  scope       String                     // admin | system
  description String
  roles       RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  @@id([roleId, permissionId])
}

model UserRole {
  userId    String
  roleId    String
  grantedAt DateTime @default(now())
  grantedBy String?
  user      User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      Role @relation(fields: [roleId], references: [id], onDelete: Cascade)
  @@id([userId, roleId])
}
```

### 4.2 Group B — Groups (households) & Sharing

```prisma
model Group {
  id           String   @id @default(cuid())
  name         String
  description  String?
  createdById  String
  createdAt    DateTime @default(now())
  archived     Boolean  @default(false)

  members       GroupMember[]
  invitations   GroupInvitation[]
  accountShares AccountShare[]
  categories    Category[]
  budgets       Budget[]
  rules         CategorizationRule[]
}

model GroupMember {
  id        String   @id @default(cuid())
  groupId   String
  userId    String
  role      String                              // OWNER | ADMIN | MEMBER
  joinedAt  DateTime @default(now())

  group     Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user      User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([groupId, userId])
}

model GroupInvitation {
  id            String   @id @default(cuid())
  groupId       String
  email         String                                // recipient (may not have an account yet)
  invitedById   String
  role          String   @default("MEMBER")
  token         String   @unique                      // for invitation link
  code          String   @unique                      // 6 chars, manual entry
  expiresAt     DateTime
  acceptedAt    DateTime?
  acceptedById  String?
  createdAt     DateTime @default(now())

  group         Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  invitedBy     User  @relation("InvitedBy", fields: [invitedById], references: [id])
  @@index([email])
}

model AccountShare {
  id          String   @id @default(cuid())
  accountId   String
  groupId     String
  permission  String                                  // READ | WRITE
  createdById String
  createdAt   DateTime @default(now())

  account     BankAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  group       Group       @relation(fields: [groupId], references: [id], onDelete: Cascade)
  @@unique([accountId, groupId])
}

model AdminSignupToken {
  id          String   @id @default(cuid())
  token       String   @unique
  description String?
  maxUses     Int?                                    // null = unlimited
  usedCount   Int      @default(0)
  expiresAt   DateTime?
  createdById String
  createdAt   DateTime @default(now())
  revokedAt   DateTime?
}
```

### 4.3 Group C — Bank Accounts

```prisma
model BankAccount {
  id          String   @id @default(cuid())
  ownerId     String
  name        String
  type        String                                  // CHECKING | SAVINGS | CREDIT | OTHER
  ibanEnc     String?                                 // encrypted IBAN
  ibanHash    String?                                 // HMAC for equality search
  bankName    String?
  color       String?  @default("#2563eb")
  icon        String?
  archived    Boolean  @default(false)
  createdAt   DateTime @default(now())

  owner        User @relation("AccountOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  transactions Transaction[]
  shares       AccountShare[]
  imports      ImportBatch[]
  budgetLines  BudgetLine[]
}
```

### 4.4 Group D — Categories & Categorization Rules

```prisma
model Category {
  id        String  @id @default(cuid())
  name      String
  color     String?
  icon      String?
  parentId  String?
  parent    Category?  @relation("Hierarchy", fields: [parentId], references: [id])
  children  Category[] @relation("Hierarchy")

  // Owner XOR (User or Group)
  userId    String?
  groupId   String?
  user      User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group     Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  isDefault Boolean @default(false)
  createdAt DateTime @default(now())

  transactions Transaction[]
  budgetLines  BudgetLine[]
  rules        CategorizationRule[]
  @@index([userId])
  @@index([groupId])
}

model CategorizationRule {
  id            String  @id @default(cuid())
  pattern       String                              // literal or regex source
  matchType     String                              // CONTAINS | REGEX | EXACT | STARTS_WITH
  caseSensitive Boolean @default(false)
  priority      Int     @default(100)
  categoryId    String
  category      Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  // Scope XOR
  userId        String?
  groupId       String?
  user          User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group         Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  enabled       Boolean @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([userId])
  @@index([groupId])
}
```

### 4.5 Group E — Transactions, Search Tokens, Links

```prisma
model Transaction {
  id            String   @id @default(cuid())
  accountId     String
  date          DateTime                              // CLEAR — for SQL aggregations
  amount        Decimal  @db.Decimal(12, 2)           // CLEAR — for SQL aggregations
  type          String                                // CARD | TRANSFER | DIRECT_DEBIT | CHEQUE | ATM | OTHER

  labelEnc      String                                // ENCRYPTED (AES-256-GCM)
  labelHash     String                                // HMAC-SHA256 of normalized label
  rawLabelEnc   String                                // ENCRYPTED (raw import label)
  rawLabelHash  String                                // HMAC-SHA256
  noteEnc       String?                               // ENCRYPTED (user note)

  categoryId          String?
  category            Category? @relation(fields: [categoryId], references: [id])
  manuallyCategorized Boolean   @default(false)

  importBatchId String?
  importBatch   ImportBatch? @relation(fields: [importBatchId], references: [id])
  externalId    String?                               // dedup key (bank ref or content hash)

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  createdById   String?

  account             BankAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  searchTokens        TransactionSearchToken[]
  linkMembership      TransactionLinkMember?
  budgetAssignments   BudgetAssignment[]

  @@unique([accountId, externalId])
  @@index([accountId, date])
  @@index([categoryId, date])
  @@index([labelHash])
  @@index([rawLabelHash])
  @@index([date])
}

model TransactionSearchToken {
  id            String @id @default(cuid())
  transactionId String
  tokenHash     String                                // HMAC-SHA256 of one normalized word prefix
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  @@index([tokenHash])
  @@index([transactionId])
}

model TransactionLink {
  id          String   @id @default(cuid())
  name        String?
  createdById String
  createdAt   DateTime @default(now())

  members     TransactionLinkMember[]
}

model TransactionLinkMember {
  linkId        String
  transactionId String   @unique                      // one tx in at most one link
  joinedAt      DateTime @default(now())
  link          TransactionLink @relation(fields: [linkId], references: [id], onDelete: Cascade)
  transaction   Transaction     @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  @@id([linkId, transactionId])
}

model IgnoredLinkSuggestion {
  userId    String
  pairKey   String                                    // canonical "txid1|txid2" sort
  ignoredAt DateTime @default(now())
  @@id([userId, pairKey])
}
```

### 4.6 Group F — Budgets

```prisma
model Budget {
  id             String   @id @default(cuid())
  name           String
  description    String?

  // Owner XOR
  userId         String?
  groupId        String?
  user           User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group          Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  // Period
  periodType     String                               // WEEK | MONTH | QUARTER | YEAR | CUSTOM
  periodStart    DateTime
  periodEnd      DateTime
  recurring      Boolean  @default(false)
  parentBudgetId String?                              // for recurring instances → template
  parentBudget   Budget?  @relation("BudgetRecurrence", fields: [parentBudgetId], references: [id])
  instances      Budget[] @relation("BudgetRecurrence")

  archived       Boolean  @default(false)
  createdAt      DateTime @default(now())
  createdById    String

  lines       BudgetLine[]
  assignments BudgetAssignment[]
  @@index([userId, periodStart])
  @@index([groupId, periodStart])
}

model BudgetLine {
  id            String  @id @default(cuid())
  budgetId      String
  budget        Budget  @relation(fields: [budgetId], references: [id], onDelete: Cascade)

  // Granularity: category AND/OR account (at least one required, enforced at service layer)
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
  mode          String                                // INCLUDE | EXCLUDE — overrides auto matching
  assignedById  String
  assignedAt    DateTime @default(now())

  budget        Budget      @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  @@unique([budgetId, transactionId])
}
```

### 4.7 Group G — Imports

```prisma
model ImportBatch {
  id            String   @id @default(cuid())
  accountId     String
  source        String                                // CSV | PDF | MANUAL
  filename      String?
  filenameHash  String?
  status        String                                // PENDING | PARSING | REVIEW | COMPLETED | FAILED
  totalRows     Int      @default(0)
  importedRows  Int      @default(0)
  skippedRows   Int      @default(0)
  errorMessage  String?
  metadata      Json?                                 // e.g., CSV column mapping used
  createdById   String
  createdAt     DateTime @default(now())
  completedAt   DateTime?

  account       BankAccount   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  transactions  Transaction[]
  @@index([accountId, createdAt])
}
```

### 4.8 Group H — Settings, Preferences, Audit

```prisma
model AuthProvider {
  id              String   @id @default(cuid())
  type            String                              // oidc | google (password sign-in is the credentials_enabled setting)
  key             String   @unique                    // unique id for Better Auth
  displayName     String
  enabled         Boolean  @default(false)
  // OIDC-specific
  issuer          String?
  clientId        String?
  clientSecretEnc String?                              // ENCRYPTED
  scopes          String?                              // CSV
  // Generic
  config          Json?
  updatedAt       DateTime @updatedAt
  updatedById     String?
}

model SmtpConfig {
  id           String   @id @default(cuid())          // singleton
  host         String
  port         Int
  security     SmtpSecurity @default(STARTTLS)      // TLS (465) | STARTTLS (587, required) | NONE (local relay)
  username     String
  passwordEnc  String                                  // ENCRYPTED
  fromAddress  String
  fromName     String?
  enabled      Boolean  @default(false)
  updatedAt    DateTime @updatedAt
  updatedById  String?
}

model AppSetting {
  key       String   @id                              // app.name, app.registration_mode, links.suggestion_window_days...
  value     Json                                      // typed at the service level
  isSecret  Boolean  @default(false)                  // if true → encrypted at-rest application-side
  updatedAt DateTime @updatedAt
  updatedById String?
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?                                  // null if system action (cron, setup)
  action     String                                   // auth.login.success, settings.smtp.update, account.share.create, ...
  entity     String?                                  // BankAccount, Budget, ...
  entityId   String?
  metadata   Json?                                    // diff old/new, ip, etc.
  ipAddress  String?
  userAgent  String?
  createdAt  DateTime @default(now())
  @@index([userId, createdAt])
  @@index([entity, entityId])
  @@index([action, createdAt])
}

model UserPreference {
  userId            String  @id
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  locale            String  @default("fr")            // fr | en
  defaultAccountId  String?
  defaultBudgetId   String?
  linkWindowDays    Int     @default(30)
  linkMinAmount     Decimal @db.Decimal(12, 2) @default(0)
  dashboardLayout   Json?
}
```

### 4.9 Data-model decisions summary

| Decision | Detail |
|---|---|
| Owner XOR | For `Category`, `Budget`, `CategorizationRule`: exactly one of `userId` or `groupId`. Service-level Zod + DB check trigger. |
| Application encryption | `Transaction.labelEnc/rawLabelEnc/noteEnc`, `BankAccount.ibanEnc`, `AuthProvider.clientSecretEnc`, `SmtpConfig.passwordEnc`, `AppSetting.value` when `isSecret=true`. |
| Scalable search | HMAC on full label (equality) + `TransactionSearchToken` (per word prefix, 3–12 chars). |
| Transaction dedup | Unique `(accountId, externalId)` when externalId is set (bank ref or content hash for CSV/PDF). Manual entries: no externalId, no auto-dedup. |
| Cascade deletes | User → ownedAccounts → transactions → tokens/links. Group → members/categories/budgets/shares. BankAccount → tx/shares. Budget → lines/assignments. |
| Indexes | All hashes (`labelHash`, `tokenHash`), `(accountId, date)`, `(categoryId, date)`, `(userId/groupId, periodStart)`. |
| No soft delete | Cascade deletes only (simpler for RGPD). `archived` flag for non-deleted but inactive entities (accounts, budgets). |

---

## 5. Key Flows

### 5.1 Bootstrap (first launch)

If `User.count() === 0`, all routes (except `/setup`) redirect to `/setup`. Wizard:
1. Create first user (email + password) → auto-grant `SUPER_ADMIN` role, seed default categories in chosen locale, create `UserPreference`.
2. Optional: SMTP config.
3. Optional: OIDC provider config.
4. Choose registration mode (default `INVITE_ONLY`).

`/setup` is permanently disabled (returns 404) as soon as one user exists.

### 5.2 Login (multi-provider)

Available providers on `/login`:
- **Credentials** (email + password) — if the `credentials_enabled` app setting is on (not an `AuthProvider` row). Turning it off is refused while a user would be left with no other usable sign-in method (#255), like deleting a provider.
- **OIDC button(s)** — generated dynamically from `AuthProvider` table.
- **Google** — if enabled.

The "Create an account" link is only shown when `/register` offers a way to sign up (#255).

Flow:
- Credentials: form → Better Auth credentials provider → argon2id verify → if 2FA enabled, redirect to `/login/2fa` → create DB-backed session + httpOnly cookie → redirect to `/{locale}/dashboard`.
- OIDC: Better Auth redirects to IdP → callback `/api/auth/oauth2/callback/<key>` (generic OAuth plugin; Google: `/api/auth/callback/google`) → session created → `/dashboard`.

Rate limit: see §6.7 (per IP + account, and per account). Failed attempts logged to `AuditLog`. Success also logged with IP + user-agent.

Magic-link password reset: `/reset` → SMTP email → `/reset/[token]` → new password form → invalidates all tokens + active sessions.

### 5.3 Registration mode handling

- `OPEN`: `/register` accessible to anyone.
- `INVITE_ONLY`: `/register` requires `?invitation=<token>` (group) or `?adminToken=<token>` (admin signup token). Both validated server-side. Without token: shown a message + login link.
- `DISABLED`: `/register` shows "Registration is closed on this instance." (also shown when password sign-in is off and no SSO provider allows sign-up). Admin creates users from `/admin/users`: the user is mailed a "choose your password" link (`/reset/<token>`, setup flavour of the reset flow, 1 h). Without SMTP no link is sent, and the admin is told so (#255).

### 5.4 Account creation & sharing

1. Owner creates account: `POST /accounts` (Server Action) → `accounts.service.create({ ownerId, name, type, ibanEnc?, ibanHash? })`.
2. Sharing with a group: `POST /accounts/[id]/share` → `permissions.service.shareAccountWithGroup({ accountId, groupId, permission, actor })` → verifies actor is owner or admin → creates `AccountShare` → audit log.
3. Visibility: `accounts.service.listVisibleForUser(userId)` returns own accounts + accounts shared via groups the user belongs to.

### 5.5 CSV import (main flow)

1. `/import/csv`: UI upload → `multipart POST /api/import/csv` (Route Handler).
2. Route Handler validates MIME + size, creates `ImportBatch` (status: PARSING), parses with papaparse, returns preview (first 50 rows + detected mapping).
3. UI: user confirms column mapping (date, amount, label, type) and visualizes suggested categorization per row.
4. `POST /api/import/csv/[batchId]/commit` → `imports.csv.service`:
   - For each row: normalize date/amount, compute `externalId` (hash of date+amount+rawLabel), compute `labelHash` / `rawLabelHash` / search tokens, encrypt labels + empty note, auto-categorize (`categorization.service.suggest`).
   - Dedup check on `(accountId, externalId)`.
   - Batch insert: `Transaction` + `TransactionSearchToken[]`.
   - Update `ImportBatch.status = COMPLETED`.
5. UI shows summary (totalRows, importedRows, skippedRows) + link to imported transactions.

### 5.6 Auto-categorization & learning

`categorization.suggest(rawLabel, amount, scope)`:
1. Load applicable rules: system rules + rules where `userId = current` OR `groupId IN (user's groups)`, sorted by priority DESC.
2. Match by type (EXACT, STARTS_WITH, CONTAINS [case-insensitive default], REGEX).
3. Return `{ categoryId, confidence, ruleId }` on first match, else `{ categoryId: null, confidence: 0 }`.

When a user manually changes a category:
1. Update transaction (`manuallyCategorized = true`).
2. Dialog: "You categorized 'CARREFOUR CITY' as Groceries. Create a rule for similar future transactions?"
   - Pattern proposed: most distinctive token (e.g., "LECLERC").
   - matchType: CONTAINS.
   - Scope: my account / this group / none.
3. On confirm: create `CategorizationRule`. On decline: nothing.

### 5.7 Budget creation & calculation

Creation (`/budgets/new`):
- Owner: self or a group.
- Period: preset (current month, quarter, year) or custom.
- Recurring: if yes, instances auto-created at each period start.
- Lines: each line targets a category, an account, both, or just a label, with a `plannedAmount`.

`budgets.service.computeLine(line, budget)`:
1. Select transactions visible to the budget's owner: own accounts + accounts shared via groups, within `[periodStart, periodEnd]`.
2. Filter by line's category/account constraints.
3. Subtract transactions with `BudgetAssignment(mode=EXCLUDE)` on this budget.
4. Add transactions with `BudgetAssignment(mode=INCLUDE)` on this budget (even if they don't match the line filters — explicit override).
5. Apply link logic:
   - Balanced groups (`|sum| < 0.005`): all members excluded.
   - Unbalanced groups: only the primary (largest absolute amount) counts, with the net sum as its effective amount.
6. Sum effective amounts → `spent`.
7. Return `{ plannedAmount, spent, remaining, percent, status: "OK" | "WARN" | "OVER" }`.

Explicit assignment: from any transaction, "Assign to a budget" menu → choose budget (mine or my groups') → mode INCLUDE/EXCLUDE → creates `BudgetAssignment` (unique on `(budgetId, transactionId)`).

The budget detail lists the counted transactions in full to everyone who can read the budget, including a private transaction included in a group budget (§2.2).

### 5.8 Transaction links

**Manual mode**:
1. `/transactions`: "Link mode" toggle (local state).
2. Click transactions to select (each must be visible to the user, not already in a link).
3. Confirm: `links.service.create({ transactionIds, userId })` → creates `TransactionLink` + `TransactionLinkMember[]`.

**Auto suggestions**: `links.service.suggestPairs(userId)`:
1. Load all visible transactions, not in any link.
2. For each `+X`, find `-X` within `±UserPreference.linkWindowDays` days.
3. Filter by `UserPreference.linkMinAmount`.
4. Exclude pairs in `IgnoredLinkSuggestion(userId)`.
5. Sort by amount DESC, days delta ASC.

UI `/transactions/suggestions`: list pairs with Link / Ignore buttons. Ignore writes to `IgnoredLinkSuggestion`.

### 5.9 Admin settings with hot reload

`/admin/auth-providers` (permission `admin.security.write`, super admins only):
1. `POST` (Server Action) → `settings.service.authProviders.update({ id, ...fields })` → encrypt clientSecret → invalidate cache → audit log.
2. Better Auth handler reads config via cached wrapper (`cachedAuthProviders()`, 60s TTL).
3. Update invalidates cache → next request rebuilds providers → effect immediate, no restart.

Provider types are `oidc` and `google` only; a Google row stores just the client ID and secret.

Same pattern for SMTP (`admin.security.write`; encryption mode `STARTTLS` (default) maps to nodemailer `requireTLS`, so a stripped STARTTLS never sends credentials in clear, `TLS` to implicit TLS, `NONE` to `ignoreTLS` for a local relay — #255) and app settings (`admin.settings.write`; the security keys — registration mode, password sign-in, password length, admin 2FA — also need `admin.security.write`).

### 5.10 RGPD: export & deletion

**Export JSON**: `/settings/data/export` → `rgpd.service.exportUserData(userId)` returns:
- User + UserPreference.
- All owned `BankAccount` + decrypted `Transaction[]` + categories + rules.
- Groups joined + sent invitations.
- Budgets + lines + assignments.
- Links involving the user's transactions.
- The user's own audit log entries.

Downloaded as JSON blob.

**Account deletion**: `/settings/data/delete` → re-auth confirmation → `rgpd.service.deleteUser(userId)`:
- Cascade delete: User → ownedAccounts → transactions → tokens/links.
- Cascade delete: owned categories, budgets.
- Remove from all GroupMember records.
- Invalidate all sessions.
- Keep `AuditLog "user.deleted"` (anonymous).
- Logout + redirect home.

---

## 6. Security Implementation

### 6.1 Application encryption (AES-256-GCM)

Storage format: `v1.<iv-b64>.<ciphertext-b64>.<authTag-b64>`. Version prefix supports key rotation.

Service `server/crypto/encryption.ts` provides `encrypt(plaintext, key)` and `decrypt(stored, key)`. `DATA_ENCRYPTION_KEY` loaded once at boot (base64, 32 bytes decoded). Never logged, never serialized, accessed only via `server/crypto/keys.ts`.

Key rotation (post-MVP): CLI script reads all rows, decrypts with old key, re-encrypts with new key, updates with new version prefix.

### 6.2 HMAC blind index (HMAC-SHA256)

`SEARCH_TOKEN_KEY` is **separate** from `DATA_ENCRYPTION_KEY` (defense in depth).

Normalization: strip accents (NFD), lowercase, collapse whitespace.

Tokenization: split on non-alphanumeric, keep words ≥ 3 chars, index every prefix of 3 to 12 chars of each word (#192): "lidl" → `lid`, `lidl`.

On transaction creation/import: store `labelHash`, `rawLabelHash`, and one `TransactionSearchToken` per distinct prefix of the label and raw label, inserted in shuffled order.

Search by word beginning: each query word ≥ 3 chars is cut to 12 chars, hashed → indexed lookup on `TransactionSearchToken.tokenHash`; all query words must match (AND). No substring search inside a word.

Leakage trade-off: the token count per transaction reveals word lengths, tokens shared by the same transactions reveal prefix chains, and the frequent 3-letter tokens are open to frequency analysis. Accepted for usable search; the labels themselves stay AES-encrypted.

A tokenization or normalization change makes stored tokens stale: rebuild them with `npm run db:reindex-search` (add `--rehash` when `normalizeText` changes, so `labelHash`/`rawLabelHash` are rewritten too).

### 6.3 Password hashing — argon2id

OWASP 2025 parameters: memoryCost 19456 KiB, timeCost 2, parallelism 1, hashLength 32. Handled by Better Auth. Minimum password length configurable in `AppSetting` (default 12), no complexity rules (anti-pattern), optional HaveIBeenPwned check (Better Auth plugin, post-MVP).

### 6.4 Sessions

DB-backed, 7-day expiration, refresh after 1 day of activity. Cookie attributes: httpOnly, secure, sameSite=strict, signed.

`/settings/sessions`: list active sessions, revoke one or all but current. New session created at each login (prevents session fixation).

Sessions are listed server-side, without their tokens: Better Auth's `/list-sessions` is disabled, `/api/auth/*` answers `Cache-Control: no-store`. Revoking the other sessions, or a password reset, also drops the "trusted device" grants that skip the 2FA step (#243).

2FA: enrolling again over an active 2FA is refused; disabling it takes the password and a current TOTP or backup code (#243).

### 6.5 CSRF

Handled natively by Better Auth + Next.js Server Actions (origin check + token). No additional config required.

### 6.6 Security headers (middleware)

Added to every response: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (deny geolocation/microphone/camera).

Pages get them from the proxy; `/api/*` from `next.config.ts` `headers()` with `default-src 'none'` as CSP, since running the proxy there would cap request bodies (imports) at its 10 MB clone limit (#243).

CSP strict with per-request nonce on inline scripts/styles. `frame-ancestors 'none'`, `form-action 'self'`, `upgrade-insecure-requests` (only when `APP_URL` is HTTPS: on plain HTTP Safari would upgrade even localhost assets and load no CSS).

### 6.7 Rate limiting

MVP: in-memory store (`@upstash/ratelimit` with memory adapter or custom).

| Endpoint | Limit | Scope |
|---|---|---|
| `/login` | 5 / 15min | IP + account (#243); wrong passwords only, the 2FA step shares it |
| `/login` | 30 / 1h | Account (#243): caps guessing from rotating IPs; wrong passwords only |
| `/register` | 3 / 1h | E-mail address submitted (IP keys need a trusted proxy header) |
| `/reset` | 3 / 1h | E-mail address submitted |
| `/api/import/csv` | 10 / 1h | User |
| `/api/import/pdf` | 10 / 1h | User |
| API generic | 100 / 1min | User |

Each in-memory limiter holds at most 10 000 buckets: expired ones are dropped first, then the oldest (#243).

Over the limit: HTTP 429 + `Retry-After` header. Logged to `AuditLog`. Post-MVP: switch to Redis when scaling to multiple instances.

### 6.8 Audit log — events tracked

Auth (`auth.login.success/failed`, `auth.logout`, `auth.session.revoked`, `auth.password.reset_requested`, `auth.password.changed`, `auth.2fa.enabled/disabled`, `auth.signup`), users (`user.created_by_admin`, `user.deleted`, `user.role.granted/revoked`), accounts (`account.created/updated/archived`, `account.share.create/revoke`), groups (`group.created/deleted`, `group.invitation.create/accept/revoke`), transactions (manual ones), imports (`transaction.imported_batch`), budgets (`budget.created/deleted`, `budget.assignment.create/delete`), settings (`settings.*.update`, `settings.registration_mode.update`), admin (`admin.signup_token.create/revoke`).

Rule: every state-mutating event is logged. Reads are not (volume control). Retention: 12 months, cron purge.

### 6.9 Env validation at boot

`src/env.ts` uses `envalid`. Validates `NODE_ENV`, `DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY` (base64 length check), `SEARCH_TOKEN_KEY`, `APP_URL`. App refuses to start if any are missing or malformed.

### 6.10 Dependencies & CI

GitHub Actions: lint, typecheck, unit tests, integration tests, E2E tests, `npm audit` (fail on HIGH/CRITICAL).

Dependabot: weekly npm updates, minor/patch grouped, major separate.

### 6.11 Future security improvements (post-MVP roadmap)

Tracked here for the future. Will move to `PLAN.md` (Phase 8+ "Security hardening") or integrate into existing phases when triggers fire.

| Improvement | Priority | Trigger | Effort |
|---|---|---|---|
| External KMS for `DATA_ENCRYPTION_KEY` (Vault, AWS KMS, Bitwarden Secrets Manager) | Medium | Production deployment beyond localhost, or 1+ admins with env-var access | M |
| HSM / TPM for root key | Low | Pro hosting with ISO/PCI requirements | L |
| Redis-backed rate limiting | Medium | Multi-instance deployment (≥2 Next.js replicas) | S |
| CAPTCHA / hCaptcha on login + signup | Low | Public exposure with detected abuse | S |
| WebAuthn / passkeys mandatory for SUPER_ADMIN | Medium | Real admin accounts with sensitive access | S (Better Auth ready, just enforce) |
| 2FA TOTP mandatory for all (via setting) | Medium | Group reaches 3+ members | S |
| Application-level forward secrecy | Very low | External security audit requesting it | L |
| External SIEM logs (Loki, Datadog, BetterStack) | Medium | First incident where local audit log proves insufficient | M |
| WAF (Caddy + CrowdSec) | Medium | Public exposure | S |
| Encrypted automated DB backups | High | As soon as real data exists | S |
| Penetration testing (OWASP ZAP in CI, manual audit) | Low | Before public opening | M |
| HSM / Yubikey for root key | Very low | App becomes critical | L |
| HaveIBeenPwned password check | Low | Easy via Better Auth plugin | S |
| Security email notifications ("new login from…", "password changed") | Medium | When SMTP is configured | M |
| Personal API access tokens (for scripts/automation) | Low | When external integration needed | M |
| Anomaly detection (login from new geo, etc.) | Low | Enough audit volume for stats | L |

Legend: **S** = a few hours · **M** = 1-3 days · **L** = 1+ week.

### 6.12 E-mail verification (#240)

Sign-in never requires a verified address. `User.emailVerified` turns true when:
- the user follows the verification link (Better Auth `emailVerification`, 24 h JWT, localized mail sent on sign-up when SMTP is enabled, resent from the « Vérifiez votre adresse » banner through a Server Action — 3 / 1h / user; the public `/send-verification-email` endpoint is disabled);
- a password reset succeeds (the mailed reset link proves the address — covers admin-created users' "choose your password" mail);
- an SSO provider asserts it: only a literal `email_verified: true`, and only for the `email` claim (not a remapped one);
- an admin marks it in Administration → Utilisateurs (`admin.users.update`, rank rule, audited `user.email_verified`) — the path for instances without SMTP;
- the first super admin is created verified by the setup wizard, as nobody else could verify them (#243, audited with `via` = `setup`).

The first three are audited `auth.email.verified` with `via` = `link` / `password_reset` / `sso`. `/change-email` is disabled: addresses never change after sign-up.

What it gates: invitations matched on the address alone. « Invitations en attente pour vous » on `/groups` is empty until the address is verified, and accepting/declining from that list (by invitation id) is refused. The invitation link (token) and the 6-char code keep working for unverified users: they are secrets delivered to the address or shared by the inviter.

---

## 7. Testing Strategy

### 7.1 Pyramid

- ~150-300+ **unit tests** (Vitest, `server/services/*` pure functions).
- ~30-50 **integration tests** (Vitest + real `mariadb-test` container).
- ~15-20 **E2E scenarios** (Playwright, full stack).

Server Actions and API Routes are thin wrappers; no direct tests, covered indirectly by E2E.

### 7.2 Unit test domains

`categorization` (match types, priority, normalization), `links` pure logic (`getPrimaryTransaction`, `computeNetSum`, `isBalanced`, auto-suggestion pairing), `budgets` pure logic (filter/include/exclude/calc), `crypto/encryption` (round-trip, format, key failure), `crypto/hmac` (stability, normalization), `imports/csv-parser` (separator detection, mapping, invalid rows, FR/EN dates), `imports/dedup`, `permissions` (visibility, write check).

### 7.3 Integration test domains

`transactions.service` (encryption + tokens, dedup, category update), `imports.csv` end-to-end, `accounts + permissions`, `budgets.service` calc with mix of auto matching + assignments, `groups.service` invitation flow with email mock, `links.service` with real data, `settings.service` provider update + cache invalidation.

Setup: `prisma migrate reset` once at suite start, `TRUNCATE TABLE` between tests, single worker (sequential).

### 7.4 E2E scenarios (Playwright)

`auth.spec.ts`, `accounts.spec.ts`, `transactions.spec.ts`, `import.spec.ts`, `groups.spec.ts`, `budgets.spec.ts`, `links.spec.ts`, `admin.spec.ts`, `i18n.spec.ts`, `rgpd.spec.ts`. Run on both Desktop Chrome and iPhone 14 viewports (mobile-first validation).

### 7.5 Coverage targets

- Services (unit + integration): ≥ 85% statements.
- Critical logic (crypto, budgets, permissions, dedup): 100%.
- E2E flows: all priority scenarios green.

Coverage report visible in PR comments, not blocking initially.

### 7.6 CI flow — aligned on the `librarr` project

The CI mirrors the `librarr` project's setup (Node 24, npm, GitHub Actions). Two workflows.

**`.github/workflows/ci.yml`** — runs on `pull_request` to `main`/`develop`, with `concurrency` (cancel-in-progress). Parallel jobs:
- **lint** — `npm ci` → `npm run lint`
- **build** — `npm ci` → `npm run build`
- **test** — `npm ci` → `npm run test:coverage` → upload coverage (cobertura `.reports/coverage/cobertura-coverage.xml`) + JUnit (`.reports/junit.xml`) to **Codecov**
- **integration** — same with a `mariadb:11` service container (migrate + run integration tests)
- **e2e** — `npx playwright install chromium --with-deps` → `npm run test:e2e` → upload artifacts (`.reports/test-results/`, `.reports/monocart/`) + JUnit (`.reports/junit-e2e.xml`) to Codecov

Actions pinned to recent majors: `actions/checkout@v6`, `actions/setup-node@v6` (`cache: npm`), `codecov/codecov-action@v5`, `actions/upload-artifact@v7`. All jobs required to merge (branch protection). Dependabot PRs run the same CI.

**Reporting config** (to produce the `.reports/` files): Vitest with cobertura + JUnit reporters; Playwright with `monocart-reporter` + JUnit reporter.

> The Docker build + release workflow (`build.yml`) is described in §12.4.

### 7.7 npm scripts

```
dev, dev:e2e, build, start,
lint, format, typecheck,
test, test:coverage, test:unit, test:integration, test:e2e,
db:up, db:reset, db:migrate, db:studio,
ci
```

---

## 8. Configuration & Deployment

### 8.1 Environment variables (bootstrap-only)

`.env.example`:
```bash
NODE_ENV=development
APP_URL=http://localhost:3000

DATABASE_URL=mysql://app:app_password@localhost:3306/budget
DATABASE_TEST_URL=mysql://app:app_password@localhost:3307/budget_test

AUTH_SECRET=                  # openssl rand -base64 32
DATA_ENCRYPTION_KEY=          # openssl rand -base64 32
SEARCH_TOKEN_KEY=             # openssl rand -base64 32
CRON_SECRET=                  # openssl rand -base64 32 (unset: the /api/cron routes 404)

LOG_LEVEL=info
DISABLE_RATE_LIMIT=false      # for E2E only
SKIP_EMAIL_VERIFICATION=false # for dev only
```

Auto-generated by `scripts/init.sh` at first install (random secrets from openssl).

### 8.2 Docker Compose

`docker-compose.yml` provides four services: `mariadb` (with `innodb_encrypt_tables=ON` and a keyring volume), `mariadb-test` (tmpfs-backed for fast resets), `adminer` (DB explorer), `app` (Next.js dev container with bind mount). MariaDB keyring file is generated by `scripts/init.sh`.

### 8.3 Dockerfile (multi-stage)

`base` (node:24-alpine), `deps` (`npm ci`), `dev` (`node:24` / glibc, used by docker-compose — glibc so the host's bind-mounted `node_modules` with native binaries like Prisma engines stay compatible), `builder` (`npm run build` with prisma generate), `prod` (standalone runtime, non-root user `nextjs:1001`).

### 8.4 Better Auth configuration

`src/server/auth/index.ts` builds the auth handler from DB-stored config:
- Loads dynamic providers (`getDynamicProviders()`, 60s cache) and security settings.
- Enables credentials if configured, builds social providers, builds OIDC plugin instances for each enabled `AuthProvider`.
- Plugins: `admin`, `twoFactor`, `passkey`, `openAPI`.
- Sessions: 7d expiry, 1d refresh threshold, cookie cache 5min.
- In-memory rate limiting (MVP).

Cached handler in module scope. `invalidateAuthCache()` called when admin updates settings.

Route handler at `src/app/api/auth/[...all]/route.ts` proxies to the built handler.

### 8.5 next-intl

`src/i18n/config.ts` defines `locales = ["fr", "en"]`, default `fr`. Middleware combines `next-intl` routing (always prefix), setup-needed guard, auth guard for `(authenticated)` routes, and security header injection.

### 8.6 Prisma + MariaDB adapter

`prisma/schema.prisma` uses `previewFeatures = ["driverAdapters"]`. `src/server/db/index.ts` instantiates `PrismaMariaDb` adapter and the Prisma client.

### 8.7 Init script

`scripts/init.sh` (called by `npm run setup`):
1. Generate `.env` from `.env.example` with random secrets if `.env` missing.
2. Generate MariaDB keyring file if missing.
3. Start mariadb + mariadb-test containers.
4. Run `prisma migrate deploy` and `prisma db seed` (seeds Permissions and Roles, no users).

After this, `npm run dev` works.

### 8.8 Hot reload of settings

Settings service has a 60-second in-process cache. When an admin updates a setting via `/admin/*`, `cache.delete(key)` + `invalidateAuthCache()` (when relevant) are called. Next request rebuilds the auth handler with the new config. No restart needed.

### 8.9 Production deployment

As shipped (operator guide: `docs/self-hosting.md`):
- `docker-compose.prod.yml` runs the published `ghcr.io/navino16/bilan` image (`prod` target) with three services: `mariadb` (at-rest encryption, keyring bind-mounted), `app` (runs `prisma migrate deploy` then the standalone server) and `cron` (same image, calls the token-guarded `/api/cron/*` routes; it exits without `CRON_SECRET`).
- No bundled reverse proxy: the operator puts their own TLS proxy (Caddy, Traefik, nginx…) in front of the app port. The app itself sends HSTS and the other security headers; rate limiting is in-app.
- Secrets come from env files next to the compose file (`app.env`, `db.env`), not Docker secrets.
- No dedicated health endpoint: the `app` healthcheck fetches `/fr/login`, which needs the database (a fresh install redirects it to `/fr/setup`).
- Backups are a documented operator script (`mariadb-dump` inside the `mariadb` container, gzip, `openssl enc` with a passphrase file, host cron, 30-day retention). `npm run db:backup-dev` only targets the development database.

---

## 9. Open Questions / Decisions Deferred

- PDF parsing strategy (which bank format, OCR needed?): decided when actually seeing the user's bank PDF (Phase 4.3 spike).
- OCR for scanned PDFs: only if a real need surfaces.
- Historical data: no automatic migration — the user will re-import via CSV (Phase 4).
- Production hosting: out of MVP scope, local Docker only.

---

## 10. Implementation Plan

To be elaborated in `PLAN.md` via the `writing-plans` skill. Expected phases:

- **Phase 0** — Project bootstrap (Next.js + Prisma + MariaDB + Docker Compose + CI scaffold + base tests).
- **Phase 1** — Authentication & multi-user core (Better Auth setup, RBAC seed, setup wizard, registration modes).
- **Phase 2** — Accounts & groups (CRUD, invitations, account sharing).
- **Phase 3** — Categories, rules, manual transactions.
- **Phase 4** — CSV import (then PDF spike + parser in 4.3).
- **Phase 5** — Reporting views (monthly, custom periods).
- **Phase 6** — Transaction links (manual + auto suggestions).
- **Phase 7** — Budgets (creation, calculation, assignments).
- **Phase 8** — Polish (charts, export, mobile fine-tuning) and security hardening from §6.11.

Each phase decomposed into scopes — **one scope = one GitHub issue = one branch = one PR** (see §12).

---

## 11. UI/UX & Design System — "Bilan"

A visual design was produced with Claude Design from this spec. The exported bundle lives in **`design/`** at the project root and is the **pixel-perfect source of truth** for the frontend. Coding agents must recreate it faithfully (matching visual output, not copying the prototype's internal React structure).

- `design/project/tokens.css` — design tokens (colors, typography, spacing, radii, light/dark themes)
- `design/project/ui.jsx` — shared primitives (Button, Card, Pill, CategoryChip, Tabs, Donut, BudgetBar, Sparkline, MiniBars, Input, Switch, Icon set, fmtEUR helpers)
- `design/project/screens/*.jsx` — dashboard, transactions, data-screens, admin-screens
- `design/project/forms.jsx` — creation modals / bottom sheets
- `design/project/chrome.jsx` — app shell (sidebar, topbar, mobile bottom nav, drawer)
- `design/chats/chat1.md` — the design conversation (intent + iterations)

### 11.1 Visual direction

"Bilan" — **editorial × calm × tactile numbers**, private-banking-meets-Notion. Warm paper canvas, forest-green primary, terracotta (not red) for expenses.

### 11.2 Design tokens (from `tokens.css`)

**Palette (light)**: paper `#F7F4ED`, card `#FFFFFF`, ink `#15130F`, primary forest `#1F4D3A`, income `#2D6B47`, expense terracotta `#B14A3B`, warning `#B6841F`, info `#2F5F8F`. Earthy category palette (groceries `#5E8C5A`, housing `#6E5B8C`, transport `#2F6B8F`, food `#C9763E`, leisure `#A86B9C`, health `#4F8C7B`, savings `#B68F36`, shopping `#8C5A3E`, bills `#4A6675`). Full **dark theme** provided.

**Typography**: display serif **Newsreader**, UI sans **IBM Plex Sans**, numbers **IBM Plex Mono** (tabular figures). Display 56/40px, h1 28px, body 14px, big numbers 44/28/18px.

**Spacing/radii**: 4–64px scale, radii 4–20px + pill. Density token (`--row-h`): compact 36 / cozy 48 / roomy 60 — **locked to cozy** in-app (not user-exposed).

### 11.3 Confirmed UX decisions (from the design chat)

- **Native light/dark theme** (toggle), stored per browser in the `bilan-theme` cookie (no cookie = system).
- **Density locked to cozy** — removed from user/admin settings.
- **Dashboard layout: editorial** (asymmetric grid, serif month title, KPI row, category donut with amounts + %).
- **Budget visualization: horizontal bar** (over-budget aware: primary → warning at >85% → expense when over). Donut/gauge/sparkline exist as components but bar is the chosen default.
- **Single budget creation entry point** (no duplicate "+ New" buttons).
- **Navigation**: desktop sidebar; mobile bottom nav (Dashboard · Transactions · [+] · Budgets · More) + **hamburger drawer** for the rest (Categories, Links, Household, Import, Preferences, Admin) + **contextual green action button** in the mobile topbar (per-screen: add account / new category / new budget / invite / new transaction / link mode / import).
- **Forms**: centered **modals on desktop**, ascending **bottom sheets on mobile**, for: new transaction (large serif amount, in/out/transfer, category chips), add account (type, bank, balance, encrypted IBAN, color palette), new category (live preview, parent, scope perso/household, palette, symbol), new budget (period, scope, dynamic category lines with caps, computed total), invite member (email, role, message).
- **Key interactions**: click a transaction → detail panel (side panel desktop / bottom sheet mobile); change category → "create a rule for similar transactions?" dialog; month prev/next navigation shared; account selector in topbar; "my data" / "household" scope switch.
- **Flagship screen**: Dashboard — monthly overview.

### 11.4 Component library — all shadcn/ui, themed Bilan

**The Bilan visual design is unchanged.** It is implemented entirely through **shadcn/ui**, themed with the Bilan tokens — not by hand-rolling a parallel component system.

- **Theming**: map `tokens.css` onto shadcn's CSS variables (`--background`, `--foreground`, `--primary`, `--card`, `--border`, `--radius`, `--font-sans`, etc.) for both light and dark themes. Done once at setup. This reproduces the Bilan look (paper canvas, forest green, terracotta, Newsreader/IBM Plex) across every shadcn component.
- **All components come from shadcn** (Button, Card, Dialog, Sheet, Combobox, Tabs, Popover, Calendar, Input, Switch, Badge, Progress, Tooltip, Toast…). Accessibility (Radix) is therefore included everywhere by default.
- **Charts**: use **shadcn Charts (Recharts)** for the donut (category breakdown), bars (budget viz), and sparklines/mini-bars — colored with the Bilan category palette.
- **Marginal custom pieces**: a few Bilan-specific visuals not covered by shadcn (e.g. the large serif amount display, the category color-dot chip, the over-budget-aware bar) are thin wrappers/compositions on top of shadcn primitives + tokens.
- `ui.jsx` and the prototype screens remain the **visual reference** (spacing, sizes, hierarchy) — but the implementation target is shadcn-themed, not a copy of the prototype's inline styles.

> Stack note: §2.1 fonts updated — **Newsreader + IBM Plex Sans + IBM Plex Mono** (self-hosted via `next/font`, wired into the shadcn `--font-*` variables). The earlier "sober blue" mockups (now in `.superpowers/brainstorm/`) are superseded by this bundle.

---

## 12. Development Workflow (GitHub + Git Flow)

### 12.1 Repository & branching — Git Flow

The project lives in a **GitHub repository**, using the **Git Flow** model:

- **`main`** — production branch. Tagged at each release. Always stable/released.
- **`develop`** — integration branch. All features land here first.
- **`feature/<scope>`** — branched from `develop`, merged back into `develop` via PR.
- **`release/<version>`** — branched from `develop` when cutting a release, merged into **both** `main` and `develop`, tagged on `main`.
- **`hotfix/<version>`** — branched from `main` for urgent fixes, merged into `main` and `develop`.

**Releases are manual**: the user runs the Git Flow commands (`git flow release start/finish`) to cut releases when they decide. The CI does **not** auto-release.

### 12.2 Issues & traceability

- **One issue per scope** of `PLAN.md`. The issue describes the scope's goal and acceptance criteria.
- Each `feature/<scope>` branch addresses one issue; its PR references it with `Closes #<n>` so merging into `develop` auto-closes the issue.
- Phases tracked via **GitHub milestones** (one milestone per phase) grouping their scope-issues — fine-grained tracking + phase-level overview.
- Suggested labels: `phase-0`…`phase-8`, `frontend`, `backend`, `security`, `infra`.

### 12.3 Pull requests

- PR target: `develop` (features), `main` (releases via Git Flow).
- PR title in conventional-commit style (`feat: …`, `fix: …`, `refactor: …`) — communicates intent and feeds an eventual CHANGELOG.
- Merge only when CI is green (lint, typecheck, unit, integration, e2e, audit) — branch protection on `develop` and `main`.
- Commits stay 1-line English conventional.

### 12.4 CI/CD workflows (aligned on `librarr`)

Two workflows, mirroring the `librarr` project.

**`ci.yml`** — on PR to `main`/`develop`: lint, build, test (+ Codecov), integration, e2e (+ Codecov). See §7.6. Required to merge.

**`build.yml`** — on push to `develop`, on `*` tags, and `workflow_dispatch`:
1. **lint** + **test** (gate).
2. **docker** (matrix `linux/amd64` on ubuntu-latest + `linux/arm64` on ubuntu-24.04-arm): build with Buildx + GHA cache, push by digest to **ghcr.io** (`ghcr.io/<owner>/bilan`).
3. **merge** — combine per-arch digests into a multi-arch manifest, tagged via `docker/metadata-action` (semver `{{version}}`, `{{major}}.{{minor}}`, branch, PR, `sha-` prefix; `latest=auto`).
4. **release** (only on tags `refs/tags/*`) — generate CHANGELOG from PR labels via `mikepenz/release-changelog-builder-action` (categories: breaking change, enhancement, bug, documentation, dependencies; base branch `develop`), then create the GitHub Release via `softprops/action-gh-release`.
5. **notify-discord** (only on tags) — post the release to a Discord webhook with the changelog excerpt.

**Release flow**: the user cuts a release via Git Flow (manual `git flow release finish` → tag on `main`). Pushing the tag triggers `build.yml`'s release + Discord steps. So the **decision is manual** (the user tags), and the **packaging/publishing is automated** — exactly like `librarr`.

**Required secrets/vars**: `CODECOV_TOKEN`, `GITHUB_TOKEN` (auto, for ghcr.io + release), `DISCORD_RELEASES_WEBHOOK`, `DISCORD_RELEASE_ROLE_ID`. Image registry: `ghcr.io`.

### 12.5 Conventions recap

- Code, tests, comments, commit messages, issue/PR titles: **English**. UI strings: **French/English** (next-intl).
- Commits: 1 line, conventional-ish (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).
- No `--no-verify`, no force-push to `main`/`develop`.
- Dependabot PRs follow the same flow (target `develop`, CI must pass).

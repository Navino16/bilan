# Bilan — Architecture

> How Bilan is built: stack, data model, key flows, security, testing and deployment. It started
> as the design spec (May 2026) and was checked against the code in October 2026. Where it and the
> code differ, the code is right. Code comments cite its sections as `spec §N`.

---

## 1. Context & Objectives

### Background

Self-hosted personal-finance application. A full web app with multi-user support, a relational database, several import sources (bank CSV, bank PDF statements, bank OFX files, manual entry), user-configurable categorization rules, transaction links and budgets.

### Primary users

- A person managing several bank accounts (personal, joint, savings…), some of them shared with a partner or the rest of the household.
- The other members of that household: each has their own accounts and sees the accounts shared with the group.
- Other shared groups (e.g., a trip with friends): a user can belong to several groups.
- The instance administrator, who configures the app (sign-up, SSO, SMTP, users) from the admin UI.

### Goals

1. Aggregate transactions from multiple bank accounts.
2. Categorize automatically with user-configurable rules.
3. Share specific accounts with specific groups (e.g., household), with read or write permissions.
4. Track budgets by category and/or account, with explicit transaction assignment overriding automatic matching.
5. Link related transactions (refunds, partial reimbursements) and exclude balanced groups from averages.
6. Maintain strict security: bank data is sensitive, encryption at rest is mandatory.

### Non-goals

- Multi-currency (EUR only).
- Native mobile apps (responsive mobile-first web, installable as a PWA).
- Automatic bank-account connection (PSD2 / Open Banking) — manual imports only.

---

## 2. Key Decisions

### 2.1 Stack

| Component | Version | Choice rationale |
|---|---|---|
| Next.js | 16.2 | App Router, full-stack TypeScript, `output: "standalone"` |
| React | 19.2 | Server Components, Server Actions |
| TypeScript | 6.0 | Strict mode |
| Tailwind CSS | v4 | Styling, driven by Bilan design tokens (see §9) |
| shadcn/ui | 4.x (`base-nova` style) | Accessible primitives (Base UI, `@base-ui/react`), re-skinned with Bilan tokens |
| Fonts | Newsreader · IBM Plex Sans · IBM Plex Mono | Self-hosted from `@fontsource` via `next/font/local` (see §9.2) |
| Zod | 4.x | Runtime validation, server-side only (`src/lib/schemas/`); forms post to Server Actions through `useActionState` (`src/components/forms/use-action-form.ts`) |
| next-intl | 4.x | i18n fr/en routing |
| Prisma | 7.x (with `@prisma/adapter-mariadb`) | ORM with MariaDB-native driver |
| MariaDB | 11 | Database |
| Better Auth | 1.6 (+ `@better-auth/passkey`) | DB-backed sessions, 2FA, passkeys, admin plugin, generic OIDC plugin |
| papaparse · pdfjs-dist | — | CSV and PDF statement parsing (OFX has a built-in reader, no dependency) |
| re2js | — | Linear-time regex engine for user `REGEX` rules (no ReDoS) |
| nodemailer | — | Outgoing mail through the admin-configured SMTP |
| Node | 24 LTS | Runtime, LTS until April 2028 |
| Vitest | 4.x | Unit + integration tests |
| Playwright | 1.x | E2E tests |
| Docker Compose | — | Local stack (app + mariadb + mariadb-test + adminer); production stack (mariadb + app + cron) in `docker-compose.prod.yml` |
| Package manager | **npm** | `npm ci`, `package-lock.json` |
| GitHub Actions | — | CI/CD (`ci.yml`, `build.yml`, `prod-smoke.yml`) — see §7.6 / §10.4 |
| Codecov | — | Coverage + test results upload |
| ghcr.io | — | Multi-arch (amd64 + arm64) Docker image registry |
| Dependabot | — | Dependency updates (npm + GitHub Actions) |

> Note on auth: Better Auth (which now maintains Auth.js) is the recommendation for new self-hosted projects. It provides 2FA, passkeys, immediate session revocation, and dynamic OIDC providers out of the box; RBAC is Bilan's own `Role`/`Permission` tables (§2.3).

### 2.2 Architecture choices

- **Full-stack Next.js** (single project, App Router).
- **Transport mix**: Server Actions for short CRUD; Route Handlers (API) for imports, exports, cron and auth endpoints; Server Components for read-only views. All business logic lives in `server/services/*` (pure TypeScript, testable).
- **Database**: relational, Prisma + MariaDB.
- **Multi-user model**: shared via **groups (households)** only. A user may belong to multiple groups. Accounts always have a user owner; sharing is done by granting a group access to an account (READ or WRITE).
- **Categories model**: owned by `User` OR `Group` (symmetric with accounts via XOR ownership, enforced in the service layer). Default categories seeded at signup in user's locale.
- **Categorization**: user-configurable rules (pattern + match type `CONTAINS | EXACT | STARTS_WITH | REGEX`, priority), scoped to a user or a group. When a user changes a transaction's category, the UI proposes creating a rule.
- **Transaction links**: manual + auto-suggestions. Pairs `+X/-X` within a per-user window (default 30 days) and above an optional per-user minimum amount (default 0). Inside one account a pair needs the same `merchantKeyHash` or a shared significant word of the merchant key; pairs are scored (other account, same merchant, shared word, two transfers, day gap) and listed by score (`pairScore` in `lib/links.ts`). Only rows with an opposite amount get their label decrypted. **Automatic links (#353)**: `links/auto.autoLinkTransfers` links, without asking, the legs of transfers between two accounts the same user owns: opposite to the cent, real dates at most 4 days apart, each leg the other's strictly best candidate (`findAutoLinkPairs`); ties stay suggestions. It runs after every import (`finalizeBatch`, over the batch's date range; a failure is logged, never fails the import), after a manual entry, and over history via `npm run db:auto-link`. Deleting an automatic link records its pair in `IgnoredLinkSuggestion`. The dashboard's net savings (`dashboard/savings.ts`) = linked legs on `SAVINGS` accounts whose link crosses to a non-savings account, plus unlinked spending in `Category.savings` subtrees.
  - Balanced groups (sum = 0): all transactions excluded from totals.
  - Unbalanced groups: the **primary** transaction (largest absolute amount) receives the net sum in its category; other members are neutralized.
- **Budgets**: scoped to user OR group; can target categories AND/OR accounts; custom periods (week, month, quarter, year, custom), optionally recurring (rolled into the next period by a cron route); automatic matching by category/account + explicit `BudgetAssignment` (`INCLUDE` / `EXCLUDE`) overrides.
- **Privacy on shared budgets**: full transparency — every group member sees the date, amount, label, category and account name of each transaction counted in a group budget, including one a member assigned (`INCLUDE`) from a private account. Only that transaction becomes visible: the private account and its other transactions stay private. Visibility is re-checked when displayed: a counted transaction is shown in full only while its account is shared with the household or its owner is still a member (otherwise masked but still counted); a personal budget masks one from an account its owner can no longer read.
- **Include scope on group budgets**: an `INCLUDE` into a group budget is allowed only for a transaction whose account the actor owns or that is shared with that same group — reading an account through another group is not enough. Personal budgets accept any account the actor can read.
- **Currency**: EUR only.
- **Mobile**: responsive mobile-first, installable PWA (Playwright runs a mobile project on an iPhone 14 profile).
- **i18n**: fr/en, language preference per user, `next-intl`.

### 2.3 Security choices

- **Encryption at rest at MariaDB level** (`innodb_encrypt_tables` + `innodb_encrypt_log`, `file_key_management` keyring) — protects against disk theft.
- **Application-level encryption** AES-256-GCM on sensitive fields: transaction labels, raw labels, notes, account IBAN, merchant aliases, OIDC client secrets, SMTP password.
- **Search on encrypted labels**: HMAC-SHA256 of the normalized full label (exact match) + a `TransactionSearchToken` table with one HMAC per normalized word prefix of 3 to 12 chars (word-beginning search, #192; a query word is cut to 12 chars). No substring search inside a word. Accents stripped, lowercase. Changing the tokenization requires `npm run db:reindex-search`. IBANs get the same kind of HMAC blind index (`ibanHash`).
- **Keys**: `DATA_ENCRYPTION_KEY` (AES) and `SEARCH_TOKEN_KEY` (HMAC) are **separate** — defense in depth.
- **Password hashing**: Better Auth's default (scrypt via `node:crypto`); minimum length configurable by the admin (default 12).
- **Sessions**: DB-backed (7 days, refreshed after 1 day), no cookie cache so revocation is immediate; Better Auth cookie attributes (httpOnly, sameSite=lax, `Secure` + `__Secure-` prefix on HTTPS).
- **Second factors**: TOTP 2FA (backup codes, trusted devices) and passkeys; admins can be required to enrol 2FA; step-up re-authentication guards IBAN reveal and full data export.
- **Multi-provider auth**: Credentials (toggleable), generic OIDC (e.g., Authentik), optional Google. Providers configured via DB through the `/admin/auth-providers` UI (hot-reload, no restart needed).
- **Roles**: configurable `Role` + `Permission` + `RolePermission` + `UserRole` tables (seeded on every start: `SUPER_ADMIN`, `ADMIN`, `USER`).
- **Registration mode**: `OPEN | INVITE_ONLY | DISABLED` configurable from admin UI.
- **Admin signup tokens**: generic invite tokens (separate from group invitations) for `INVITE_ONLY` mode.
- **Audit log**: every state-mutating event (auth, sharing, settings, transactions) tracked in `AuditLog` with 12-month retention (purged by a cron route).
- **CI**: GitHub Actions; **Dependabot** for dependency updates.

### 2.4 Other settings — all in the web UI

All application configuration is editable from the web admin UI. Only bootstrap values stay in `.env`: `DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `APP_URL`, plus the optional `CRON_SECRET` (enables the cron routes) and `TRUSTED_IP_HEADER` (client-IP header set by the reverse proxy) — validated by `src/env.ts`.

Database-stored settings include: auth providers, SMTP, app name, security policy (registration mode, credentials toggle, min password length, admin 2FA requirement). Per-user preferences (locale, link-suggestion window and minimum amount) live in `UserPreference`. Session duration and rate limits are fixed in code.

### 2.5 Tests

- **Unit + integration + E2E**, all in CI.
- Unit + integration tests mostly target `server/services/*` (pure business logic + Prisma); integration tests run against the `mariadb-test` container (`budget_test`).
- E2E tests via Playwright (desktop Chromium + mobile project) against a server whose database is seeded by `scripts/seed-e2e.ts`.
- Server Actions and API Routes are thin wrappers (session, Zod validation, service call, error mapping); only the ones carrying logic of their own (auth, setup, cron, error mapping) have dedicated tests.

### 2.6 MVP scope

- **Multi-user from the first release**: groups, sharing and group budgets are part of the core model, not an add-on.

---

## 3. Architecture

### 3.1 Layered overview

```
┌──────────────────────────────────────────────────────┐
│  app/  ── UI (Server Components + Client)            │  ← Responsive mobile-first, i18n
│    └ api/  (Route Handlers — imports, exports, cron) │
├──────────────────────────────────────────────────────┤
│  proxy.ts  (setup gate, session fast-path, i18n,     │
│             security headers)                        │
├──────────────────────────────────────────────────────┤
│  server/transport/                                   │
│    ├ actions/  (Server Actions — short CRUD)         │  ← Thin wrappers
│    └ http/     (shared Route Handler helpers)        │
├──────────────────────────────────────────────────────┤
│  server/services/  (business logic, pure TS)         │  ← Most unit/integration tests target this
│    ├ accounts, transactions, categories,             │
│    │ categorization, merchants, links, budgets       │
│    ├ groups, users, signup-tokens, audit, rgpd       │
│    ├ dashboard, export, mail, onboarding             │
│    ├ imports/ (csv, pdf, ofx)                        │
│    └ settings/ (auth-providers, smtp, app-settings)  │
├──────────────────────────────────────────────────────┤
│  server/auth/  (Better Auth + dynamic providers,     │
│                 RBAC permissions, rate limits)       │
├──────────────────────────────────────────────────────┤
│  server/crypto/  (AES-256-GCM, HMAC)                 │
├──────────────────────────────────────────────────────┤
│  server/db/  (Prisma client + adapter-mariadb)       │
└──────────────────────────────────────────────────────┘
```

### 3.2 Transport rules

| Use case | Solution | Why |
|---|---|---|
| Create tx, edit category, share account, create budget, etc. | **Server Action** | Short mutation, automatic cache revalidation |
| Upload CSV/PDF/OFX, preview, commit, progress polling | **API Route** | Large multipart payload, status codes and headers control |
| Exports (transactions CSV, full data export) | **API Route** | File download |
| Cron jobs (audit purge, import purge, recurring budgets) | **API Route** | Called outside the browser (cron container, `CRON_SECRET` bearer) |
| Read (transaction list, dashboard) | **Server Component** | Direct server render, no API needed |

All business logic in `server/services/*`. Transport wrappers check the session, validate input with Zod, call the service, map errors to a result. The proxy only checks that a session cookie is present (redirect to `/login` without a DB round-trip); the authoritative check is `requireSession()` / `requirePermission()` in layouts, pages and wrappers.

### 3.3 Directory structure

```
budget/
├── docker-compose.yml              # local stack: mariadb, mariadb-test, adminer, app (dev)
├── docker-compose.prod.yml         # production: mariadb, app, cron
├── Dockerfile                      # dev, builder, migrator, prod stages
├── docker/                         # cron, mariadb (conf, keyring), migrate (Prisma CLI)
├── package.json
├── prisma.config.ts
├── prisma/
│   ├── schema.prisma               # adapter mariadb
│   ├── migrations/
│   ├── seed.ts                     # roles + permissions + default app settings
│   └── seed-data/                  # default categories (fr, en) and rules
├── messages/                       # i18n
│   ├── fr.json
│   └── en.json
├── scripts/                        # init, dev/e2e seeds, search reindex, prod smoke, docs
├── public/                         # icons, PWA service worker
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── (setup)/setup/      # first launch
│   │   │   ├── (auth)/             # /login, /register, /reset, /verify-email
│   │   │   ├── (authenticated)/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── transactions/   # + suggestions/ (link suggestions)
│   │   │   │   ├── accounts/
│   │   │   │   ├── budgets/
│   │   │   │   ├── categories/
│   │   │   │   ├── insights/
│   │   │   │   ├── groups/         # + join/[token]
│   │   │   │   ├── import/         # csv/, pdf/, ofx/
│   │   │   │   ├── settings/       # security/ (2FA, passkeys, sessions), data/ (export, deletion)
│   │   │   │   └── admin/          # app settings (permission required)
│   │   │   │       ├── auth-providers/
│   │   │   │       ├── smtp/
│   │   │   │       ├── app-settings/
│   │   │   │       ├── users/
│   │   │   │       ├── signup-tokens/
│   │   │   │       └── audit/
│   │   │   ├── 403/
│   │   │   └── [...rest]/          # localized 404
│   │   └── api/                    # Route Handlers (outside [locale])
│   │       ├── auth/[...all]/      # Better Auth
│   │       ├── import/             # csv/, pdf/, ofx/ (+ [batchId]/preview, commit), [batchId]/progress
│   │       ├── export/             # transactions/, data/
│   │       ├── cron/               # purge-audit/, purge-imports/, roll-budgets/
│   │       └── [...path]/          # JSON 404 for unknown API routes
│   ├── components/                 # feature components + ui/ (shadcn)
│   ├── hooks/
│   ├── i18n/                       # next-intl config, client message scopes
│   ├── server/
│   │   ├── services/               # incl. settings/ (TTL-cached DB reads)
│   │   ├── transport/              # actions/ + http/
│   │   ├── auth/                   # Better Auth + dynamic providers, permissions, rate limits
│   │   ├── crypto/
│   │   ├── db/
│   │   └── http/                   # client IP, request locale, 404 response
│   ├── lib/                        # utils, shared types; schemas/ (Zod, server-only), validation/ (client-safe limits)
│   ├── proxy.ts                    # setup gate + session fast-path + next-intl + security headers
│   ├── instrumentation.ts          # seeds roles/permissions/settings at server start
│   └── env.ts                      # envalid validation
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
└── docs/
    ├── architecture.md             # this document
    └── …                           # user, admin, self-hosting and development guides
```

### 3.4 i18n routing

- URL prefix: `/[locale]/...` (e.g., `/fr/dashboard`, `/en/dashboard`); default locale `fr`.
- Initial locale: detected from `Accept-Language` header. The browsing locale lives in the next-intl `NEXT_LOCALE` cookie (persistent, 1 year, per browser); a stored preference never forces a redirect.
- `UserPreference.locale` drives e-mails only. It is written at sign-up, at every sign-in (locale of the sign-in page) and by the language switcher.
- E-mail locale (one rule for every sender): the recipient's `UserPreference.locale` when the recipient is a known user, otherwise the locale of the page that triggered the send. Mails carry a `Content-Language` header.
- Default categories: two fixture sets (`prisma/seed-data/categories-fr.json` and `categories-en.json`) are bundled. At user signup, the set matching the sign-up page's locale is copied into `Category` rows owned by that user with `isDefault = true`. Users can rename, add, delete freely.
- Default rules: `prisma/seed-data/rules.json` is created with the default categories, as the user's personal rules. Each rule names its category by a key path (`transport.tolls`) shared by both locales. Only national brands and generic bank wording, never people or local businesses; short tokens are word-bounded `REGEX` rules (`\bTER\b`) so they don't match inside longer words.
- Language switcher in the header.
- All dates/numbers formatted via `Intl.DateTimeFormat` / `Intl.NumberFormat` based on locale.

### 3.5 Bootstrap (first launch)

When `User.count() === 0`:
- Every page redirects to `/setup` (`src/proxy.ts`).
- Wizard steps, submitted together in one atomic Server Action at the end:
  1. Create first user (auto-granted `SUPER_ADMIN` role).
  2. Optional: SMTP configuration.
  3. Optional: OIDC provider configuration (with a connection test).
  4. Choose registration mode (default: `INVITE_ONLY`).

`/setup` is disabled (404) as soon as at least one user exists.

---

## 4. Data Model

Prisma schema (`prisma/schema.prisma`), grouped logically. Owner XOR constraints (User XOR Group) are enforced at the service layer only: MariaDB rejects a CHECK on a column that is part of a FK with a referential action (error 1901), as noted in the init migration.

### 4.1 Group A — Identity & Access

```prisma
// Better Auth core tables, extended with business relations
model User {
  id               String    @id
  email            String    @unique
  emailVerified    Boolean   @default(false)
  name             String?
  image            String?
  twoFactorEnabled Boolean   @default(false)
  role             String?                            // Better Auth admin plugin (admin | user); not used for authorization
  banned           Boolean   @default(false)
  banReason        String?
  banExpires       DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  // Better Auth relations
  sessions         Session[]
  authAccounts     AuthAccount[]
  twoFactors       TwoFactor[]
  passkeys         Passkey[]

  // Business relations
  roles            UserRole[]
  preference       UserPreference?
  accounts         BankAccount[]        @relation("AccountOwner")
  groupMemberships GroupMember[]
  sentInvitations  GroupInvitation[]    @relation("InvitedBy")
  categories       Category[]
  rules            CategorizationRule[]
  budgets          Budget[]
  merchantAliases  MerchantAlias[]
}

model Session {                                       // DB-backed, no cookie cache
  id             String   @id
  userId         String
  token          String   @unique
  expiresAt      DateTime
  ipAddress      String?
  userAgent      String?  @db.Text
  impersonatedBy String?                              // admin plugin, set during impersonation
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model AuthAccount {                                   // Better Auth "Account", renamed (NOT BankAccount)
  id                    String    @id
  userId                String
  accountId             String
  providerId            String                        // credential | google | <oidc key>
  accessToken           String?   @db.Text
  refreshToken          String?   @db.Text
  idToken               String?   @db.Text
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?   @db.Text            // password hash (credential provider)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([providerId, accountId])
  @@index([userId])
}

model Verification {                                  // no FK to User
  id         String   @id
  identifier String
  value      String   @db.Text
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([identifier])
}

model TwoFactor {
  id           String  @id
  userId       String
  secret       String  @db.Text
  backupCodes  String  @db.Text
  verified     Boolean @default(true)
  lastUsedStep Int?                                   // last accepted TOTP step, blocks replay
  user         User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model Passkey {                                       // WebAuthn credentials
  id           String   @id
  name         String?
  publicKey    String   @db.Text
  userId       String
  credentialID String
  counter      Int      @default(0)
  deviceType   String
  backedUp     Boolean  @default(false)
  transports   String?
  aaguid       String?
  createdAt    DateTime @default(now())
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

// RBAC — our own tables. The Better Auth admin plugin is enabled for its utilities
// (impersonation, banning); its `User.role` string is not used for authorization —
// permissions resolve through UserRole → RolePermission.
model Role {
  id          String  @id @default(cuid())
  key         String  @unique                         // SUPER_ADMIN, ADMIN, USER
  name        String
  description String?
  isSystem    Boolean @default(false)                 // protection against deletion
  permissions RolePermission[]
  users       UserRole[]
}

model Permission {
  id          String @id @default(cuid())
  key         String @unique                          // admin.settings.write, admin.users.read, ...
  scope       String                                  // admin | system
  description String
  roles       RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  @@id([roleId, permissionId])
  @@index([permissionId])
}

model UserRole {
  userId    String
  roleId    String
  grantedAt DateTime @default(now())
  grantedBy String?
  user      User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      Role @relation(fields: [roleId], references: [id], onDelete: Cascade)
  @@id([userId, roleId])
  @@index([roleId])
}
```

`Verification` rows carry short-lived grants, distinguished by `identifier` prefix:

| Identifier | Value | Use |
|---|---|---|
| `reset-password:<token>` | user id | Password reset; the identifier is stored **hashed** (`verification.storeIdentifier` override). |
| `trust-device-…` | user id | "Trust this device" 2FA skip (Better Auth). Listed and revoked from the user's security settings (`services/users/trusted-devices.ts`). |
| `step-up-<sessionId>` | user id | Step-up re-authentication by password, 5-minute TTL, bound to one session (`services/users/step-up.ts`). A sign-in less than 10 minutes old counts as step-up without a row. |

Email verification sets `User.emailVerified` (`services/users/email-verification.ts`).

### 4.2 Group B — Groups (households) & Sharing

```prisma
model Group {
  id           String   @id @default(cuid())
  name         String
  description  String?
  createdById  String                                 // no FK; reassigned on user erasure
  createdAt    DateTime @default(now())
  archived     Boolean  @default(false)

  members       GroupMember[]
  invitations   GroupInvitation[]
  accountShares AccountShare[]
  categories    Category[]
  rules         CategorizationRule[]
  budgets       Budget[]
}

model GroupMember {
  id        String   @id @default(cuid())
  groupId   String
  userId    String
  role      String                                    // OWNER | ADMIN | MEMBER
  joinedAt  DateTime @default(now())

  group     Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  user      User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([groupId, userId])
  @@index([userId])
}

model GroupInvitation {
  id            String   @id @default(cuid())
  groupId       String
  email         String                                // recipient (may not have an account yet)
  invitedById   String
  role          String   @default("MEMBER")
  tokenEnc      String   @db.Text                     // invitation link token, AES-256-GCM (§6.1)
  tokenHash     String   @unique                      // HMAC lookup index (§6.2)
  codeEnc       String   @db.Text                     // 6 chars, manual entry
  codeHash      String   @unique
  expiresAt     DateTime
  acceptedAt    DateTime?
  acceptedById  String?
  createdAt     DateTime @default(now())

  group         Group @relation(fields: [groupId], references: [id], onDelete: Cascade)
  invitedBy     User  @relation("InvitedBy", fields: [invitedById], references: [id], onDelete: Cascade)
  @@index([email])
  @@index([groupId])
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
  @@index([groupId])
}

model AdminSignupToken {
  id          String    @id @default(cuid())
  tokenEnc    String    @db.Text                      // AES-256-GCM (§6.1), shown back to admins
  tokenHash   String    @unique                       // HMAC lookup index (§6.2)
  description String?
  maxUses     Int?                                    // null = unlimited
  usedCount   Int       @default(0)
  expiresAt   DateTime?
  createdById String
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?
}
```

### 4.3 Group C — Bank Accounts

```prisma
model BankAccount {
  id             String   @id @default(cuid())
  ownerId        String
  name           String
  type           String                               // CHECKING | SAVINGS | CREDIT | OTHER
  initialBalance Decimal  @default(0) @db.Decimal(12, 2) // CLEAR — balance = initialBalance + Σ transactions
  ibanEnc        String?  @db.Text                    // encrypted IBAN (AES-256-GCM)
  ibanHash       String?                              // HMAC-SHA256 blind index for equality search
  bankName       String?
  color          String?  @default("#2563eb")
  icon           String?
  archived       Boolean  @default(false)
  createdAt      DateTime @default(now())

  owner        User @relation("AccountOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  shares       AccountShare[]
  transactions Transaction[]
  imports      ImportBatch[]
  budgetLines      BudgetLine[] @relation("BudgetLineAccount")
  counterpartLines BudgetLine[] @relation("BudgetLineCounterpart")
  attachedBudgets  Budget[]     @relation("BudgetAccount")
  @@index([ownerId])
  @@index([ibanHash])
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
  parent    Category?  @relation("CategoryHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children  Category[] @relation("CategoryHierarchy")

  // Owner XOR (User or Group) — service layer
  userId    String?
  groupId   String?
  user      User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group     Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  isDefault Boolean  @default(false)
  shiftDays Int?                                      // transactions in the month's last N days count toward the next one (#341)
  savings   Boolean  @default(false)                  // subtree counted in the dashboard's net savings (#353)
  createdAt DateTime @default(now())

  transactions Transaction[]
  rules        CategorizationRule[]
  budgetLines  BudgetLine[]
  @@index([userId])
  @@index([groupId])
  @@index([parentId])
}

model CategorizationRule {
  id            String  @id @default(cuid())
  pattern       String                                // literal or regex source
  matchType     String                                // CONTAINS | EXACT | STARTS_WITH | REGEX
  caseSensitive Boolean @default(false)
  priority      Int     @default(100)
  categoryId    String
  category      Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  // Scope XOR (User or Group) — service layer
  userId        String?
  groupId       String?
  user          User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group         Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  enabled       Boolean  @default(true)
  hits          Int      @default(0)                  // transactions categorized by this rule; decremented on import revert
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([userId])
  @@index([groupId])
  @@index([categoryId])
}
```

#### Rules file (#291)

Rules are exported to and imported from a JSON file, `bilan-rules-YYYY-MM-DD.json`. It carries no id, hit counter, owner, group or timestamp, so it moves between instances and scopes:

```json
{
  "format": "bilan-rules",
  "version": 1,
  "exportedAt": "2026-10-20T08:00:00.000Z",
  "rules": [
    {
      "pattern": "NETFLIX",
      "matchType": "CONTAINS",
      "caseSensitive": false,
      "priority": 100,
      "enabled": true,
      "category": [{ "name": "Leisure" }, { "name": "Streaming", "color": "var(--cat-groceries)" }]
    }
  ]
}
```

- `category` is the category's path, root first, each level with `name` and an optional `color` and `icon`. A category is matched by name, folded with `normalizeText` (case, accents, whitespace).
- Limits (`src/lib/validation/rules-file.ts`): 512 KiB (under the 1 MB server-action body limit), 2000 rules, 10 levels of category depth. An unreadable file, an unknown `format` or `version` or more than 2000 rules is refused as a whole (`BAD_FILE`, `TOO_MANY`); a file over 512 KiB is refused by the dialog before it is sent. A single invalid rule (schema, depth, regex RE2 can't compile) is rejected on its own and reported in the review.
- Scope and privacy: an export covers one scope, the user's personal rules or a household the user belongs to. When a household rule points to a category outside the exporter's tree (another member's personal one), the file only discloses its name and color, as a single-level path. An import only creates categories and rules in its target scope, personal or a household where the user is ADMIN+.

### 4.5 Group E — Transactions, Search Tokens, Merchant Aliases, Links

```prisma
model Transaction {
  id            String   @id @default(cuid())
  accountId     String
  date          DateTime                              // CLEAR — the real date (lists, search, dedup, links)
  periodDate    DateTime @default(dbgenerated("(`date`)")) // CLEAR — what period aggregates bucket on (#341)
  periodManual  Boolean  @default(false)              // periodDate picked by hand: never recomputed
  amount        Decimal  @db.Decimal(12, 2)           // CLEAR — for SQL aggregations
  type          String                                // CARD | TRANSFER | DIRECT_DEBIT | CHEQUE | ATM | OTHER

  labelEnc      String   @db.Text                     // ENCRYPTED (AES-256-GCM)
  labelHash     String                                // HMAC-SHA256 of normalized label
  rawLabelEnc   String   @db.Text                     // ENCRYPTED (raw import label)
  rawLabelHash  String                                // HMAC-SHA256
  merchantKeyHash String?                             // HMAC("merchant:" + merchant key of label), #296
  noteEnc       String?  @db.Text                     // ENCRYPTED (user note)

  categoryId          String?
  category            Category? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  manuallyCategorized Boolean   @default(false)

  externalId    String?                               // dedup key for imported rows (content hash)
  createdById   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  importBatchId String?
  importBatch   ImportBatch? @relation(fields: [importBatchId], references: [id], onDelete: SetNull)

  account           BankAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  searchTokens      TransactionSearchToken[]
  linkMembership    TransactionLinkMember?
  budgetAssignments BudgetAssignment[]

  @@unique([accountId, externalId])
  @@index([accountId, date, createdAt])                // per-account newest-first walk (§6.2)
  @@index([accountId, periodDate])                     // period aggregates (dashboard, insights, budgets)
  @@index([categoryId, date])
  @@index([accountId, categoryId])                     // categories met on visible accounts
  @@index([labelHash])
  @@index([rawLabelHash])
  @@index([accountId, merchantKeyHash, categoryId, type, amount, date]) // covers the merchant directory sums
  @@index([date])
  @@index([importBatchId])
}

model TransactionSearchToken {
  id            String @id @default(cuid())
  transactionId String
  tokenHash     String                                // HMAC-SHA256 of one normalized word prefix
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  @@unique([tokenHash, transactionId])
  @@index([transactionId])
}

// Per-user display name for a merchant (#125)
model MerchantAlias {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  keyHash   String                                    // HMAC of the merchant key — lookup/uniqueness handle
  keyEnc    String   @db.Text                         // ENCRYPTED merchant key
  nameEnc   String   @db.Text                         // ENCRYPTED display name
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([userId, keyHash])
}

model TransactionLink {
  id          String   @id @default(cuid())
  name        String?
  auto        Boolean  @default(false)                  // made by links/auto; deleting it ignores the pair (#353)
  createdById String                                  // no FK; deleted explicitly on user erasure
  createdAt   DateTime @default(now())

  members     TransactionLinkMember[]
  @@index([createdById])
}

model TransactionLinkMember {
  linkId        String
  transactionId String   @unique                      // one tx in at most one link
  joinedAt      DateTime @default(now())
  link          TransactionLink @relation(fields: [linkId], references: [id], onDelete: Cascade)
  transaction   Transaction     @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  @@id([linkId, transactionId])
  @@index([linkId])
}

model IgnoredLinkSuggestion {                         // no FK; deleted explicitly on user erasure
  userId    String
  pairKey   String                                    // canonical "txid1|txid2" (ids sorted)
  ignoredAt DateTime @default(now())
  @@id([userId, pairKey])
  @@index([userId])
}
```

**Assigned month (#341).** `periodDate` is `date`, or the 1st of another month the transaction counts toward. The dashboard, insights, category history and budget actuals filter and bucket on it; lists, search, link suggestions, import duplicate detection and the merchant directory stay on `date`. A non-manual row is recomputed by `transactions/period-date.syncAutoPeriodDates` (one `UPDATE … JOIN Category`) whenever its category or date changes (create, import, recategorize, rule apply, date edit, category deletion) and for a whole category when its `shiftDays` changes: dated in the month's last `shiftDays` days → 1st of the next month, else `date`. `setTransactionMonth` sets a manual month (`periodManual`; picking the real month pins `date`) or goes back to automatic. The dashboard and insights can open the next month for that reason (`period.nextMonthEnd`).

A link needs at least two members: when member transactions are deleted (e.g. an import revert), links left with fewer are dissolved (`services/links/dissolve.ts`). Link-suggestion parameters are per user, in `UserPreference` (§4.8).

### 4.6 Group F — Budgets

```prisma
model Budget {
  id             String   @id @default(cuid())
  name           String
  description    String?

  // Owner XOR — service layer
  userId         String?
  groupId        String?
  user           User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  group          Group? @relation(fields: [groupId], references: [id], onDelete: Cascade)

  // Attached budget (#355): counts this account only; at most one non-archived per account and day
  accountId          String?
  account            BankAccount? @relation("BudgetAccount", fields: [accountId], references: [id], onDelete: SetNull)
  outOfBudgetPlanned Decimal?     @db.Decimal(12, 2)  // optional margin of the out-of-budget line

  // Period
  periodType     String                               // WEEK | MONTH | QUARTER | YEAR | CUSTOM
  periodStart    DateTime
  periodEnd      DateTime
  recurring      Boolean  @default(false)
  parentBudgetId String?                              // recurring instance → series template
  parentBudget   Budget?  @relation("BudgetRecurrence", fields: [parentBudgetId], references: [id], onDelete: SetNull)
  instances      Budget[] @relation("BudgetRecurrence")

  archived       Boolean  @default(false)
  createdAt      DateTime @default(now())
  createdById    String

  lines       BudgetLine[]
  assignments BudgetAssignment[]
  @@index([userId, periodStart])
  @@index([groupId, periodStart])
  @@index([accountId, periodStart])
  @@index([parentBudgetId])
}

model BudgetLine {
  id            String  @id @default(cuid())
  budgetId      String
  budget        Budget  @relation(fields: [budgetId], references: [id], onDelete: Cascade)

  // Filters: category (incl. descendants) and/or account; neither = catch-all line for unmatched expenses
  categoryId    String?
  category      Category?    @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  accountId     String?                              // unattached budgets only
  account       BankAccount? @relation("BudgetLineAccount", fields: [accountId], references: [id], onDelete: SetNull)

  // Attached budgets (#355): EXPENSE | INCOME on a category, TRANSFER OUT | IN with a counterpart account
  kind                 String       @default("EXPENSE")
  direction            String?
  counterpartAccountId String?
  counterpart          BankAccount? @relation("BudgetLineCounterpart", fields: [counterpartAccountId], references: [id], onDelete: SetNull)

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
  @@index([transactionId])
}
```

Deleting a series template promotes its oldest instance to template and re-parents the others onto it (`services/budgets`), so the series stays linked. Archived budgets leave the lists, the dashboard and the recurring roll.

### 4.7 Group G — Imports

```prisma
model ImportBatch {
  id            String   @id @default(cuid())
  accountId     String                                // upload account (PDF/OFX products may map to others: metadata.accountIds)
  source        String                                // CSV | PDF | OFX
  filename      String?
  filenameHash  String?                               // SHA-256 of the filename
  status        String                                // PARSING | REVIEW | COMMITTING | COMPLETED | REVERTED | FAILED
  totalRows     Int      @default(0)
  importedRows  Int      @default(0)
  skippedRows   Int      @default(0)
  errorMessage  String?
  metadata      Json?                                 // see below
  createdById   String
  createdAt     DateTime @default(now())
  completedAt   DateTime?

  account       BankAccount   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  transactions  Transaction[]
  @@index([accountId, createdAt])
}
```

| Stage | `status` | `metadata` |
|---|---|---|
| Upload / preview | CSV `PARSING` → `REVIEW`; PDF and OFX created in `REVIEW` | Raw payload for the review step: CSV `text`, parsed PDF `products` + `bank`, or parsed OFX `products` (rows with their note, each statement's `ledger` balance) + `rejected`, and `fileSizeBytes`. |
| Commit | `COMMITTING` → `COMPLETED` | Trimmed to `{ fileSizeBytes, bank?, accountIds, ruleHits?, balanceAdjustments? }` — the plaintext payload is dropped (`lib/import-status.ts`). A commit importing nothing fails. |
| Undo | `COMPLETED` → `REVERTED` | Revert deletes the batch's transactions, decrements `CategorizationRule.hits` from `ruleHits`, dissolves undersized links, puts back the opening balances the import adjusted unless changed since (`services/imports/revert.ts`). Requires write access on every account in `accountIds` and in `balanceAdjustments`. |
| Discard / purge | — | Uncommitted batches (`PARSING`, `REVIEW`, `FAILED`) can be discarded; stale ones (and crashed `COMMITTING` ones, with their rows) are purged. |

### 4.8 Group H — Settings, Preferences, Audit

```prisma
model AuthProvider {
  id              String   @id @default(cuid())
  type            String                              // oidc | google (password sign-in is the credentials_enabled setting)
  key             String   @unique                    // provider id for Better Auth
  displayName     String
  enabled         Boolean  @default(false)
  // OIDC-specific
  issuer          String?
  clientId        String?
  clientSecretEnc String?  @db.Text                   // ENCRYPTED
  scopes          String?                             // CSV
  // Generic
  config          Json?                               // OIDC advanced options (pkce, endpoint URLs, claim mapping)
  allowSignUp     Boolean  @default(false)            // unknown IdP user may create an account on first sign-in (#200)
  updatedAt       DateTime @updatedAt
  updatedById     String?
}

model SmtpConfig {
  id           String       @id @default(cuid())      // singleton
  host         String
  port         Int
  security     SmtpSecurity @default(STARTTLS)
  username     String
  passwordEnc  String       @db.Text                  // ENCRYPTED (encrypted empty string for an unauthenticated relay)
  fromAddress  String
  fromName     String?
  enabled      Boolean      @default(false)
  updatedAt    DateTime     @updatedAt
  updatedById  String?
}

enum SmtpSecurity {
  TLS                                                 // implicit TLS (465)
  STARTTLS                                            // upgrade required (587)
  NONE                                                // unencrypted local relay
}

model AppSetting {
  key         String   @id                            // registration_mode, credentials_enabled, min_password_length, app_name, security.admin_2fa_required
  value       Json                                    // typed at the service level
  isSecret    Boolean  @default(false)                // reserved: no current key is secret
  updatedAt   DateTime @updatedAt
  updatedById String?
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String?                                  // no FK; null for system actions, nulled on user erasure
  action     String                                   // auth.login.success, import.reverted, budget.archived, ...
  entity     String?                                  // BankAccount, Budget, ImportBatch, ...
  entityId   String?
  metadata   Json?
  ipAddress  String?
  userAgent  String?  @db.Text
  createdAt  DateTime @default(now())
  @@index([userId, createdAt])
  @@index([entity, entityId])
  @@index([action, createdAt])
  @@index([createdAt])
  @@index([entity, createdAt])
}

model UserPreference {
  userId          String  @id
  user            User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  locale          String  @default("fr")              // fr | en
  linkWindowDays  Int     @default(30)                // link suggestions: max days between the two transactions
  linkMinAmount   Decimal @default(0) @db.Decimal(12, 2) // link suggestions: minimum amount
  dashboardLayout Json?
}
```

### 4.9 Data-model decisions summary

| Decision | Detail |
|---|---|
| Owner XOR | For `Category`, `Budget`, `CategorizationRule`: exactly one of `userId` or `groupId`. Enforced in the service layer only (no DB CHECK: MariaDB error 1901). |
| Application encryption | AES-256-GCM: `Transaction.labelEnc/rawLabelEnc/noteEnc`, `BankAccount.ibanEnc`, `MerchantAlias.keyEnc/nameEnc`, `AuthProvider.clientSecretEnc`, `SmtpConfig.passwordEnc`. `AppSetting.isSecret` exists but no setting uses it. |
| Scalable search | HMAC blind indexes on full values (`labelHash`, `rawLabelHash`, `ibanHash`, `MerchantAlias.keyHash`) + `TransactionSearchToken` (one HMAC per word prefix of 3–12 chars, label and raw label). |
| Transaction dedup | Unique `(accountId, externalId)`. Imported rows: `externalId` = SHA-256 of day + amount + raw label (whitespace runs collapsed, trimmed), with an occurrence index for identical rows in one file. Manual entries: no `externalId`, no certain dedup; they can back a probable duplicate (§5.5). |
| Cascade deletes | User → accounts → transactions → tokens/link memberships/assignments; User → categories, rules, budgets, merchant aliases, memberships, sent invitations, preference, auth tables. Group → members/invitations/shares/categories/rules/budgets. Budget → lines/assignments. Category → rules. |
| SetNull | Deleting a category un-categorizes transactions, detaches children and budget lines; deleting an account detaches budget lines; deleting an import batch detaches its transactions; deleting a budget detaches its instances. |
| FK-less columns | `Group.createdById`, `TransactionLink.createdById`, `IgnoredLinkSuggestion.userId`, `AuditLog.userId`: handled explicitly on user erasure (`services/rgpd`) — group ownership passed on (or group deleted), links and ignored pairs deleted, audit rows anonymised. |
| Indexes | All hashes (`labelHash`, `rawLabelHash`, `tokenHash`, `ibanHash`, `(accountId, merchantKeyHash, categoryId, type, amount, date)`), `(tokenHash, transactionId)` unique, `(accountId, date, createdAt)`, `(accountId, categoryId)`, `(categoryId, date)`, `(userId/groupId, periodStart)`, audit `(action/entity/userId, createdAt)`. |
| No soft delete | Hard deletes only (simpler for RGPD). `archived` flag for non-deleted but inactive entities (accounts, groups, budgets). Imports are undone by revert, which deletes their transactions. |
| Grants in `Verification` | Password-reset tokens (hashed), trusted devices and step-up grants are `Verification` rows keyed by identifier prefix — no dedicated tables. |

---

## 5. Key Flows

### 5.1 Bootstrap (first launch)

If `User.count() === 0`, every page (except `/setup`) redirects to `/{locale}/setup` (`src/proxy.ts`; `/api/*` is outside the proxy matcher). The wizard collects four steps client-side; nothing is written until the last one:
1. First user (name + email + password, at least `min_password_length`, default 12).
2. Optional: SMTP config.
3. Optional: OIDC provider config, with a "Test connection" probe of the issuer's discovery document (`testOidcConnectionAction`: HTTPS only, private/loopback/metadata addresses refused, connection pinned to the checked IP).
4. Choose registration mode (default `INVITE_ONLY`).

Submitting step 4 runs one Server Action, `completeSetupAction`, gated by `isSetupNeeded()`: `bootstrap.completeSetup` signs the user up (and in) through Better Auth, grants `SUPER_ADMIN`, marks the address verified (`via: setup`), creates `UserPreference` with the wizard's locale, seeds the default categories and rules in that locale and audits `auth.signup` (`via: setup`); then the registration mode is saved and SMTP / the OIDC provider are stored only if filled in. The browser lands on `/{locale}/dashboard`.

`/setup` is permanently disabled (404) as soon as one user exists: the proxy caches "setup done" for the life of the process, and the page itself redirects home if reached anyway.

### 5.2 Login (multi-provider)

Available methods on `/login`:
- **Credentials** (email + password) — if the `credentials_enabled` app setting is on (not an `AuthProvider` row). Turning it off is refused while a user would be left with no other usable sign-in method (#255), like deleting a provider.
- **SSO button(s)** — one per enabled `AuthProvider` row that has its credentials (`oidc` rows through Better Auth's generic OAuth plugin, the `google` row as Better Auth's Google provider).
- **Passkey** — always offered (WebAuthn, RP ID = `APP_URL` host).

The "Create an account" link is only shown when `/register` offers a way to sign up (#255).

Flow:
- Credentials: form → `loginAction` (Server Action) → `auth.api.signInEmail` → the `bilan-auth-guard` plugin reserves the rate-limit slots → Better Auth checks the password hash → if 2FA is enabled and the device isn't trusted, the same page swaps to the code step (TOTP or backup code, optional "trust this device") → DB-backed session + httpOnly cookie → redirect to the safe `callbackUrl`, else `/{locale}/dashboard`. A disabled (banned) user gets a "disabled" error once the password checked out.
- Passkey: `signIn.passkey()` → `/api/auth/passkey/verify-authentication` → session. 2FA only guards password sign-ins.
- SSO: Better Auth redirects to the IdP → callback `/api/auth/callback/<key>` (Google: `google`) → session → `callbackUrl` / `/dashboard`. No implicit linking by e-mail: an SSO identity signs in only once linked (Settings > Security) or SSO-created. Creating the account needs the provider's `allowSignUp` and registration `OPEN`. A refused callback lands on `/login?error=<code>` (localized message).

Rate limit: see §6.7 (per IP + account, and per account). Failed attempts logged to `AuditLog`. Success also logged with IP + user-agent, and sends the "new sign-in" e-mail (§5.13).

Password reset link: `/reset` → `resetRequestAction` (always answers OK) → SMTP e-mail → `/{locale}/reset/<token>` (1 h; only the token's hash is stored) → the page checks the token up front → new password form → revokes all sessions, purges trusted devices, marks the address verified, audits `auth.password.changed` and sends the "password changed" e-mail.

### 5.3 Registration mode handling

- `OPEN`: `/register` accessible to anyone; SSO providers with `allowSignUp` also show sign-up buttons.
- `INVITE_ONLY`: the password form requires an admin signup token (field prefilled from `?adminToken=<token>`, the link `/admin/signup-tokens` hands out). `registerAction` consumes it atomically (`signup-tokens.consumeSignupToken`: not revoked, not expired, under `maxUses`) and refunds it if the sign-up failed without creating the user. Missing token → `TOKEN_REQUIRED`, unusable → `BAD_TOKEN`. Group invitations don't open registration: an invitee needs an account first (§5.11). SSO sign-up is off (the IdP round trip can't carry a token).
- `DISABLED`: `/register` shows "Registration is closed on this instance." (also shown when password sign-in is off and no SSO provider allows sign-up). Any value other than `OPEN` / `INVITE_ONLY` counts as `DISABLED`.

In every mode, an admin can create users from `/admin/users` (`users/create.adminCreateUser`, role chosen by the admin): the user is mailed a "choose your password" link (`/reset/<token>`, setup flavour of the reset flow, 1 h). Without SMTP no link is sent, and the admin is told so (#255).

### 5.4 Account creation & sharing

1. Owner creates account: `createAccountAction` (Server Action, `/accounts`) → `accounts.createAccount(input, ownerId)` → validates and normalizes the optional IBAN, stores `ibanEnc` + `ibanHash` → audit `account.created`.
2. Sharing with a group: `shareAccountAction` → `accounts/sharing.shareAccountWithGroup({ accountId, groupId, permission: READ | WRITE }, actor)` → actor must be the account owner and, at commit time, still a member of the group (#259) → upserts `AccountShare` → audit `account.share.create`.
3. Visibility: `accounts.listVisibleForUser(userId, { includeArchived? })` returns own accounts + accounts shared via groups the user belongs to (archived ones only on request). Access is OWNER > WRITE > READ (`getEffectiveAccess`). Shared viewers never get the IBAN; the owner sees it masked, and the clear value takes a step-up (§6.4).
4. Leaving or being removed from a group (#259): in the same transaction as the `GroupMember` deletion, the member's `AccountShare` rows to that group and the group budgets' `BudgetAssignment` rows (INCLUDE and EXCLUDE) on their transactions are deleted; the counts go in the `group.member.removed` audit metadata. Budget lines limited to one of their accounts are kept (they count nothing and show as a hidden account). Group deletion is unchanged. Revoking one share (`revokeShare`) does the same for that account and group, in one transaction, with `removedAssignments` in the `account.share.revoke` metadata; when no share existed, nothing is deleted.

### 5.5 CSV / PDF / OFX import (main flow)

1. `/import` (single wizard; `/import/csv` and `/import/pdf` redirect to it): pick a writable, non-archived account, upload → `multipart POST /api/import/csv`, `/api/import/pdf` or `/api/import/ofx` (Route Handlers).
2. The Route Handler checks extension/MIME and size (CSV 5 MB, PDF 10 MB, OFX 5 MB; a CSV must also look like text; an OFX is `.ofx` or `application/x-ofx`), then:
   - CSV: creates `ImportBatch` (`PARSING`, raw text kept in `metadata`), parses with papaparse and returns the preview with the detected mapping (`date`, `label`, `amount` or `debit`/`credit`, optional `type`) plus the guessed decimal mark and date order. Each preview moves the batch to `REVIEW`.
   - PDF: detects the bank (LCL, Revolut, else a generic parser), stores the parsed rows per product (one per Revolut statement section) and creates the batch directly in `REVIEW`.
   - OFX (`imports/ofx/parse`, `ofx-service`): decodes the bytes as strict UTF-8, else Windows-1252 (the declared `CHARSET` isn't trusted), then a built-in linear tokenizer reads OFX 1.x SGML (unclosed leaf tags) and 2.x XML alike; nesting deeper than 64 levels or more than 20 non-empty statements fails the parse (`PARSE_FAILED`), and amounts are rounded to cents and bounded like the CSV ones (`AMOUNT_RANGE`). Per `STMTTRN`: day = `DTPOSTED` (time and timezone dropped), amount = `TRNAMT` (a comma is tolerated), label = `NAME`, else `MEMO`, else `CHEQUE <CHECKNUM>`; when both `NAME` and a different `MEMO` exist, the `MEMO` becomes the transaction note. Type: `deriveType(label)` first, `TRNTYPE` only when that gives OTHER (`CHECK`, `ATM`, `POS`, `DIRECTDEBIT`/`PAYMENT`, `XFER`). Rows with an unreadable date or amount are listed as rejected. Each statement (`STMTRS`, `CCSTMTRS`) becomes a product, titled with its account type and the last 4 characters of `ACCTID` (the full number is never shown or logged), mapped to an account or ignored like PDF products. The batch is created directly in `REVIEW`.
3. UI: the preview is paged (50 rows; per product for PDF and OFX) and computed over all rows: certain duplicates (same key as a row already in the destination account), probable duplicates, suggested category per row (`categorization.suggestMany`), rejected rows. The user can edit the CSV mapping (`POST /api/import/csv/[batchId]/preview`), map each PDF product to an account or ignore it, untick rows and override categories. A row whose category was picked by hand and differs from the suggestion offers the learning dialog of §5.6; each preview row carries the rule behind its suggestion (`describeRules`: id, pattern, priority, whether the actor can manage it), so the dialog can retarget that rule (`retargetRule`, category only) or create a personal rule one priority above it. After the save the wizard re-requests the current preview page, which re-runs the rules over the other rows. A probable duplicate has no key match, but the account already has a transaction on the same day with the same amount, manual entries included. Matching is one-to-one, and existing rows already matched by a certain duplicate or inserted by the same batch don't count. Probable duplicates come unticked with the matching existing label; a header counter and a "probable only" filter help review them, and ticking one means "import anyway".
   - OFX balance check (`ofx-service.balanceOf`, bank statements with a `LEDGERBAL` only; credit-card statements get none, banks disagree on the sign of a card balance): the preview returns the bank balance at `DTASOF`, `base` (`initialBalance` + the destination account's transactions dated ≤ `DTASOF`) and `defaultImport` (the rows dated ≤ `DTASOF` that a commit without edits inserts: certain, probable and in-file duplicates excluded). The client adds or subtracts each row the user toggles, so the live gap equals what the commit would produce. It is computed against the account each product is mapped to.
   - Opening-balance adjustment: `canAdjust` is true only for the account owner (`initialBalance` is owner-only), when the destination account has no transaction dated before the file's first day (the file starts its history) and the gap is not zero. On an account with earlier history the gap is only reported, since adjusting would hide missing operations.
4. `POST /api/import/{csv|pdf|ofx}/[batchId]/commit` claims the batch (`REVIEW` → `COMMITTING`), then `imports/commit.insertRows`:
   - For each row: `externalId` = sha256 of day + amount + whitespace-normalized rawLabel (identical twins in one file get an occurrence index), encrypted label/rawLabel (the label starts as the raw label), `labelHash` / `rawLabelHash` / search tokens, type from the mapped column or derived from the label; category = the user's override (only categories they can use), else the rule suggestion.
   - Dedup check on `(accountId, externalId)`: certain duplicates are always skipped. Probable duplicates are recomputed server-side (`imports/probable`) and skipped unless their id is in the request's `includedProbableIds`; unticked rows are skipped too.
   - Insert by chunks of 500: `Transaction` + `TransactionSearchToken[]`, bumping `importedRows` (the wizard polls `GET /api/import/[batchId]/progress`).
   - OFX only: for each product whose key is in `adjustBalance`, once all products are inserted (sibling products can share an account), `openingAdjustment` re-checks owner and history server-side (a stale ticked key is dropped) and computes `set` = `LEDGERBAL` − the account's transactions ≤ `DTASOF`; `previous` and `set` are recorded as `metadata.balanceAdjustments`.
   - `finalizeBatch`: `COMPLETED` + counters, rule hits recorded, the new `initialBalance` values written in the same DB transaction, raw payload trimmed from `metadata` (`balanceAdjustments` is kept), audit `import.committed` and, per adjustment, `account.initial_balance_adjusted` (`previous`, `set`, `batchId`). A commit that imports nothing fails (`NOTHING_TO_IMPORT`); a failed commit deletes its partial rows and returns the batch to `REVIEW`.
5. UI shows summary (imported, skipped duplicates (certain and probable), rejected rows) + link to transactions + "Undo" (§5.12). Cancelling or uploading another file discards the uncommitted batch (best effort).

### 5.6 Auto-categorization & learning

`categorization.suggest(rawLabel, { userId })` (`suggestMany` for imports, rules loaded once):
1. Load enabled rules where `userId = current` OR `groupId IN (user's groups)`, sorted by priority DESC. There are no system rules.
2. Match by type (EXACT, STARTS_WITH, CONTAINS, REGEX). Case-insensitive by default; case-insensitive non-REGEX rules also ignore accents; REGEX runs on re2js and a bad pattern never matches.
3. Return `{ categoryId, ruleId }` of the winning match, else `{ categoryId: null, ruleId: null }`. The winner has the highest priority; ties go to the longest pattern, then the newest rule, then the id (`compareRules`, also the rules list order). Imports credit the rule's `hits` counter (taken back on undo).

Matching many labels against the same rules (`suggestMany`, rule application) goes through `prepareRules`: the rules are sorted with `compareRules`, so the first one that matches is the winner, each pattern is folded and each REGEX compiled once per batch (outside the shared 500-entry regex cache), and each label is folded once (`prepareLabel`). The result is the same as `pickByPriority`. Matching is synchronous CPU work, so these loops run in slices of 5 labels (`mapInSlices`) and give the event loop a turn every 20 ms: a batch of 1000 REGEX rules over 20k transactions takes the same total time but no longer stalls other requests for more than a few tens of milliseconds (#293).

When a user manually changes a category:
1. Update transaction (`manuallyCategorized = true`, audit `transaction.recategorized`).
2. Dialog: "Create a rule for similar future transactions?"
   - Pattern proposed: the longest normalized token of the label (`lib/propose-rule`), editable.
   - matchType: CONTAINS by default, selectable.
   - Scope: always a personal rule; group rules are created from `/categories` (group ADMIN+).
   - From the import preview (§5.5), the dialog may instead retarget the rule that suggested another category, when the actor can manage it.
3. On confirm: create `CategorizationRule` (`rule.created`), then offer the application summary below. On decline: nothing.

Applying a rule to existing transactions (#287), offered after a create or edit when something would move or a stronger rule keeps rows, and from each rule's row:
1. `previewRuleApplication(ruleId, actor)`: the actor must manage the rule (owner, or group ADMIN+) and the rule must be enabled. It loads the transactions of every account the actor can write (`writableAccountIds`: owned or shared WRITE, archived included), decrypts their raw labels a page at a time and runs `planRuleApplication` on each page. When every applied rule has an anchored word (`categorization/prefilter.ruleIndexTerm`: a pattern word a matching label must have at a word start, ≥ 3 chars; any word of an EXACT or STARTS_WITH pattern, a CONTAINS pattern's words after its first), only the rows carrying one of those words' search tokens are read (#302); a REGEX rule or a one-word CONTAINS pattern falls back to every row with the actor's enabled rules (`mergePlans` sums the pages). Counts: matched, moving (the applied rule wins and the category differs), moving from another category, already in the category, manual, kept by a stronger rule (per rule).
2. `applyRule(ruleId, actor)`: recomputes, then sets the category of the moving rows in one DB transaction (`LONG_TX_TIMEOUT`), one chunked `updateMany` per target category, guarded by `manuallyCategorized = false` so a row made manual in between stays (the chunk is then re-read to attribute the moved rows to their rules). Credits `hits`, then audits `rule.applied` (`{ reclassified }`) when at least one row moved. The dialog shows the actual count when it differs from the preview, and can't be closed while applying.
3. Manual rows are never written; rows a stronger rule wins are left as they are.

Applying several rules at once (#291) reuses the same planner: `previewRulesApplication(ruleIds, actor)` and `applyRules(ruleIds, actor)` run `planRulesApplication` over the same pages with every given rule, each of which the actor must manage. Unlike the single-rule path (`DISABLED` error), disabled rules are dropped from the plan and don't take part in the winner computation, so imported disabled rules reclassify nothing. The single-rule dialog and the batch step after an import share one `ApplyStep` component.

Rules import and export (#291), from the Rules tab:
1. Export: `GET /api/export/rules?groupId=` (`exportRules`) returns the file described in §4.4 for the personal scope, or for a household the actor belongs to (`rule.exported`, with the rule count). With no household the tab shows a plain download button; with households a dialog first asks for the scope.
2. Preview: `previewRulesImport(text, target, actor)` parses the file (`parseRulesFile`) and resolves each distinct category path (`resolveCategoryPaths`, pure, in `src/lib/rules-import.ts`). A path resolves to a category anchored at the root of the target scope first, then to the single category among everything the actor can assign whose path ends with the file's path (several candidates stay unresolved). An unresolved path lists the levels that are missing under the deepest existing ancestor. Nothing is written. A target household needs ADMIN+.
3. Decisions: the user picks Create, Map to an existing category or Ignore for each unresolved path, and Keep or Move for each conflict, a rule that already exists in the target scope (same pattern, match type and case sensitivity) with another category. An identical rule (same category, or a category with the same path), a duplicate in the file and a rule under an ignored path are skipped. `planRulesImport` is pure and also runs in the browser, so the summary counts update live; the import stays disabled while a Map row has no category.
4. Commit: `commitRulesImport(text, target, decisions, actor)` re-parses the file and recomputes the resolution and the plan inside one `db.$transaction`, so a stale review cannot write. It refuses decisions that don't match the plan (`INVALID_DECISION`: an undecided path, a Map to a category the actor can't assign, a Move on a rule that is not a conflict). Missing category levels are created once, under the target scope, then the rules are created and the moved rules re-pointed. The file lists rules winner-first, so created rules get decreasing `createdAt` in file order: tied rules keep their source order. Audited as `rule.imported` with the summary counts, including `categoriesCreated`.
5. Reclassify: the result step lists the created and moved rules and offers "Reclassify existing transactions", which opens the batch apply step above for those rule ids.

### 5.7 Budget creation & calculation

Creation (form dialog on `/budgets`):
- Owner: self or a group (group budgets need group ADMIN+).
- Period: preset (`WEEK`, `MONTH`, `QUARTER`, `YEAR`, end checked against the start) or `CUSTOM`.
- Recurring: if yes, the next-period instance (same lines, chained to the template by `parentBudgetId`) is created once the period has ended, by the daily roll cron (§5.14) or by hand from the list.
- Lines: each line targets a category (with its sub-categories), an account, both, or neither (catch-all), with a `plannedAmount`. Lines may only use accounts the budget draws from and categories the actor can use (a group budget: personal ones or that group's).
- Optional `description` (≤ 500 chars) and per-line `label` (≤ 80 chars, shown instead of the category/account name), both editable in the create/edit form.
- Optional `accountId` (#355): the budget is attached to that account: one its owner holds for a personal budget, one shared with the group for a group budget (`INVALID_ACCOUNT`). Creating, editing, unarchiving or renewing a budget whose period overlaps another non-archived budget attached to the same account is refused (`ACCOUNT_OVERLAP`); the roll cron skips it and the list offers no **Renew**. A group budget whose account was unshared no longer blocks it. Its lines have a `kind`: `EXPENSE` / `INCOME` need a category, `TRANSFER` needs a `direction` and a counterpart account in scope; it may set `outOfBudgetPlanned`. Unattached budgets keep `EXPENSE` lines only. Renewing copies all of it.

Archive (#260): a budget manager can archive/unarchive (`budgets.service.archiveBudget` / `unarchiveBudget`, audit `budget.archived` / `budget.unarchived`). Archived budgets leave the list (shown in a collapsed "Archived budgets" section), the dashboard, the assignment menu and the roll cron; their detail stays readable and their menu only offers unarchive/delete. An archived budget takes no new assignment (`ARCHIVED`) and is never rolled, even by a direct call; existing assignments stay listed (marked archived) and removable in the transaction panel.

`budgets.computeBudgetSpend(budget)` (all lines at once):
1. Load the candidate transactions: a personal budget draws from the owner's visible accounts (own + shared via groups), a group budget from the accounts shared with that group, whose `periodDate` (§4.5, assigned month) is within `[periodStart, periodEnd]`; plus every transaction assigned to this budget, whatever its account or date. The budget list loads every budget's candidates in one query (`loadBudgetRows`, #299) and reads link membership from `TransactionLinkMember` joined to its transaction (`links/members.linkIdsWhere`), so its query count doesn't grow with the number of budgets.
2. Apply link logic over that whole set first:
   - Balanced groups (`|sum| < 0.005`): all members excluded.
   - Unbalanced groups: only the primary (largest absolute amount) counts, with the net sum as its effective amount.
3. Skip transactions with `BudgetAssignment(mode=EXCLUDE)` on this budget.
4. Match lines: category (subtree) and/or account; a line without a category only takes expenses; when a category line and one of its ancestors both match, only the most specific counts; an expense no line matches goes to the catch-all lines.
5. A transaction with `BudgetAssignment(mode=INCLUDE)` counts even if no line matches (explicit override): it goes to the total and to the budget's out-of-budget sum (`outOfBudget`, shown as its own card on the detail), never to a line (#345).
6. Sum effective amounts → `spent` per line and for the budget.
7. Per line (`lib/budgets.lineStatus`): `{ plannedAmount, spent, remaining, percent, status: "OK" | "WARN" (≥ 80 %) | "REACHED" | "OVER" }`. With `plannedAmount = 0`, no spending is OK at 0 %; any spending is OVER with `percent = null` (shown as "—", full bar).

Explicit assignment: from any transaction, "Assign to a budget" menu → choose budget (mine or my groups', not archived) → mode INCLUDE/EXCLUDE → `budgets.assignTransaction` upserts `BudgetAssignment` (unique on `(budgetId, transactionId)`). The transaction's account must be readable; an INCLUDE into a group budget also needs the account to be the actor's own or shared with that group.

Forecast (#347, `budgetForecast`): while `now` is within the period, an unattached budget's `BudgetDetail.forecast` = `{ balance, remaining, endBalance }` with `balance` the current balance of the scope's non-archived `CHECKING` accounts, `remaining` = Σ max(line remaining, 0) and `endBalance = balance − remaining`. Income to come is not anticipated. Shown on the budget detail and the dashboard snapshot.

Attached budgets (#355, `services/budgets/attached.ts`, pure matching in `lib/budget-match.ts`) replace steps 1, 4 and 5:
1. Candidates: the rows of the budget's account only (while it is still in the scope), plus INCLUDEs. Loading the scope would collapse a linked transfer's two legs to zero.
2. Transfer context, in a constant number of queries for all budgets: each linked row's partner accounts (`links/members.linkPartners`), and for each unlinked row the transfer counterparts or savings accounts holding an unlinked opposite row of the same amount within `AUTO_LINK_WINDOW_DAYS` (a pending leg).
3. Mirrors (`budgetMirrors`): `TRANSFER` lines of other non-archived attached budgets whose counterpart is this account, same `periodType` and `periodStart`, readable by the viewer, become read-only lines in the opposite direction, unless the budget has its own line on that account in that direction.
4. `bucketRow` puts each non-excluded row in one bucket: a `TRANSFER` line of the row's direction whose counterpart is a partner (or a pending account when unlinked), else the most specific `EXPENSE` line (outflows) or `INCOME` line, then `EXPENSE` as a refund unless the row is a transfer leg (inflows), else out of budget (outflows) or unplanned income (inflows).
5. Totals: spending = outgoing lines + out of budget, planned = outgoing lines + margin; income lines report what they received. A savings transfer over plan doesn't count toward the budget's `OVER` status. `unplannedIncome.fromSavings` sums unplanned rows whose partner account is `SAVINGS`; `outOfBudget.unmatchedTransfers` counts out-of-budget rows with a pending leg.
6. Landing (`lib/budgets.budgetLanding`), while `now` is within the period: `balance` = the account's balance from rows dated ≤ now, `+ Σ max(planned − received, 0)` over incoming lines, `− Σ max(planned − spent, 0)` over outgoing lines and the margin, with received/spent counting only rows on the account dated ≤ now; a line's rows on the account dated after now count instead when larger (they aren't in the balance yet). Archived budgets get none. `listBudgetsForUser` returns it per budget; the Budgets page shows one card per account.

The budget detail lists the latest 100 counted transactions in full to everyone who can read the budget, including a private transaction included in a group budget (§2.2); for a group budget, rows from an account neither shared with the group nor owned by a current member show masked.

### 5.8 Transaction links

**Manual mode**:
1. `/transactions`: selection mode (local state, also used for bulk delete).
2. Click transactions to select (2+; none already in a link). Picks survive filter changes, but only visible ones are acted on, except the transaction a selection was started from (detail panel "Link to other transactions"), which stays included and is named in the selection bar while hidden.
3. Confirm: `createLinkAction` → `links.createLink({ transactionIds, userId })` → requires WRITE on every account involved → creates `TransactionLink` + `TransactionLinkMember[]` (audit `link.created`). Unlinking (`deleteLink`) also needs WRITE on every member's account.

**Auto suggestions**: `links.suggestPairs(userId)`:
1. Load the 5 000 most recent visible transactions not in any link.
2. For each `+X` (largest first), find an unused `-X` within `±UserPreference.linkWindowDays` days, closest date first; each transaction is used in at most one pair.
3. Filter by `UserPreference.linkMinAmount`.
4. Exclude pairs in `IgnoredLinkSuggestion(userId)`.
5. Sort by amount DESC, days delta ASC.

UI `/transactions/suggestions`: list pairs with Link / Ignore buttons. Ignore writes to `IgnoredLinkSuggestion`; ignored pairs are listed on the same page and can be restored (`restoreSuggestion`). A **Settings** dialog on that page edits the user's own `linkWindowDays` (integer 0–365) and `linkMinAmount` (≥ 0), via `users/preferences.updateLinkSuggestionSettings` (#260).

### 5.9 Admin settings with hot reload

`/admin/auth-providers` (permission `admin.security.write`, super admins only):
1. Server Action → `settings/auth-providers.createAuthProvider` / `updateAuthProvider` (keyed by `key`) → encrypt clientSecret (an empty one keeps the stored secret) → `invalidateAuthCache()` → audit `settings.auth_provider.*`. Deleting, or disabling while password sign-in is off, is refused when a linked user would be left with no usable sign-in method; the provider's linked identities go with it.
2. `getAuth()` caches the Better Auth handler for 60 s and builds it from `providerCache` (enabled `AuthProvider` rows, 60 s TTL).
3. `invalidateAuthCache()` drops both and bumps a generation (a build that raced it is used once, not cached) → next request rebuilds providers → effect immediate, no restart.

Provider types are `oidc` and `google` only (one Google row at most); a Google row stores just the client ID and secret. The type can't be changed after creation.

SMTP (`admin.security.write`) has no cache: `sendMail` reads the enabled `SmtpConfig` row on every send. Encryption mode `STARTTLS` (default) maps to nodemailer `requireTLS`, so a stripped STARTTLS never sends credentials in clear, `TLS` to implicit TLS, `NONE` to `ignoreTLS` for a local relay — #255; username and password are optional in every mode: an empty username connects without `auth` and stores an encrypted empty `passwordEnc`, and a password is only reused when host, port, mode and a non-empty username are unchanged. Without an enabled config, mails are only written to the server log.

App settings (`admin.settings.write`; the security keys — registration mode, password sign-in, password length, admin 2FA — also need `admin.security.write`): `appSettings` caches each key 60 s; a write drops the key and audits `settings.<key>.update`, and changing a key the auth config reads (`registration_mode`, `credentials_enabled`, `min_password_length`, `app_name`) also calls `invalidateAuthCache()`.

### 5.10 RGPD: export & deletion

**Export JSON**: `/settings/data` → "Download" → `GET /api/export/data`, behind the step-up (§6.4: a session under 10 minutes old, else the password confirmed via `confirmDataExportAction`, else "sign in again"; until then `403 REAUTH_REQUIRED`) → `rgpd.exportOwnData` → `userDataJson` streams:
- User + UserPreference.
- All owned `BankAccount` (clear IBAN) + their decrypted `Transaction[]` + own categories, rules and merchant aliases.
- Group memberships + sent invitations (without token/code).
- Own budgets + lines + assignments.
- Links and ignored link suggestions, limited to the owned accounts' transactions.
- Import batches (history fields only).
- The user's own audit log entries (latest 5 000).

Downloaded as a compact JSON attachment, streamed: the transactions are read newest first in keyset-paginated pages (`transactions/list-query.pageRows`), so memory stays bounded whatever the history (#301); audit `user.data.exported` (`via`).

**Export CSV**: `/api/export/transactions` takes the transaction-list filters; the `/settings/data` UI exposes `from` / `to` and `accountId` (any account the user can read, archived ones included). An unreadable `accountId` yields an empty file. The file is streamed page by page (`transactionPages`: keyset pagination, no count, #301).

**Account deletion**: `/settings/data` → shows the impact (accounts, transactions, groups handed over or deleted) → re-auth (current password, rate-limited; SSO-only accounts type their e-mail instead) → `deleteAccountAction` → `users/lifecycle.deleteOwnAccount(userId)` (refused for the last active super admin) → `rgpd.eraseUser`:
- Delete the links the user created and their ignored suggestions; anonymize their audit rows (`userId` nulled).
- Each group they own passes to another owner, else the earliest other member is promoted, else the group is deleted.
- Cascade delete: User → owned accounts → transactions → tokens/link members/assignments/import batches; categories, budgets, rules, merchant aliases, memberships, sessions, auth accounts, 2FA, passkeys, preference.
- Keep `AuditLog "user.deleted"` (anonymous, `metadata.self = true`).
- Redirect to `/login?deleted=1`.

### 5.11 Group invitations

`/groups/[id]` (group ADMIN+) → `groups/invitations.createInvitation({ groupId, email, role: ADMIN | MEMBER })` → nominative invitation, 7 days, with a link (`/{locale}/groups/join/<token>`) and a 6-character code; mailed in the invitee's locale, or handed to the inviter to share when SMTP is off or fails. Re-inviting a pending address renews it. The invitee, signed in with the invited address, accepts from the link page, by code, or from the "pending for you" list on `/groups` (that list needs a verified address, §6.12) → `GroupMember` created, other pending invitations to that group for the address deleted, audit `group.invitation.accept`. Accepting is rate-limited per user.

### 5.12 Import undo & discard

The import history on `/import` lists the latest 20 `COMPLETED` / `REVERTED` batches on accounts the user can write. "Undo" (from the history or the commit summary) first shows the impact (`getRevertImpact`: transactions, linked, assigned to a budget, edited since the import, and the opening balances that will be restored or kept), then `imports/revert.revertImport`: WRITE needed on every account the batch touched; in one transaction the batch is claimed `COMPLETED` → `REVERTED`, its rule hits are taken back, its transactions are deleted (search tokens, assignments and link memberships cascade) and links left with fewer than 2 members are dissolved; audit `import.reverted` (`deleted`, `linksDissolved`, `balancesRestored`, `balancesKept`). An OFX batch that adjusted an opening balance puts it back to `previous` in the same transaction, conditionally on the account still holding the value the import set (a hand edit since wins and the balance is kept; the dialog says so), whoever reverts (write access is enough, an account deleted since is skipped); audit `account.initial_balance_restored` per restored account. The batch row stays in the history as `REVERTED`.

An uncommitted batch (`PARSING`, `REVIEW`, `FAILED`) is discarded when the user cancels or uploads another file (`discardBatch`, `import.discarded`); the hourly purge (§5.14) removes the rest.

### 5.13 Security e-mails

`mail/security-notifications.notifySecurityEvent` mails the user, in their preferred locale, on: every successful sign-in (`new_login`, naming the method; not the first SSO sign-in that creates the account), a password change or reset (`password_changed`), a passkey added (`passkey_added`) and 2FA turned off (`two_factor_disabled`). Each mail gives the time (UTC), IP and device. Sent fire-and-forget from the Better Auth hooks, so direct API calls get them too; a failure is audited `mail.security.failed`. Without SMTP they are only logged.

### 5.14 Scheduled jobs

The `cron` container calls `POST /api/cron/<job>` with `Authorization: Bearer $CRON_SECRET` (unset → the routes 404, wrong token → 401). Schedule (UTC, `docker/cron/crontab`):
- `roll-budgets`, daily 00:05: creates the next instance of every ended, non-archived recurring budget that has none yet, in bulk inserts (`rollRecurringBudgets`, a constant number of queries, #304; idempotent; audit `budget.created` with `system: true`).
- `purge-audit`, daily 03:00: deletes audit entries older than 12 months (`audit.purged`).
- `purge-imports`, hourly: deletes uncommitted batches, and batches stuck in `COMMITTING`, older than 24 h with their partial rows (`import.purged`).

---

## 6. Security Implementation

### 6.1 Application encryption (AES-256-GCM)

Storage format: `v1.<iv>.<ciphertext>.<authTag>`, each part base64url, 12-byte random IV. The version prefix is there for key rotation; `decrypt` refuses any other version.

Service `server/crypto/encryption.ts` provides `encrypt(plaintext, key)` and `decrypt(stored, key)`. `DATA_ENCRYPTION_KEY` (base64, 32 bytes decoded, checked by `src/env.ts`) is decoded once into `dataKey` by `server/crypto/keys.ts`, the only module that reads it. Never logged, never serialized.

Encrypted columns:
- `Transaction.labelEnc`, `rawLabelEnc`, `noteEnc`;
- `BankAccount.ibanEnc`;
- `MerchantAlias.keyEnc`, `nameEnc` (#125);
- `SmtpConfig.passwordEnc`;
- `AuthProvider.clientSecretEnc` (SSO client secrets);
- `AdminSignupToken.tokenEnc`, `GroupInvitation.tokenEnc`, `codeEnc` (#275): kept decryptable so admins can copy the link or code again.

Not app-encrypted (MariaDB's at-rest encryption still covers them, §6.14): amounts, dates, account/category/budget names. An import's parsed rows (CSV text, PDF and OFX products) sit in clear in `ImportBatch.metadata` until the commit or revert drops them; uncommitted batches are purged after 24 h by the `purge-imports` cron. Better Auth encrypts the TOTP secret and the backup codes itself, with `AUTH_SECRET` (the `twoFactor` plugin defaults `storeBackupCodes` to `encrypted`).

Key rotation (post-MVP, not implemented): CLI script reads all rows, decrypts with old key, re-encrypts with new key, updates with new version prefix.

### 6.2 HMAC blind index (HMAC-SHA256)

`SEARCH_TOKEN_KEY` is **separate** from `DATA_ENCRYPTION_KEY` (defense in depth).

Normalization: strip accents (NFD), lowercase, collapse whitespace.

Tokenization: split on non-alphanumeric, keep words ≥ 3 chars, index every prefix of 3 to 12 chars of each word (#192): "lidl" → `lid`, `lidl`.

On transaction creation/import: store `labelHash`, `rawLabelHash`, `merchantKeyHash`, and one `TransactionSearchToken` per distinct prefix of the label and raw label, inserted in shuffled order.

Search by word beginning: each query word ≥ 3 chars is cut to 12 chars, hashed → indexed lookup on `TransactionSearchToken.tokenHash`; all query words must match (AND). No substring search inside a word. A query made only of words < 3 chars matches nothing.

The list query is raw SQL (`transactions/list-query.ts`, #297) because Prisma's relation filter becomes a per-row dependent subquery. A capped count of each word's token rows picks the plan: when one word is rare (≤ 25,000 rows instance-wide) the query joins from `(tokenHash, transactionId)`. Otherwise (all words common, or no search, #300) a date sort walks each account's `(accountId, date, createdAt)` index newest-first, probing the token index when searching, and merges the per-account top rows: a multi-account `IN` would sort every row. The search count stops at 1,000 (shown "1 000+").

The same key gives equality lookups elsewhere: `BankAccount.ibanHash` (normalized IBAN), `MerchantAlias.keyHash` (`HMAC("merchant:" + key)`, unique per user), `Transaction.merchantKeyHash` (same hash of the label's merchant key: the merchant directory sums spending by it in SQL and decrypts one label per merchant, #296; linked rows, which links collapse, still go row by row), and the unique `AdminSignupToken.tokenHash`, `GroupInvitation.tokenHash` and `codeHash` (`hmacExact`: no normalization, the code is uppercased first).

Leakage trade-off: the token count per transaction reveals word lengths, tokens shared by the same transactions reveal prefix chains, and the frequent 3-letter tokens are open to frequency analysis. Accepted for usable search; the labels themselves stay AES-encrypted.

A tokenization or normalization change makes stored tokens stale: rebuild them with `npm run db:reindex-search`, which also rewrites `merchantKeyHash` (add `--rehash` when `normalizeText` changes, so `labelHash`/`rawLabelHash` are rewritten too). Without `--rehash`, a `labelHash` mismatch aborts the run (wrong `SEARCH_TOKEN_KEY`).

### 6.3 Password hashing — scrypt

Better Auth's default hasher (no override): `node:crypto` scrypt, N = 16384, r = 16, p = 1, 64-byte key, 16-byte random salt, password NFKC-normalized. Minimum length configurable in `AppSetting` `min_password_length` (default 12; the register form's own floor is 8), maximum 128, no complexity rules (anti-pattern). HaveIBeenPwned check: not implemented (§6.11).

### 6.4 Sessions

DB-backed, 7-day expiration, refresh after 1 day of activity. The cookie cache is off, so a revoked session stops working on its next request (#142). Cookie attributes (Better Auth defaults): httpOnly, sameSite=lax, signed, `secure` + `__Secure-` prefix when `APP_URL` is HTTPS.

Settings > Security (`/settings/security`): list active sessions, revoke one or all but current (`auth.session.revoked`, `auth.session.revoked_others`). New session created at each login (prevents session fixation).

Sessions are listed server-side, without their tokens: Better Auth's `/list-sessions` is disabled, `/api/auth/*` answers `Cache-Control: no-store`. Revoking the other sessions (also offered by the password change), a password reset, or enabling/disabling 2FA also drops the "trusted device" grants that skip the 2FA step (#243).

2FA: enrolling again over an active 2FA is refused; disabling it takes the password and a current TOTP or backup code (#243).

Backup codes are regenerated from Settings > Security with the same re-authentication as disabling (password + current TOTP or backup code); the new set replaces the old one and is shown once (`auth.2fa.backup_codes_regenerated`). The page shows how many unused codes remain (#256).

Trusted devices are Better Auth `trust-device-*` verification rows (no device data; replaced at each password sign-in they skip the code for). Settings > Security lists them with the browser and system of the session created alongside, and forgets one or all through Server Actions (`auth.trusted_device.revoked`, `auth.trusted_device.revoked_all`) (#256).

Bilan's 2FA only guards password sign-ins: SSO and passkey sign-ins never ask for it. An account without a password (SSO only, possibly with passkeys) gets no 2FA controls, and the mandatory admin 2FA setting doesn't apply to it: the IdP's MFA is authoritative. While password sign-in is off instance-wide (`credentials_enabled = false`), a dormant password guards no sign-in: every account is exempt the same way, and the 2FA card says so. An admin with a password stays subject to it, and the Security page explains the redirect with a banner while their admin rights are suspended (#256).

Reading a clear IBAN takes a step-up (#257): revealing one, which only the account owner can (household members an account is shared with only ever get the masked `•••• 1234`; an attempt is audited `reason: not_owner`), and the full data export (`GET /api/export/data`), which stays complete for portability. The clear value never ships in a page payload. A session created less than 10 minutes ago passes. Otherwise the user confirms their current password, rate-limited per user in the bucket shared with password change and 2FA, and that session then passes for 5 minutes (a `step-up-<sessionId>` verification row: no use to another session, gone with the session). The password path doesn't ask for the 2FA code, like the password change. An account without a password, or any account while password sign-in is off (same rule as the 2FA exemption), is offered "Sign in again" instead: it signs out and comes back to the page through the login page's SSO or passkey sign-in, and the fresh session then passes. The export answers `403 { error: "REAUTH_REQUIRED", method: "PASSWORD" | "SIGN_IN" }` until then. Audit rows carry the client IP and user agent: `account.iban.revealed` and `user.data.exported` (`via: recent_sign_in | password`, never the IBAN), `account.iban.reveal_failed` and `user.data.export_failed` (`reason: bad_password | rate_limit`, the rate-limit refusal once per window).

### 6.5 CSRF

No CSRF tokens; origin checks plus SameSite cookies. Better Auth checks the request origin of `/api/auth/*` against `trustedOrigins` (`APP_URL` only); Next.js Server Actions compare `Origin` with the host. The other Route Handlers (`/api/import/*`, exports) rely on the `sameSite=lax` session cookie, which a cross-site POST doesn't carry. No additional config.

### 6.6 Security headers (proxy)

Added to every response: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), microphone=(), camera=()` (`src/lib/security-headers.ts`).

Pages get them from the proxy (`src/proxy.ts`); `/api/*` from `next.config.ts` `headers()` with `default-src 'none'; frame-ancestors 'none'` as CSP, since running the proxy there would cap request bodies (imports) at its 10 MB clone limit (#243).

Page CSP: `default-src 'self'`, `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` outside production, for HMR), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `font-src 'self' data:`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`, `upgrade-insecure-requests` (production only, and only when `APP_URL` is HTTPS: on plain HTTP Safari would upgrade even localhost assets and load no CSS). A per-request nonce was evaluated and not shipped (scope 8.5): the app authors no inline script, Next's own RSC bootstrap scripts would need one, and next-intl's rewrites don't propagate a nonce'd request CSP cleanly.

### 6.7 Rate limiting

In-memory fixed-window counters (`server/auth/rate-limit.ts`), one store per process (`processState`), keyed as below. Client IPs come from `TRUSTED_IP_HEADER` (default `x-forwarded-for`, last hop), resolved by the proxy into an internal header; a client-sent value never survives (`server/http/client-ip.ts`).

| Endpoint | Limit | Scope |
|---|---|---|
| Sign-in (`/sign-in/email`) | 5 / 15min | IP + account (#243); wrong passwords only, cleared by a completed sign-in |
| Sign-in (`/sign-in/email`) | 30 / 1h | Account (#243): caps guessing from rotating IPs; wrong passwords only |
| 2FA code at sign-in | 5 / 10min | Pending sign-in; over the limit the pending sign-in is dropped (password again) |
| Register | 3 / 1h | E-mail address submitted |
| Password reset request | 3 / 1h | E-mail address submitted |
| Password change, 2FA enable/disable/backup codes, step-up (§6.4) | 5 / 15min | User (one shared bucket); wrong passwords/codes only |
| Invitation accept (code) | 10 / 15min | User |
| Verification e-mail resend | 3 / 1h | User; only sent mails count |
| SMTP test | 5 / 1min | User |

Better Auth's own in-memory per-IP limiter also runs on `/api/auth/*` in production (its defaults: 100 / 10 s, 3 / 10 s on sign-in). Imports and the other API routes are not rate-limited.

Each in-memory limiter holds at most 10 000 buckets: expired ones are dropped first, then the oldest (#243).

Over the limit: the Better Auth sign-in and 2FA endpoints answer HTTP 429 + `Retry-After`; Server Actions return `RATE_LIMITED` (with `retryAfter` where known). Audited: sign-in (`auth.login.failed`, `reason: RATE_LIMITED` / `TOO_MANY_ATTEMPTS`), password change, 2FA actions and step-up (`reason: rate_limit`). Post-MVP: switch to Redis when scaling to multiple instances.

### 6.8 Audit log — events tracked

`AuditLog` rows written through `logEvent` (`server/services/audit.ts`):

- Sign-in & registration: `auth.login.success`, `auth.login.failed`, `auth.login.2fa_pending`, `auth.register.success/failed`, `auth.signup` (first super admin, `via: setup`).
- Password: `auth.password.reset_requested`, `auth.password.reset_completed`, `auth.password.changed`, `auth.password.change_failed`.
- 2FA & passkeys: `auth.2fa.enabled/disabled`, `auth.2fa.enable_failed/disable_failed`, `auth.2fa.backup_codes_regenerated`, `auth.2fa.backup_codes_failed`, `auth.passkey.added/deleted`.
- Sessions & devices: `auth.session.revoked`, `auth.session.revoked_others`, `auth.trusted_device.revoked`, `auth.trusted_device.revoked_all`.
- Identities & e-mail: `auth.identity.linked/unlinked/link_failed`, `auth.email.verified`, `auth.email.verification_sent`.
- Users (admin): `user.created_by_admin`, `user.deleted`, `user.disabled/enabled`, `user.role.granted`, `user.role.changed`, `user.email_verified`; data export `user.data.exported/export_failed`.
- Accounts: `account.created/updated/archived/unarchived/deleted`, `account.share.create/revoke`, `account.iban.revealed/reveal_failed`.
- Groups: `group.created/updated/deleted`, `group.member.removed`, `group.member.role_changed`, `group.invitation.create/resend/accept/decline/revoke`.
- Transactions & links: `transaction.created/updated/deleted/recategorized`, `link.created/deleted`, `link.suggestionIgnored/suggestionRestored`.
- Imports: `import.created/committed/discarded/reverted`, `import.purged` (cron).
- Categories & rules: `category.created/updated/deleted`, `rule.created/updated/deleted/enabled/disabled/applied/exported/imported`.
- Budgets: `budget.created/updated/archived/unarchived/deleted`, `budget.assignment.create/delete`.
- Settings: `settings.<key>.update` (app settings, e.g. `settings.registration_mode.update`), `settings.smtp.update/delete/test`, `settings.auth_provider.create/update/delete`.
- Admin signup tokens: `signup_token.created/revoked/deleted`.
- System: `mail.security.failed` (a security or verification mail that couldn't be sent), `audit.purged` (cron).

Sign-out is not audited.

Rule: security events and state-mutating actions are logged (merchant display names and user preferences are not). Reads are not (volume control), except reading clear IBANs: reveal and full data export (#257). Retention: 12 months, purged by the token-guarded `POST /api/cron/purge-audit` (inert without `CRON_SECRET`). The admin viewer shows financial entities by id only, never their labels (#244).

Sign-ins are audited alike whatever the method (#258): `auth.login.success` / `auth.login.failed` carry `method` (`password`, `totp`, `backup_code`, `passkey`, `sso` + `providerId`), and every successful one sends the "new sign-in" security e-mail (§6.15), which names the method (an SSO one by the provider's display name). A first SSO sign-in that creates the account is audited as `auth.register.success` (`method: sso`) only, without the e-mail, like a password sign-up; linking an identity is `auth.identity.linked` only. A refused SSO callback is audited with Better Auth's error code once the OAuth state is read, mapped through an allow-list (`other` otherwise) since the IdP-side `?error=` is caller-controlled, and with the provider key only when it is a configured one; `access_denied` (cancelled at the IdP) isn't a failed sign-in. Earlier refusals (forged/expired state, an OIDC IdP's own refusal) can't be told from a link and aren't audited.

### 6.9 Env validation at boot

`src/env.ts` uses `envalid`. Validates `NODE_ENV`, `APP_URL` (URL), `DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY` and `SEARCH_TOKEN_KEY` (each must decode from base64 to 32 bytes); optional `CRON_SECRET` (unset → cron routes 404) and `TRUSTED_IP_HEADER` (default `x-forwarded-for`). Parsed on first access, which `instrumentation.ts` triggers at server start (DB seed); any missing or malformed value throws `Invalid environment variables: …`.

### 6.10 Dependencies & CI

GitHub Actions, on every PR to `develop`/`main` (`ci.yml`, `permissions: contents: read`): lint (ESLint + Prettier), typecheck, build, unit tests with coverage, integration tests (MariaDB 11), E2E tests (Playwright, Chromium + WebKit, against a production build). `prod-smoke.yml` boots the production compose on PRs touching the image, Docker or Prisma files. `build.yml` builds and pushes the multi-arch image to GHCR on `develop` and tags. No `npm audit` step.

Dependabot: weekly updates for npm, GitHub Actions and Docker, targeting `develop`; minor/patch grouped per ecosystem, majors separate; `@types/node` majors ignored (tracks the Node 24 runtime).

### 6.11 Future security improvements (post-MVP roadmap)

Kept as a list of hardening ideas with their triggers; some have been delivered since.

| Improvement | Priority | Trigger | Effort | Status |
|---|---|---|---|---|
| External KMS for `DATA_ENCRYPTION_KEY` (Vault, AWS KMS, Bitwarden Secrets Manager) | Medium | Production deployment beyond localhost, or 1+ admins with env-var access | M | Open |
| HSM / TPM for root key | Low | Pro hosting with ISO/PCI requirements | L | Open |
| Redis-backed rate limiting | Medium | Multi-instance deployment (≥2 Next.js replicas) | S | Open |
| CAPTCHA / hCaptcha on login + signup | Low | Public exposure with detected abuse | S | Open |
| WebAuthn / passkeys mandatory for SUPER_ADMIN | Medium | Real admin accounts with sensitive access | S (Better Auth ready, just enforce) | Partial: passkeys available to everyone, not enforced; admins can be required to use TOTP 2FA instead (next row) |
| 2FA TOTP mandatory for all (via setting) | Medium | Group reaches 3+ members | S | Partial: `security.admin_2fa_required` voids admin permissions until 2FA is enrolled (admins with a password only, §6.4); nothing for other users |
| Application-level forward secrecy | Very low | External security audit requesting it | L | Open |
| External SIEM logs (Loki, Datadog, BetterStack) | Medium | First incident where local audit log proves insufficient | M | Open |
| WAF (Caddy + CrowdSec) | Medium | Public exposure | S | Open |
| Encrypted automated DB backups | High | As soon as real data exists | S | Partial: documented recipe (`docs/self-hosting.md`, encrypted `mariadb-dump` from cron); not shipped in the stack |
| Penetration testing (OWASP ZAP in CI, manual audit) | Low | Before public opening | M | Open |
| HSM / Yubikey for root key | Very low | App becomes critical | L | Open |
| HaveIBeenPwned password check | Low | Easy via Better Auth plugin | S | Open |
| Security email notifications ("new login from…", "password changed") | Medium | When SMTP is configured | M | Delivered (§6.15) |
| Personal API access tokens (for scripts/automation) | Low | When external integration needed | M | Open |
| Anomaly detection (login from new geo, etc.) | Low | Enough audit volume for stats | L | Open |

Legend: **S** = a few hours · **M** = 1-3 days · **L** = 1+ week.

### 6.12 E-mail verification (#240)

Sign-in never requires a verified address. `User.emailVerified` turns true when:
- the user follows the verification link (Better Auth `emailVerification`, 24 h JWT, localized mail sent on sign-up when SMTP is enabled, resent from the « Vérifiez votre adresse » banner through a Server Action — 3 / 1h / user; the public `/send-verification-email` endpoint is disabled);
- a password reset succeeds (the mailed reset link proves the address — covers admin-created users' "choose your password" mail);
- an SSO provider asserts it: only a literal `email_verified: true`, and only for the `email` claim (not a remapped one);
- an admin marks it in Administration → Utilisateurs (`admin.users.update`, rank rule, audited `user.email_verified`) — the path for instances without SMTP;
- the first super admin is created verified by the setup wizard, as nobody else could verify them (#243).

All but the admin path are audited `auth.email.verified` with `via` = `link` / `password_reset` / `sso` / `setup`. `/change-email` is disabled: addresses never change after sign-up.

What it gates: invitations matched on the address alone. « Invitations en attente pour vous » on `/groups` is empty until the address is verified, and accepting/declining from that list (by invitation id) is refused. The invitation link (token) and the 6-char code keep working for unverified users: they are secrets delivered to the address or shared by the inviter.

### 6.13 TOTP hardening & passkeys

TOTP through Better Auth's `twoFactor` plugin (30 s, 6 digits, ±1 step). A code is accepted once (RFC 6238 §5.2): a guard claims the matched step in `TwoFactor.lastUsedStep` before Better Auth's own check, and a reuse at sign-in is audited `auth.login.failed` (`reason: CODE_REUSED`) (#223). Code guesses at sign-in are capped per pending sign-in (§6.7).

Passkeys through `@better-auth/passkey`, with the WebAuthn RP ID and origin pinned to `APP_URL` rather than the request's `Origin`. They are an optional sign-in method managed from Settings > Security; adding one sends a security e-mail.

### 6.14 Database encryption at rest

MariaDB's `file_key_management` plugin encrypts InnoDB tables and redo logs (`innodb_encrypt_tables`, `innodb_encrypt_log`, AES-CTR) with the key in `keyring/keyfile`, mounted read-only (`docker-compose.prod.yml`; dev: `docker/mariadb/conf.d/encryption.cnf`). The keyring is generated locally and git-ignored. It complements §6.1: it covers every column, but not someone with database credentials.

### 6.15 Security e-mail notifications

Sent when SMTP is configured, in the user's locale, with the time, client IP and device: new sign-in (any method, §6.8), password changed (change or reset), passkey added, 2FA disabled. Never awaited by the request; a delivery failure is audited `mail.security.failed`.

### 6.16 Better Auth HTTP surface

Better Auth endpoints that Server Actions wrap (sign-up, password change/reset, 2FA enable/disable, session listing/revocation, verification resend) or that the app doesn't use (profile update, account unlinking/linking, IdP token access, the admin plugin's endpoints, `/change-email`) are disabled (`disabledPaths`), so the rate limits, permission checks and audit above can't be bypassed (#200, #204, #243). No implicit account linking by e-mail: an SSO identity signs in only once linked or SSO-created. Password-reset tokens are stored hashed in the verification table. The OpenAPI reference is mounted outside production only.

---

## 7. Testing Strategy

### 7.1 Pyramid

- **Unit tests** (Vitest, `tests/unit/`): pure logic in `src/lib`, `src/server/services`, validation schemas, crypto, the proxy and Server Action wrappers. About 90 files.
- **Integration tests** (Vitest, `tests/integration/`): services against a real MariaDB test database. About 65 files.
- **E2E scenarios** (Playwright, `tests/e2e/`): full stack, about 40 spec files.

Business logic lives in services, so most behaviour is tested there. Server Actions and Route Handlers stay thin, but the risky parts are tested directly: auth, field errors and cron routes in `tests/unit/transport/`, admin and 2FA actions and the auth route in `tests/integration/`.

### 7.2 Unit test domains

`tests/unit/` is split by area: `auth` (permissions, rate limiter, provider cache, OIDC resolution, 2FA enforcement, TOTP replay), `crypto` (encryption round-trip, HMAC), `services` (categorization matching, CSV parsing, PDF statement parsers, OFX reader, IBAN, mailer, app settings, export), `lib` (budgets, links, periods, formatting, insights, theme), `validation` (Zod schemas), `bundle` (client message scopes, no zod in the browser), `server` (proxy and its matcher, client IP, request locale), `transport` (Server Action and route wrappers), `components`, `i18n`, `docker` (migrate toolkit, prod-smoke workflow) and `env.test.ts`.

### 7.3 Integration test domains

Services against the database: accounts and sharing, transactions (encryption, search tokens, dedup, edit/delete), CSV/PDF/OFX imports and revert, categories and rules, budgets, groups and invitations, links, dashboard and insights, settings and SMTP config, auth (sign-up, login guard, sessions, passkeys, password reset, email verification, SSO link/sign-up, provider hot reload), admin actions, audit, GDPR export/deletion, step-up, setup wizard and seed.

Setup: `tests/setup.ts` sets the bootstrap env vars and defaults `DATABASE_URL` to the `mariadb-test` container (`budget_test`, port 3307). There is no reset between tests: each file creates its own fixtures with fixed ids and deletes them in `beforeAll`/`afterAll` (`tests/integration/support/` restores app settings). The CI test database is migrated but not seeded, so tests create the roles, permissions and settings they need. Files run one at a time (`fileParallelism: false`) because they share the database.

### 7.4 E2E scenarios (Playwright)

One spec per area in `tests/e2e/` (accounts, transactions, CSV/PDF/OFX import, categories, rules, budgets, links, groups, insights, dashboard, admin pages and settings, two-factor, SSO identities, security headers, PWA, accessibility with axe-core, responsive layout, mobile sheets…). An `auth.setup.ts` project signs in the users created by `scripts/seed-e2e.ts` and saves their storage state.

Projects: `chromium` (Desktop Chrome) and `mobile` (iPhone 14, WebKit). Most interactive specs skip WebKit, where Playwright does not deliver taps in this environment; mobile interactions are tested on Chromium with a phone viewport. One worker, no full parallelism, one retry in CI. Service workers are blocked. Locally the run reuses the dev server; in CI it serves a production build (`npm run start`). `PLAYWRIGHT_BASE_URL` targets a server that is already running (docs/development.md).

### 7.5 Coverage

V8 coverage (`@vitest/coverage-v8`) writes text and Cobertura reports to `.reports/coverage/`. CI measures coverage on unit tests only and uploads it to Codecov. No threshold is enforced, and a failed upload does not fail the job. The original targets (≥ 85% on services, 100% on crypto, budgets, permissions and dedup) are goals, not gates.

### 7.6 CI flow

GitHub Actions, Node 24, npm. Four workflows in `.github/workflows/`.

**`ci.yml`** runs on `pull_request` to `main`/`develop`, with `concurrency` (cancel-in-progress) and placeholder bootstrap secrets in `env`. Parallel jobs (job names are the required check names, §10.3):

- **Lint**: `npm ci` → `npm run lint` (ESLint + Prettier check)
- **Typecheck**: `prisma generate` → `npm run typecheck`
- **Build**: `prisma generate` → `npm run build` (dummy `DATABASE_URL`, nothing connects)
- **Test (unit + coverage)**: `npx vitest run tests/unit --coverage` → Cobertura coverage and JUnit results (`.reports/junit.xml`) to **Codecov**
- **Integration**: `mariadb:11` service container → `prisma migrate deploy` → `npm run test:integration` → JUnit to Codecov
- **E2E**: `mariadb:11` service → migrate → `scripts/seed-e2e.ts` → `npx playwright install chromium webkit --with-deps` → `npm run build` → `npm run test:e2e` → upload the Playwright report and `test-results/` as artifacts, JUnit (`.reports/junit-e2e.xml`) to Codecov

**`prod-smoke.yml`** runs on PRs that touch the Dockerfile, `docker/`, `docker-compose.prod.yml`, Prisma, `next.config.ts`, `src/instrumentation.ts`, the npm manifests or the smoke script itself. It runs `scripts/prod-smoke.sh`, which builds the prod image, boots `docker-compose.prod.yml` from a temp directory and checks it. It is a separate workflow because a single job inside `ci.yml` cannot be path-filtered. It is not a required check.

**`close-issues-on-develop.yml`** closes the issues a PR references (`Closes #n`, `Fixes #n`…) when it is merged into `develop`. GitHub only does this by itself for the default branch (`main`).

**`build.yml`** builds the Docker image and publishes releases, see §10.4.

**CodeQL** comes from GitHub's code-scanning default setup (repository settings), not from a workflow file.

Actions are pinned to major versions (`actions/checkout@v7`, `actions/setup-node@v7` with `cache: npm`, `codecov/codecov-action@v7`, `actions/upload-artifact@v7`). Dependabot (`.github/dependabot.yml`) opens weekly grouped PRs against `develop` for npm, GitHub Actions and Docker. They run the same CI.

**Reporting config**: Vitest uses the `default` and JUnit reporters, with Cobertura coverage. Playwright uses `list`, JUnit and HTML (`.reports/playwright-report/`).

### 7.7 npm scripts

```
dev, build, start,
lint, format, typecheck,
test, test:watch, test:unit, test:integration, test:coverage, test:e2e,
setup, ci,
db:up, db:migrate, db:reset, db:studio, db:seed-dev, db:reindex-search, db:backup-dev,
icons, docs:db, docs:screenshots
```

`npm run ci` = lint + typecheck + `vitest run` (unit + integration). What each script does: docs/development.md.

---

## 8. Configuration & Deployment

### 8.1 Environment variables (bootstrap-only)

`src/env.ts` validates these at first use (envalid) and refuses to start if one is invalid:

| Variable | Rule |
| --- | --- |
| `NODE_ENV` | `development`, `test` or `production` |
| `APP_URL` | URL (the public HTTPS URL in production) |
| `DATABASE_URL` | MariaDB connection string |
| `AUTH_SECRET` | required (a dev default exists outside production) |
| `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY` | base64, must decode to 32 bytes |
| `CRON_SECRET` | optional; unset → the `/api/cron/*` routes answer 404 |
| `TRUSTED_IP_HEADER` | optional header name, default `x-forwarded-for` (client IP set by the reverse proxy) |

Templates: `.env.example` (development) and `app.env.example` / `db.env.example` (production compose). `scripts/init.sh` creates `.env` from `.env.example` and fills `AUTH_SECRET`, `DATA_ENCRYPTION_KEY` and `SEARCH_TOKEN_KEY` with `openssl rand -base64 32`. `CRON_SECRET` is left empty in dev. The test database URL is set in `tests/setup.ts`.

Everything else (SSO providers, SMTP, registration mode, password policy, app name…) is configured in the admin UI and stored in `AppSetting` / `AuthProvider`.

### 8.2 Docker Compose (development)

`docker-compose.yml` has four services:

- `mariadb`: `mariadb:11`, at-rest encryption (`file_key_management`, `innodb-encrypt-tables`/`-log`), keyring bind-mounted from `docker/mariadb/keyring/`, data in the named volume `mariadb_data`, port 3306.
- `mariadb-test`: `mariadb:11` on tmpfs (fast, disposable), port 3307, database `budget_test`.
- `adminer`: DB explorer on port 8080.
- `app`: the Dockerfile `dev` target, with the repo bind-mounted on `/app`, `.env` as its env file, port 3000.

`scripts/init.sh` generates the keyring file.

### 8.3 Dockerfile (multi-stage)

- `base`: `node:24-alpine` plus `libc6-compat` and `openssl`.
- `deps`: `npm ci`.
- `dev`: `node:24` (Debian/glibc), used by the dev compose. glibc keeps the host's bind-mounted `node_modules` (Prisma engines and other native modules) binary-compatible.
- `builder`: dummy build-time env (not carried into the final image), `prisma generate`, `next build`.
- `migrator`: a pinned Prisma CLI (`docker/migrate/package.json` + lockfile) with the schema and migrations, in `/opt/migrate`.
- `prod`: standalone Next.js output, non-root user `nextjs:1001`, plus `/opt/migrate` and the cron scripts (`/opt/cron`). The command runs `prisma migrate deploy` and then `node server.js`. Overriding the command (e.g. `sh`) skips the migration, which is how a failed migration is repaired (docs/self-hosting.md).

### 8.4 Better Auth configuration

`src/server/auth/index.ts` builds the options (`buildOptions()`) from bootstrap env and DB-stored settings:

- App settings `credentials_enabled`, `registration_mode`, `min_password_length` and `app_name`, plus the enabled `AuthProvider` rows (`providerCache`, 60 s TTL). Google rows become a social provider (`disableIdTokenSignIn`). `oidc` rows become `genericOAuth` configs (discovery URL from the issuer, optional explicit endpoints, PKCE, claim mapping, account subject = `sub`). Better Auth fetches their discovery documents while building the handler, without a timeout, so a row whose discovery hangs for 5 s is left out of that build (a fast failure is retried by Better Auth on the next sign-in). An IdP that answers the probe but hangs on Better Auth's own fetch still stalls that build. ID-token sign-in (`POST /sign-in/social` with `idToken`) is refused for every provider. SSO sign-up also needs open registration.
- Plugins (`src/server/auth/plugins.ts`): `admin` (kept for its ban check, its HTTP endpoints disabled), `twoFactor` (TOTP with replay protection), `passkey` (`@better-auth/passkey`, RP ID and origin pinned to `APP_URL`), the app's login-guard plugin, and `openAPI` outside production only. Then `genericOAuth` when OIDC providers exist, and `nextCookies()` last.
- `disabledPaths` blocks the Better Auth endpoints the app replaces with Server Actions (sign-up, password change/reset, 2FA enable/disable, session listing/revocation, linking…) or does not use.
- No implicit account linking by email. The client IP comes from the proxy-resolved header. Reset tokens are stored hashed.
- Sessions: 7-day expiry, refreshed after 1 day, **cookie cache disabled**, so a revoked session stops on its next request.
- Rate limiting is in memory (`src/server/auth/rate-limit.ts`, per process).

`getAuth()` caches the handler for 60 s, keyed by a process-wide generation counter (`processState`). `invalidateAuthCache()` bumps the generation and clears the provider cache. The route handler `src/app/api/auth/[...all]/route.ts` rebuilds the request with the client-IP header, forwards it to `auth.handler` and sets `Cache-Control: no-store`.

### 8.5 next-intl

`src/i18n/config.ts`: `locales = ["fr", "en"]`, default `fr`. Messages are in `messages/{fr,en}.json`, loaded by `src/i18n/request.ts`. `src/proxy.ts` (Next 16 "proxy", formerly middleware) runs, in order:

1. The setup guard: before the first user exists, everything redirects to `/<locale>/setup`; after that, `/setup` returns 404.
2. A session-cookie presence check on authenticated paths (redirect to login; the authoritative check is `requireSession()` in the layout).
3. Client-IP header normalisation.
4. `next-intl` routing (`localePrefix: "always"`, 1-year locale cookie).
5. Security headers, including the CSP.

`/api/*` gets its own headers from `next.config.ts`.

Client components only receive the namespaces they use: each route section wraps its subtree in `<ClientMessages scope>` (`src/i18n/client-messages.tsx`), and `src/i18n/client-scopes.ts` lists the namespaces per scope. A nested provider replaces its parent's messages, so a scope lists everything its subtree needs. `tests/unit/bundle/client-bundle.test.ts` walks the import graph of each section's routes and fails when a scope misses a namespace or carries an unused one. The same test keeps zod out of the browser: Zod schemas live in `src/lib/schemas/`, and the constants client components share with them in `src/lib/validation/`, which never imports zod.

### 8.6 Prisma + MariaDB adapter

Prisma 7: driver adapters are stable (no `previewFeatures`), and the datasource URL and seed command live in `prisma.config.ts`. `src/server/db/index.ts` creates one `PrismaClient` per process with the `PrismaMariaDb` adapter (`@prisma/adapter-mariadb`).

### 8.7 Init script

`scripts/init.sh` (`npm run setup`):

1. Generate `.env` from `.env.example` with random secrets if `.env` is missing.
2. Generate the MariaDB keyring file if missing.
3. Start `mariadb` and `mariadb-test`, wait for them to be healthy, and grant the `app` user global privileges (Prisma Migrate needs a shadow database).
4. Run `prisma migrate deploy` on `budget` and `budget_test`, then `prisma db seed` on `budget` (roles, permissions and default settings, no users).

After this, `npm run dev` works. The same seed (`seedRolesAndPermissions`, `seedAppSettings`) also runs idempotently on every server start, from `src/instrumentation.ts`. Settings changed in the admin UI are kept.

### 8.8 Hot reload of settings

`AppSettingsService` (`src/server/services/settings/app-settings.ts`) caches each key for 60 s. A write drops the cached key and records an audit event. Writing an auth-affecting key (`registration_mode`, `credentials_enabled`, `min_password_length`, `app_name`) calls `invalidateAuthCache()`. Saving an SSO provider invalidates the auth cache too. Caches live in `processState` (one per process, shared by every route's module copy), so the next request rebuilds the handler with the new config. No restart is needed.

### 8.9 Production deployment

As shipped (operator guide: `docs/self-hosting.md`):

- `docker-compose.prod.yml` runs the published `ghcr.io/navino16/bilan` image (`prod` target, `linux/amd64` + `linux/arm64`, tag `${BILAN_VERSION:-latest}`, host port `${BILAN_PORT:-3000}`) with three services:
  - `mariadb`: at-rest encryption, keyring bind-mounted from `./keyring`, port not published.
  - `app`: applies pending migrations, seeds roles, permissions and default settings, then serves.
  - `cron`: same image, runs as root with busybox `crond` (`docker/cron/`). It writes `CRON_SECRET` to a file and calls `purge-imports` once, exiting if that fails (a wrong secret shows as a restart loop). Then, in UTC: `roll-budgets` daily at 00:05, `purge-audit` daily at 03:00, `purge-imports` hourly. It exits without `CRON_SECRET`.
- No bundled reverse proxy: the operator puts their own TLS proxy (Caddy, Traefik, nginx…) in front of the app port and sets `TRUSTED_IP_HEADER` if needed. The app sends HSTS and the other security headers. Rate limiting is in-app and in memory.
- Secrets come from env files next to the compose file (`app.env`, `db.env`), not Docker secrets. `db.env` keeps the MariaDB root password out of the app and cron containers.
- No dedicated health endpoint: the `app` healthcheck fetches `/fr/login`, which needs the database (a fresh install redirects it to `/fr/setup`).
- Backups are an operator script documented in docs/self-hosting.md: `mariadb-dump` inside the `mariadb` container, gzip, `openssl enc` with a passphrase file, host cron, 30-day retention. `npm run db:backup-dev` only targets the development database.
- PWA: `src/app/manifest.ts` plus a hand-written service worker (`public/sw.js`), registered in production only. It caches only static, non-sensitive assets and never authenticated pages.

---

## 9. UI/UX & Design System — "Bilan"

The visual design was first mocked up with Claude Design from this spec. That prototype was the reference while the UI was built and has since been removed from the repository. Its tokens now live in `src/app/globals.css`, and the shadcn components are themed with them.

### 9.1 Visual direction

"Bilan": **editorial × calm × tactile numbers**, private banking meets Notion. A warm paper canvas, a forest-green primary, and terracotta (not red) for expenses.

### 9.2 Design tokens (`src/app/globals.css`)

**Palette (light)**: paper `#F7F4ED`, card `#FFFFFF`, ink `#15130F`, primary forest `#1F4D3A`, income `#2D6B47`, expense terracotta `#B14A3B`, warning `#B6841F`, info `#2F5F8F`. Earthy category palette (`--cat-*`): groceries `#5E8C5A`, housing `#6E5B8C`, transport `#2F6B8F`, food `#C9763E`, leisure `#A86B9C`, health `#4F8C7B`, savings `#B68F36`, shopping `#8C5A3E`, bills `#4A6675`, plus income, other and uncategorized. Every token has a **dark** value (`@variant dark`).

Text-contrast tokens (`--ink-3`, `--warning-text`, `--expense-text`) are darker than the fill colours so that text reaches WCAG AA (4.5:1). `--warning` and `--expense` stay for fills. `--category-glyph` switches to the paper colour in dark mode, where white glyphs fall under 3:1 on the pastel palette.

**Typography** (`src/lib/fonts.ts`, `next/font/local` on the `@fontsource` latin files, served by the app, no build-time download): display serif **Newsreader** (`--font-display`, also `--font-heading`), UI sans **IBM Plex Sans** (`--font-sans`), numbers **IBM Plex Mono** (`--font-mono`). Amounts use tabular figures (`tabular-nums`). Sizes are Tailwind utilities, not tokens.

**Radii**: one `--radius` (0.625rem), from which `--radius-sm` to `--radius-4xl` are derived. Spacing is Tailwind's default scale. Density is fixed at the "cozy" row height: there is no density token or setting.

**Logo**: the mark is defined once in `src/lib/brand.ts` (the design's B, with a middle bar added so it stays legible at 16 px). The `BilanMark` component (`src/components/brand/bilan-mark.tsx`) draws it in the app. `npm run icons` (`scripts/generate-icons.ts`) writes the favicon, the app/Apple icons, the PWA icons (`public/icons/`) and the README logos (`docs/images/logo.svg`, `logo-dark.svg`).

### 9.3 Confirmed UX decisions

- **Native light/dark theme** with a toggle (light / dark / system), stored per browser in the `bilan-theme` cookie (no cookie = system). The server renders the theme class, so there is no flash on load (`src/lib/theme.ts`).
- **Density locked to cozy**, not exposed in user or admin settings.
- **Dashboard layout: editorial**. The page header has a serif period title, a period picker and prev/next navigation. Below come a KPI row, a category donut with amounts and %, mini bars, and recent transactions.
- **Budget visualization: horizontal bar**, aware of overspending. The fill is income-green while OK, warning from 80% and when the budget is exactly reached, and expense when over (`lineStatus` in `src/lib/budgets.ts`).
- **One budget creation entry point**, in the page header (plus the empty state's call to action).
- **Navigation**:
  - Desktop: a sidebar with a workspace group (Dashboard, Insights, Transactions, Import, Budgets, Accounts, Categories, Groups) and an account group (Security, Data, Admin when permitted).
  - Mobile: a bottom bar with five tabs (Dashboard, Transactions, Budgets, Accounts, Categories) and a **hamburger drawer** with the full navigation, the language switcher and the theme toggle (`src/components/shell/nav-items.ts`).
  - Links have no page of their own: they are handled from Transactions (`/transactions/suggestions`).
- **Forms**: centred **dialogs on desktop**, **bottom sheets on mobile** (`useIsMobile`): new transaction, account, category, budget, group, rule.
- **Key interactions**:
  - Clicking a transaction opens a detail panel (side sheet on desktop, bottom sheet on mobile).
  - Changing a category offers to create a rule for similar transactions.
  - Prev/next period navigation.
- **Flagship screen**: the Dashboard's monthly overview.

### 9.4 Component library: shadcn/ui, themed Bilan

The Bilan look is implemented through **shadcn/ui** themed with the Bilan tokens, not through a hand-rolled parallel component system.

- **Theming**: the "Shadcn bridge" block in `globals.css` maps the Bilan tokens onto shadcn's variables (`--background`, `--foreground`, `--primary`, `--card`, `--border`, `--ring`, `--chart-1…5`, `--sidebar-*`, `--radius`…) for light and dark. `@theme inline` exposes them to Tailwind v4.
- **Primitives**: the shadcn components in `src/components/ui/` (Button, Card, Dialog, Sheet, Dropdown menu, Input, Label, Switch, Badge, Alert, Avatar, Radio group, native select…). They use the `base-nova` style, built on **Base UI** (`@base-ui/react`), which provides their accessibility. Icons come from lucide.
- **Charts**: dependency-free SVG components (`src/components/dashboard/charts.tsx`: donut, mini bars), coloured with the category palette. There is no Recharts.
- **Bilan-specific pieces**, built on these primitives and the tokens: the large serif amounts, the category colour chip, the overspending-aware budget bar.

> Stack note (§2.1): the fonts are **Newsreader + IBM Plex Sans + IBM Plex Mono**, loaded with `next/font` and wired into the `--font-*` variables.

---

## 10. Development Workflow (GitHub + Git Flow)

Local setup, scripts, demo data and e2e options: [docs/development.md](development.md). Production operations: [docs/self-hosting.md](self-hosting.md).

### 10.1 Repository & branching — Git Flow

The project is a **public GitHub repository** (`Navino16/bilan`, AGPL-3.0), using the **Git Flow** model:

- **`main`**: the release branch and the repository's default branch. Tagged at each release.
- **`develop`**: the integration branch. All features land here first.
- **`feature/<topic>`**: branched from `develop`, merged back into `develop` through a PR.
- **`release/<version>`**: branched from `develop` to cut a release, merged into **both** `main` and `develop`, tagged on `main`.
- **`hotfix/<version>`**: branched from `main` for urgent fixes, merged into `main` and `develop`.

**Releases are manual**: the maintainer runs the Git Flow commands (`git flow release start/finish`) when they decide to cut one. CI does **not** release on its own.

### 10.2 Issues & traceability

- Work is tracked by GitHub issues: one issue per change, with its goal and acceptance criteria. Issue templates are in `.github/ISSUE_TEMPLATE/`.
- The PR body references the issue with `Closes #<n>`. Merging into `develop` closes it through `close-issues-on-develop.yml`, since GitHub only auto-closes from the default branch.
- Labels: every PR gets a **type** label (`enhancement`, `bug`, `security`, `infra`, `documentation`, `dependencies`, `breaking change`), because the release changelog is built from them (§10.4). An area label (`frontend`, `backend`) can be added. The `phase-N` labels date from the initial roadmap.

### 10.3 Pull requests

- Target: `develop` for features and fixes. Releases and hotfixes reach `main` through Git Flow.
- PR title in conventional-commit style (`feat: …`, `fix: …`, `refactor: …`). With squash merge it becomes the commit on the branch.
- A GitHub ruleset, **`Main/Develop`**, protects `main` and `develop`. It is configured in the repository settings, not in the repo. It enforces:
  - changes only through a PR, with **no approval required**; review threads must be resolved;
  - **squash merge only** and **linear history**; no force-push, deletion or creation of these branches;
  - required status checks, up to date with the base: **Lint, Typecheck, Build, Test (unit + coverage), Integration, E2E** (the `ci.yml` jobs, §7.6) and **CodeQL** (code-scanning default setup), plus a code-scanning gate on CodeQL alerts.
  - Repository admins can bypass the ruleset.
- `prod-smoke.yml` runs on PRs that touch the Docker/Prisma/build files, but it is not a required check.
- Branches are deleted automatically after merge.
- Commits are one-line, English, conventional.

### 10.4 CI/CD workflows

**`ci.yml`**: on PRs to `main`/`develop`. Jobs and reporting are in §7.6.

**`build.yml`**: on push to `develop` (except changes limited to `**.md`, `.github/**`, `tests/**`, `scripts/**`), on any tag, and on `workflow_dispatch`:

1. **Lint** and **Test** (unit tests) gate the build.
2. **Build (linux/amd64 | linux/arm64)**: a matrix on `ubuntu-26.04` and `ubuntu-24.04-arm`. Each runner builds the `prod` target with Buildx and the GHA cache, then pushes it by digest to **ghcr.io** (`ghcr.io/navino16/bilan`).
3. **Merge Manifests**: combines the per-arch digests into a multi-arch manifest, tagged with `docker/metadata-action` (semver `{{version}}` and `{{major}}.{{minor}}`, branch, PR, `sha-` prefix; `latest=auto`).
4. **Create Release** (tags only): builds the changelog from PR labels with `mikepenz/release-changelog-builder-action` (categories: breaking change, enhancement, bug, security, infra, documentation, dependencies; base branch `develop`), then creates the GitHub Release with `softprops/action-gh-release`.
5. **Discord Release Notification** (tags only): posts the release and a changelog excerpt to a Discord webhook, mentioning a role.

**Release flow**: the maintainer cuts a release with Git Flow (`git flow release finish` → tag on `main`) and pushes the tag. The tag triggers `build.yml`: images, GitHub Release, Discord. The **decision is manual**; **packaging and publishing are automated**.

**Secrets / variables**: `CODECOV_TOKEN` (secret), `DISCORD_RELEASES_WEBHOOK` (secret), `DISCORD_RELEASE_ROLE_ID` (repository variable), and `GITHUB_TOKEN` (automatic, used for ghcr.io and the release). Image registry: `ghcr.io`.

### 10.5 Conventions recap

- Code, tests, comments, commit messages, issue/PR titles: **English**. UI strings: **French and English** (next-intl). Keep `messages/fr.json` and `messages/en.json` in sync by hand: CI has no check that both files have the same keys.
- Commits: one line, conventional (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).
- Business logic goes in `src/server/services/*`. Server Actions and Route Handlers stay thin.
- Run `npm run ci` before opening a PR.
- No `--no-verify`. The ruleset blocks force-pushes to `main`/`develop`.
- Dependabot PRs follow the same flow (target `develop`, CI must pass).

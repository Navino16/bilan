# Phase 0 — Project Bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a running Next.js 16 app in Docker, connected to MariaDB 11 via Prisma 7, with the Bilan theme, i18n, RBAC seed, and CI green — the foundation every later phase builds on.

**Architecture:** Next.js App Router (full-stack, src/), business logic in `server/services/*`, Prisma 7 with the MariaDB driver adapter, Better Auth models seeded for RBAC, shadcn themed from the Bilan `design/project/tokens.css`, CI mirroring the `librarr` project.

**Tech Stack:** Next.js 16.2 · React 19.2 · TypeScript 6 · Tailwind v4 · shadcn/ui · next-intl · Prisma 7 + `@prisma/adapter-mariadb` · MariaDB 11 · Better Auth · Node 24 · npm · Vitest · Playwright · Docker Compose · GitHub Actions.

> **Spec references:** architecture §3, data model §4.1, security §6.1/§6.2/§6.9, config & deploy §8, CI §7.6/§12.4, design system §11. Large config blocks (docker-compose, Dockerfile, CI YAML) are specified verbatim in spec §8 and §12 — this plan points to them rather than duplicating, and shows the exact content for logic-bearing files (env validation, crypto, seed).

> **Note on TDD for infra:** scaffolding steps (Next init, docker-compose) are verified by **commands that must succeed**, not unit tests. Logic-bearing code (env validation, crypto, seed, services) follows strict test-first TDD.

---

## File Structure (created in this phase)

```
.nvmrc                          # "24"
.editorconfig
.gitignore                      # node, .env, .superpowers/, .reports/, .next, etc.
.env.example                    # spec §8.1
package.json                    # scripts: dev, build, lint, typecheck, test*, db:*, setup, ci
tsconfig.json                   # strict
next.config.ts
eslint.config.mjs
prettier.config.mjs
vitest.config.ts
playwright.config.ts            # chromium + iPhone 14 projects
docker-compose.yml              # spec §8.2 (app, mariadb, mariadb-test, adminer)
Dockerfile                      # spec §8.3 (multi-stage)
docker/mariadb/conf.d/encryption.cnf
scripts/init.sh                 # spec §8.7
messages/fr.json
messages/en.json
prisma/schema.prisma            # §4.1 models (Better Auth + RBAC)
prisma/seed.ts                  # roles + permissions
src/env.ts                      # envalid validation
src/middleware.ts               # next-intl + security headers
src/i18n/config.ts
src/i18n/request.ts
src/server/db/index.ts          # Prisma client + MariaDB adapter
src/server/crypto/encryption.ts # AES-256-GCM
src/server/crypto/hmac.ts       # HMAC-SHA256 + normalize + tokenize
src/server/crypto/keys.ts       # key loading from env
src/app/globals.css             # Bilan tokens → Tailwind/shadcn variables
src/app/layout.tsx
src/app/[locale]/layout.tsx
src/app/[locale]/page.tsx       # demo page (theme + components)
src/lib/fonts.ts                # next/font: Newsreader, IBM Plex Sans/Mono
components.json                 # shadcn config
.github/workflows/ci.yml        # spec §7.6
.github/workflows/build.yml     # spec §12.4
.github/dependabot.yml
tests/unit/crypto/encryption.test.ts
tests/unit/crypto/hmac.test.ts
tests/integration/seed.test.ts
tests/e2e/smoke.spec.ts
```

---

## Task 0.1 — Init Next.js project + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `prettier.config.mjs`, `vitest.config.ts`, `.nvmrc`, `.editorconfig`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`

- [x] **Step 1: Scaffold Next.js**

Run (from the project root):
```bash
npx create-next-app@latest . --ts --app --src-dir --tailwind --eslint --use-npm --no-import-alias --turbopack
```
Expected: project files generated in the current directory (accept overwrite warnings only for non-spec files; keep `design/`, `docs/`, `PLAN.md`).

- [x] **Step 2: Pin Node + add tooling configs**

Create `.nvmrc`:
```
24
```
Create `.editorconfig`:
```ini
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```
Append to `.gitignore`:
```
.env
.env.local
.superpowers/
.reports/
/coverage
playwright-report/
test-results/
```

- [x] **Step 3: Add Prettier + scripts**

Run:
```bash
npm i -D prettier prettier-plugin-tailwindcss eslint-config-prettier
```
Create `prettier.config.mjs`:
```js
export default { semi: true, singleQuote: false, trailingComma: "all", printWidth: 100, plugins: ["prettier-plugin-tailwindcss"] };
```
Edit `package.json` `scripts` to include:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint && prettier --check .",
  "format": "next lint --fix && prettier --write .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "playwright test",
  "setup": "bash scripts/init.sh",
  "ci": "npm run lint && npm run typecheck && npm run test"
}
```

- [x] **Step 4: Install + configure Vitest**

Run:
```bash
npm i -D vitest @vitest/coverage-v8 vite-tsconfig-paths
```
Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    reporters: ["default", ["junit", { outputFile: ".reports/junit.xml" }]],
    coverage: { provider: "v8", reporter: ["text", "cobertura"], reportsDirectory: ".reports/coverage" },
  },
});
```
Ensure `tsconfig.json` has `"strict": true` and path alias `"@/*": ["./src/*"]`.

- [x] **Step 5: Verify the toolchain**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all succeed (Next builds the default page).

Run: `npm test`
Expected: "No test files found" (exit 0) — acceptable at this point.

- [x] **Step 6: Write the README (with an English note on the name)**

Overwrite `README.md` with a project intro that explains the name for non-French speakers:
```markdown
# Bilan

> **About the name** — *Bilan* is French for "balance sheet" / "financial overview".
> It's a self-hosted, multi-user personal-finance app (multi-account, shared household
> groups, budgets, CSV/PDF import). UI available in French and English.

## Quickstart

```bash
npm run setup   # generates .env, boots MariaDB, migrates + seeds
npm run dev     # http://localhost:3000
```

## Docs

- Design spec: `docs/superpowers/specs/2026-05-26-budget-app-design.md`
- Roadmap: `PLAN.md`
- Visual design reference: `design/`
```

- [x] **Step 7: Init git with Git Flow branches**

Run:
```bash
git init
git add -A
git commit -m "chore: bootstrap next.js project with tooling"
git branch -M main
git checkout -b develop
```
Expected: `develop` is the current branch.

---

## Task 0.2 — Docker Compose stack + env validation

**Files:**
- Create: `docker-compose.yml` (spec §8.2), `Dockerfile` (spec §8.3), `docker/mariadb/conf.d/encryption.cnf`, `scripts/init.sh` (spec §8.7), `.env.example` (spec §8.1)
- Create + Test: `src/env.ts`, `tests/unit/env.test.ts`

- [x] **Step 1: Write the failing test for env validation**

Create `tests/unit/env.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "@/env";

const valid = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "mysql://app:app_password@localhost:3306/budget",
  AUTH_SECRET: "x".repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  SEARCH_TOKEN_KEY: Buffer.alloc(32, 2).toString("base64"),
};

describe("parseEnv", () => {
  it("accepts a valid environment", () => {
    expect(() => parseEnv(valid)).not.toThrow();
  });
  it("rejects a missing DATABASE_URL", () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => parseEnv(rest as never)).toThrow();
  });
  it("rejects a DATA_ENCRYPTION_KEY that is not 32 bytes", () => {
    expect(() => parseEnv({ ...valid, DATA_ENCRYPTION_KEY: "dG9vc2hvcnQ=" })).toThrow();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- env`
Expected: FAIL — cannot import `parseEnv` from `@/env`.

- [x] **Step 3: Implement env validation**

Run: `npm i envalid`
Create `src/env.ts`:
```ts
import { cleanEnv, str, url, makeValidator } from "envalid";

const base64Key32 = makeValidator((v) => {
  const buf = Buffer.from(v, "base64");
  if (buf.length !== 32) throw new Error("must decode to 32 bytes (base64)");
  return v;
});

export function parseEnv(source: NodeJS.ProcessEnv) {
  return cleanEnv(source, {
    NODE_ENV: str({ choices: ["development", "test", "production"] }),
    APP_URL: url(),
    DATABASE_URL: url({ default: undefined as never }),
    AUTH_SECRET: str({ devDefault: "x".repeat(32) }),
    DATA_ENCRYPTION_KEY: base64Key32(),
    SEARCH_TOKEN_KEY: base64Key32(),
  });
}

export const env = parseEnv(process.env);
```
> Note: `DATABASE_URL` uses `url()`; `mysql://…` is accepted. If envalid's `url()` rejects the mysql scheme in your version, switch that line to `str()`.

- [x] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- env`
Expected: PASS (3 tests).

- [x] **Step 5: Create Docker + env files**

Create `.env.example`, `docker-compose.yml`, `Dockerfile`, `docker/mariadb/conf.d/encryption.cnf`, and `scripts/init.sh` with the exact contents from **spec §8.1, §8.2, §8.3, §8.7**. Make `scripts/init.sh` executable: `chmod +x scripts/init.sh`.

- [x] **Step 6: Boot the stack**

Run: `npm run setup`
Expected: `.env` generated with random secrets, MariaDB keyring created, `mariadb` + `mariadb-test` containers healthy.

Run: `docker compose up -d app && sleep 5 && curl -fsS http://localhost:3000 >/dev/null && echo OK`
Expected: `OK`.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: docker compose stack and env validation"
```

---

## Task 0.3 — Prisma 7 + MariaDB adapter + RBAC seed

**Files:**
- Create: `prisma/schema.prisma`, `src/server/db/index.ts`, `prisma/seed.ts`
- Test: `tests/integration/seed.test.ts`

- [x] **Step 1: Install Prisma + adapter**

Run:
```bash
npm i @prisma/client @prisma/adapter-mariadb
npm i -D prisma tsx
```

- [x] **Step 2: Write schema (Better Auth base + RBAC)**

Create `prisma/schema.prisma` with the generator/datasource header from **spec §8.6** and the **Group A models from spec §4.1** (`User`, `Session`, `AuthAccount`, `Verification`, `TwoFactor`, `Passkey`, `Role`, `Permission`, `RolePermission`, `UserRole`). Keep only Group A in this phase; later phases add their models.

- [x] **Step 3: Create the Prisma client**

Create `src/server/db/index.ts` with the exact content from **spec §8.6**:
```ts
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { env } from "@/env";

const adapter = new PrismaMariaDb({ connectionString: env.DATABASE_URL });
export const db = (globalThis as { __db?: PrismaClient }).__db ?? new PrismaClient({ adapter });
if (env.NODE_ENV !== "production") (globalThis as { __db?: PrismaClient }).__db = db;
```

- [x] **Step 4: First migration**

Run:
```bash
npx prisma migrate dev --name init
```
Expected: migration created and applied to `budget`; Prisma Client generated.

- [x] **Step 5: Write the failing seed test**

Create `tests/integration/seed.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/server/db";
import { seedRolesAndPermissions } from "@/../prisma/seed";

beforeAll(async () => {
  await db.userRole.deleteMany();
  await db.rolePermission.deleteMany();
  await db.permission.deleteMany();
  await db.role.deleteMany();
});

describe("seedRolesAndPermissions", () => {
  it("creates SUPER_ADMIN, ADMIN, USER roles", async () => {
    await seedRolesAndPermissions(db);
    const roles = await db.role.findMany();
    expect(roles.map((r) => r.key).sort()).toEqual(["ADMIN", "SUPER_ADMIN", "USER"]);
  });
  it("is idempotent", async () => {
    await seedRolesAndPermissions(db);
    expect(await db.role.count()).toBe(3);
  });
});
```

- [x] **Step 6: Run to verify it fails**

Run: `DATABASE_URL=mysql://app:app_password@localhost:3307/budget_test npm run test:integration -- seed`
Expected: FAIL — `seedRolesAndPermissions` not exported.

- [x] **Step 7: Implement the seed**

Create `prisma/seed.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const PERMISSIONS = [
  { key: "admin.settings.write", scope: "admin", description: "Edit app settings" },
  { key: "admin.users.read", scope: "admin", description: "View users" },
  { key: "admin.users.create", scope: "admin", description: "Create users" },
  { key: "admin.signup_tokens.manage", scope: "admin", description: "Manage signup tokens" },
  { key: "admin.audit.read", scope: "admin", description: "View audit log" },
];

const ROLES: Record<string, string[]> = {
  SUPER_ADMIN: PERMISSIONS.map((p) => p.key),
  ADMIN: ["admin.settings.write", "admin.users.read", "admin.users.create", "admin.audit.read"],
  USER: [],
};

export async function seedRolesAndPermissions(db: PrismaClient) {
  for (const p of PERMISSIONS) {
    await db.permission.upsert({ where: { key: p.key }, create: p, update: { description: p.description, scope: p.scope } });
  }
  for (const [key, perms] of Object.entries(ROLES)) {
    const role = await db.role.upsert({
      where: { key },
      create: { key, name: key.replace("_", " "), isSystem: true },
      update: {},
    });
    for (const permKey of perms) {
      const perm = await db.permission.findUniqueOrThrow({ where: { key: permKey } });
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }
  }
}

if (process.argv[1]?.includes("seed")) {
  const db = new PrismaClient();
  seedRolesAndPermissions(db).then(() => db.$disconnect());
}
```
Add to `package.json`: `"prisma": { "seed": "tsx prisma/seed.ts" }` and scripts `"db:migrate": "prisma migrate dev"`, `"db:reset": "prisma migrate reset --force"`, `"db:studio": "prisma studio"`, `"db:up": "docker compose up -d mariadb mariadb-test"`.

- [x] **Step 8: Run to verify it passes**

Run:
```bash
DATABASE_URL=mysql://app:app_password@localhost:3307/budget_test npx prisma migrate deploy
DATABASE_URL=mysql://app:app_password@localhost:3307/budget_test npm run test:integration -- seed
```
Expected: PASS (2 tests).

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: prisma schema with rbac models and seed"
```

---

## Task 0.4 — Crypto primitives (AES-256-GCM + HMAC)

**Files:**
- Create: `src/server/crypto/keys.ts`, `src/server/crypto/encryption.ts`, `src/server/crypto/hmac.ts`
- Test: `tests/unit/crypto/encryption.test.ts`, `tests/unit/crypto/hmac.test.ts`

- [x] **Step 1: Write the failing encryption test**

Create `tests/unit/crypto/encryption.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/server/crypto/encryption";

const key = Buffer.alloc(32, 7);

describe("encryption", () => {
  it("round-trips a string", () => {
    const enc = encrypt("CB AMAZON EU 42,99", key);
    expect(enc).toMatch(/^v1\./);
    expect(decrypt(enc, key)).toBe("CB AMAZON EU 42,99");
  });
  it("produces a different ciphertext each time (random IV)", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });
  it("fails to decrypt with the wrong key", () => {
    const enc = encrypt("secret", key);
    expect(() => decrypt(enc, Buffer.alloc(32, 9))).toThrow();
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- crypto/encryption`
Expected: FAIL — module not found.

- [x] **Step 3: Implement encryption**

Create `src/server/crypto/encryption.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const b64 = (b: Buffer) => b.toString("base64url");
const fromB64 = (s: string) => Buffer.from(s, "base64url");

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", b64(iv), b64(enc), b64(tag)].join(".");
}

export function decrypt(stored: string, key: Buffer): string {
  const [version, iv, enc, tag] = stored.split(".");
  if (version !== "v1") throw new Error("Unsupported encryption version");
  const decipher = createDecipheriv(ALGO, key, fromB64(iv));
  decipher.setAuthTag(fromB64(tag));
  return Buffer.concat([decipher.update(fromB64(enc)), decipher.final()]).toString("utf8");
}
```

- [x] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- crypto/encryption`
Expected: PASS (3 tests).

- [x] **Step 5: Write the failing HMAC test**

Create `tests/unit/crypto/hmac.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hmacForSearch, tokenize, hmacTokens } from "@/server/crypto/hmac";

const key = Buffer.alloc(32, 3);

describe("hmac search", () => {
  it("is deterministic and normalizes accents/case/space", () => {
    expect(hmacForSearch("  Épicerie  CENTRE ", key)).toBe(hmacForSearch("epicerie centre", key));
  });
  it("tokenizes into words >= 3 chars, deduped", () => {
    expect(tokenize("CB AMAZON EU 42")).toEqual(["amazon"]);
  });
  it("hashes each token", () => {
    expect(hmacTokens("AMAZON resto", key)).toHaveLength(2);
  });
});
```

- [x] **Step 6: Run to verify it fails**

Run: `npm run test:unit -- crypto/hmac`
Expected: FAIL — module not found.

- [x] **Step 7: Implement HMAC**

Create `src/server/crypto/hmac.ts`:
```ts
import { createHmac } from "node:crypto";

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function hmacForSearch(input: string, key: Buffer): string {
  return createHmac("sha256", key).update(normalize(input)).digest("hex");
}

export function tokenize(input: string): string[] {
  return Array.from(new Set(normalize(input).split(/[^a-z0-9]+/).filter((w) => w.length >= 3)));
}

export function hmacTokens(input: string, key: Buffer): string[] {
  return tokenize(input).map((t) => hmacForSearch(t, key));
}
```

- [x] **Step 8: Run to verify it passes**

Run: `npm run test:unit -- crypto/hmac`
Expected: PASS (3 tests).

- [x] **Step 9: Add key loader**

Create `src/server/crypto/keys.ts`:
```ts
import { env } from "@/env";

export const dataKey = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");
export const searchKey = Buffer.from(env.SEARCH_TOKEN_KEY, "base64");
```

- [x] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: aes-256-gcm encryption and hmac search primitives"
```

---

## Task 0.5 — Bilan theme, fonts, shadcn, i18n

**Files:**
- Create: `src/lib/fonts.ts`, `src/app/globals.css`, `components.json`, `src/i18n/config.ts`, `src/i18n/request.ts`, `src/middleware.ts`, `messages/fr.json`, `messages/en.json`, `src/app/layout.tsx`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`

- [x] **Step 1: Install deps**

Run:
```bash
npm i next-intl
npx shadcn@latest init
npx shadcn@latest add button card badge switch
```
Accept defaults; this creates `components.json` and `src/components/ui/*`.

- [x] **Step 2: Wire fonts**

Create `src/lib/fonts.ts`:
```ts
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

export const serif = Newsreader({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "600"] });
export const sans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-sans", weight: ["300", "400", "500", "600", "700"] });
export const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500", "600"] });
```

- [x] **Step 3: Map Bilan tokens into `globals.css`**

In `src/app/globals.css`, define the shadcn CSS variables (`--background`, `--foreground`, `--primary`, `--card`, `--border`, `--radius`, etc.) from the **light and dark values in `design/project/tokens.css`** (paper `#F7F4ED`, ink `#15130F`, primary `#1F4D3A`, etc.), plus the category palette and `--font-*` variables. Keep `tokens.css` open side-by-side and copy the values; both `:root` (light) and `[data-theme="dark"]`/`.dark` blocks.

- [x] **Step 4: i18n config + middleware**

Create `src/i18n/config.ts`:
```ts
export const locales = ["fr", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fr";
```
Create `src/i18n/request.ts` (next-intl `getRequestConfig` loading `messages/<locale>.json`).
Create `messages/fr.json` and `messages/en.json` with at least `{ "app": { "name": "Bilan", "tagline": "..." } }`.
Create `src/middleware.ts`: compose next-intl middleware (localePrefix "always") and append the security headers from **spec §6.6** (HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, CSP). `matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"]`.

- [x] **Step 5: Layouts + demo page**

Update `src/app/layout.tsx` to apply the font variables on `<html>`. Create `src/app/[locale]/layout.tsx` (NextIntlClientProvider + theme attribute) and `src/app/[locale]/page.tsx` rendering a heading in `--font-display`, a couple of shadcn `Button`/`Card`/`Badge` in Bilan colors, and a theme toggle `Switch` that flips `data-theme`.

- [x] **Step 6: Verify visually + headers**

Run: `npm run dev`
Then: `curl -sI http://localhost:3000/fr | grep -i "x-frame-options"`
Expected: `X-Frame-Options: DENY`.
Open `http://localhost:3000/fr` and `…/en` — page renders in Bilan styling, theme toggle works, language differs.

- [x] **Step 7: Verify build + lint**

Run: `npm run build && npm run lint && npm run typecheck`
Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: bilan theme, fonts, shadcn base, i18n fr/en"
```

---

## Task 0.6 — CI workflows + Playwright smoke + Dependabot

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `.github/workflows/ci.yml` (spec §7.6), `.github/workflows/build.yml` (spec §12.4), `.github/dependabot.yml`

- [x] **Step 1: Install Playwright**

Run:
```bash
npm i -D @playwright/test
npx playwright install chromium --with-deps
```

- [x] **Step 2: Configure Playwright**

Create `playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["junit", { outputFile: ".reports/junit-e2e.xml" }]],
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 14"] } },
  ],
  webServer: { command: "npm run dev", port: 3000, reuseExistingServer: !process.env.CI },
});
```

- [x] **Step 3: Write the smoke test**

Create `tests/e2e/smoke.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("home page renders the app name", async ({ page }) => {
  await page.goto("/fr");
  await expect(page.getByText("Bilan")).toBeVisible();
});
```

- [x] **Step 4: Run the smoke test**

Run: `npm run test:e2e -- --project=chromium`
Expected: PASS (dev server auto-started).

- [x] **Step 5: Add CI workflows**

Create `.github/workflows/ci.yml` and `.github/workflows/build.yml` with the exact contents specified in **spec §7.6 and §12.4** (adapted: image name `ghcr.io/<owner>/bilan`; the integration job adds a `mariadb:11` service and runs `prisma migrate deploy` + `npm run test:integration` with `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY` from secrets/test values).
Create `.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule: { interval: "weekly" }
    groups:
      minor-patch: { update-types: ["minor", "patch"] }
    target-branch: "develop"
    assignees: ["Navino16"]
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule: { interval: "weekly" }
    target-branch: "develop"
```

- [x] **Step 5b: Add GitHub issue + PR templates (from `librarr`)**

Copy from the `librarr` project and adapt:
- `.github/ISSUE_TEMPLATE/config.yml` — `blank_issues_enabled: false`
- `.github/ISSUE_TEMPLATE/1.bug_report.yml` — bug report form; rename the "Librarr Version" input label to **"Bilan Version"**
- `.github/ISSUE_TEMPLATE/2.feature_request.yml` — feature request form
- `.github/PULL_REQUEST_TEMPLATE.md` — description / type of change / checklist (`npm run lint`, `npm test`) / related issues

These apply to issues/PRs created via the GitHub UI (our scope-issues were created via `gh` and are unaffected).

- [x] **Step 6: Commit + open the PR**

> The repo, `main`/`develop` branches, milestones and issues already exist (created during project bootstrap). This scope uses its own branch `feature/0.6-ci` per the one-scope-one-PR workflow.

```bash
git checkout develop && git pull
git checkout -b feature/0.6-ci
git add -A
git commit -m "ci: add ci/build workflows, github templates, playwright smoke"
git push -u origin feature/0.6-ci
gh pr create --base develop --title "ci: workflows, github templates, playwright smoke" --label "phase-0,infra" --body "Closes #6 ..."
```
Expected: CI runs green on the PR (lint, build, test, integration, e2e).

---

## Self-Review notes (for the executor)

- After Task 0.3, the only models present are Group A (identity/RBAC). Later phases add their model groups via new migrations — do not pre-create them here.
- The big config files (docker-compose, Dockerfile, CI YAML) are intentionally referenced from the spec to avoid drift; copy them verbatim and adjust only the placeholders called out (image name, owner).
- If `create-next-app` overwrites `README.md` or `tsconfig.json` in a way that conflicts with later steps, re-apply the steps above; never delete `design/`, `docs/`, or `PLAN.md`.
- Acceptance for the whole phase: `npm run ci` passes locally, the stack boots via `npm run setup`, `/fr` and `/en` render the themed demo page, and CI is green on the PR.

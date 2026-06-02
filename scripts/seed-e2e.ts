import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { seedRolesAndPermissions, seedAppSettings } from "../prisma/seed";
import { getAuth } from "@/server/auth";
import { grantRole } from "@/server/services/users/roles";

// Puts the e2e database into a post-setup state: roles/permissions + app
// settings seeded, plus credentialed users the Playwright auth.setup project can
// sign in as (and one fallback user so the setup guard lets smoke tests reach the
// app instead of redirecting to /setup). The setup-wizard e2e (which needs a
// fresh, user-less DB) stays skipped.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed e2e");

const db = new PrismaClient({ adapter: new PrismaMariaDb(url) });

const E2E_USERS = [
  { email: "owner@e2e.local", name: "E2E Owner", password: "e2e-owner-pw-123456" },
  { email: "member@e2e.local", name: "E2E Member", password: "e2e-member-pw-123456" },
  { email: "admin@e2e.local", name: "E2E Admin", password: "e2e-admin-pw-123456", admin: true },
];

async function ensureUsers(): Promise<void> {
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

// A deterministic household (owner = OWNER, member = MEMBER) so account-sharing
// e2e can share into a known group without depending on the 2.3 invitation UI.
const SHARED_GROUP_ID = "e2e-shared-group";

async function ensureSharedGroup(): Promise<void> {
  const owner = await db.user.findUnique({ where: { email: "owner@e2e.local" } });
  const member = await db.user.findUnique({ where: { email: "member@e2e.local" } });
  if (!owner || !member) return;
  await db.group.upsert({
    where: { id: SHARED_GROUP_ID },
    update: {},
    create: { id: SHARED_GROUP_ID, name: "E2E Shared", createdById: owner.id },
  });
  await db.groupMember.upsert({
    where: { groupId_userId: { groupId: SHARED_GROUP_ID, userId: owner.id } },
    update: {},
    create: { groupId: SHARED_GROUP_ID, userId: owner.id, role: "OWNER" },
  });
  await db.groupMember.upsert({
    where: { groupId_userId: { groupId: SHARED_GROUP_ID, userId: member.id } },
    update: {},
    create: { groupId: SHARED_GROUP_ID, userId: member.id, role: "MEMBER" },
  });
}

async function main(): Promise<void> {
  await seedRolesAndPermissions(db);
  await seedAppSettings(db);
  await ensureUsers();
  await ensureSharedGroup();
}

main()
  .then(async () => {
    await db.$disconnect();
    // getAuth() opens the app-wide `@/server/db` pool, which would otherwise keep
    // the event loop alive and hang the process (and the CI seed step).
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { seedRolesAndPermissions, seedAppSettings } from "../prisma/seed";

// Puts the e2e database into a post-setup state: roles/permissions + app
// settings seeded, plus one user so the setup guard lets the smoke tests reach
// the app instead of redirecting everything to /setup. The setup-wizard e2e
// (which needs a fresh, user-less DB) stays skipped.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to seed e2e");

const db = new PrismaClient({ adapter: new PrismaMariaDb(url) });

async function main(): Promise<void> {
  await seedRolesAndPermissions(db);
  await seedAppSettings(db);
  if ((await db.user.count()) === 0) {
    await db.user.create({
      data: {
        id: "e2e-seed-admin",
        email: "e2e@bilan.local",
        name: "E2E Admin",
        emailVerified: true,
      },
    });
  }
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

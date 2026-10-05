// Idempotent seed of roles, permissions and default settings on every server start
// (spec §5); in prod the image CMD has applied the migrations just before.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { db } = await import("@/server/db");
  const { seedRolesAndPermissions, seedAppSettings } = await import("../prisma/seed");
  await seedRolesAndPermissions(db);
  await seedAppSettings(db);
}

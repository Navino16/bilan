import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { getAuth } from "@/server/auth";
import { grantRole } from "@/server/services/users/roles";
import { logEvent } from "@/server/services/audit";
import { isSetupNeeded } from "@/server/services/setup-status";
import { seedDefaultCategories } from "@/server/services/categories/seed-defaults";

export { isSetupNeeded };

export async function completeSetup(
  input: { email: string; password: string; name: string; locale?: "fr" | "en" },
  db: PrismaClient = defaultDb,
): Promise<{ userId: string }> {
  if (!(await isSetupNeeded(db))) throw new Error("Setup already completed: a user exists.");
  const auth = await getAuth();
  const res = await auth.api.signUpEmail({
    body: { email: input.email, password: input.password, name: input.name },
    // The signup hook seeds the default categories in this locale.
    headers: new Headers({ "accept-language": input.locale ?? "fr" }),
  });
  await grantRole(db, res.user.id, "SUPER_ADMIN", null);
  await db.userPreference.upsert({
    where: { userId: res.user.id },
    create: { userId: res.user.id, locale: input.locale ?? "fr" },
    update: { locale: input.locale ?? "fr" },
  });
  await seedDefaultCategories(res.user.id, input.locale ?? "fr", db);
  await logEvent({ userId: res.user.id, action: "auth.signup", metadata: { via: "setup" } });
  return { userId: res.user.id };
}

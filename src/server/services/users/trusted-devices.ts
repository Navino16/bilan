import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db";

// Better Auth stores each "trust this device" grant (2FA skipped at sign-in) as a
// verification row; the browser's cookie is useless once its row is gone.
export async function purgeTrustedDevices(
  userId: string,
  database: PrismaClient = db,
): Promise<number> {
  const { count } = await database.verification.deleteMany({
    where: { value: userId, identifier: { startsWith: "trust-device-" } },
  });
  return count;
}

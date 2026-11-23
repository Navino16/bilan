import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";

/**
 * Pure check: is first-run setup still required (no users yet)?
 * Kept dependency-light (only the db) so it can be imported by the route-level
 * proxy without pulling the full auth stack into the middleware bundle.
 */
export async function isSetupNeeded(db: PrismaClient = defaultDb): Promise<boolean> {
  const n = await db.user.count();
  return n === 0;
}

// Setup transitions one-way (no users → a user exists) and never reverts in
// normal operation, so once we observe it's done we cache that forever and
// stop hitting the DB on every request.
let setupDone = false;

export async function isSetupNeededCached(): Promise<boolean> {
  if (setupDone) return false;
  const needed = await isSetupNeeded();
  if (!needed) setupDone = true;
  return needed;
}

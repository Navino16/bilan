"use server";

import { requireSession } from "@/server/auth/permissions";
import { ImportAccessError } from "@/server/services/imports";
import {
  discardBatch,
  getRevertImpact,
  revertImport,
  type RevertImpact,
} from "@/server/services/imports/revert";

export type ImportActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: (userId: string) => Promise<T>): Promise<ImportActionResult<T>> {
  const user = await requireSession();
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (e) {
    return { ok: false, error: e instanceof ImportAccessError ? e.message : "FAILED" };
  }
}

export async function getRevertImpactAction(
  batchId: string,
): Promise<ImportActionResult<RevertImpact>> {
  return run((userId) => getRevertImpact(userId, batchId));
}

export async function revertImportAction(
  batchId: string,
): Promise<ImportActionResult<{ deleted: number; linksDissolved: number }>> {
  return run((userId) => revertImport(userId, batchId));
}

export async function discardImportAction(batchId: string): Promise<ImportActionResult<null>> {
  return run(async (userId) => {
    await discardBatch(userId, batchId);
    return null;
  });
}

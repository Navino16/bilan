"use server";

import { ZodError } from "zod";
import { requireSession } from "@/server/auth/permissions";
import {
  deleteAliasGroup,
  MerchantAliasError,
  removeMerchantAlias,
  renameAliasGroup,
  renameMerchant,
} from "@/server/services/merchants";
import { MERCHANT_NAME_MAX } from "@/lib/validation/merchant";

export type MerchantActionState = { ok: true } | { ok: false; error: string };

function failure(e: unknown): MerchantActionState {
  if (e instanceof ZodError) return { ok: false, error: "INVALID" };
  if (e instanceof MerchantAliasError) return { ok: false, error: "NOT_FOUND" };
  return { ok: false, error: "FAILED" };
}

// `from` set = rename the whole alias group; otherwise `key` alone is (re)named.
export async function saveMerchantNameAction(input: {
  key: string | null;
  from: string | null;
  name: string;
}): Promise<MerchantActionState> {
  const user = await requireSession();
  if (input.from && input.from.length > MERCHANT_NAME_MAX) return { ok: false, error: "INVALID" };
  try {
    if (input.from) await renameAliasGroup(user.id, input.from, input.name);
    else if (input.key) await renameMerchant(user.id, input.key, input.name);
    else return { ok: false, error: "INVALID" };
  } catch (e) {
    return failure(e);
  }
  return { ok: true };
}

export async function resetMerchantNameAction(name: string): Promise<MerchantActionState> {
  const user = await requireSession();
  try {
    await deleteAliasGroup(user.id, name);
  } catch (e) {
    return failure(e);
  }
  return { ok: true };
}

export async function removeMerchantAliasAction(key: string): Promise<MerchantActionState> {
  const user = await requireSession();
  try {
    await removeMerchantAlias(user.id, key);
  } catch (e) {
    return failure(e);
  }
  return { ok: true };
}

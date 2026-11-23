"use server";

import { z } from "zod";
import { authHeaders } from "@/server/http/auth-headers";
import { getCurrentSession, requireSession } from "@/server/auth/permissions";
import { locales } from "@/i18n/config";
import {
  isFreshSession,
  startIdentityLink,
  unlinkIdentity,
  type LinkStartError,
  type UnlinkError,
} from "@/server/services/users/identities";

export type IdentityActionError = LinkStartError | UnlinkError | "NOT_FRESH" | "INVALID";

const idSchema = z.string().min(1).max(191);
const localeSchema = z.enum(locales);

// Adding or removing a sign-in method needs a recent sign-in, like passkeys and Better Auth's unlink.
async function freshUser() {
  const user = await requireSession();
  const session = await getCurrentSession();
  if (!session || !(await isFreshSession(new Date(session.session.createdAt)))) return null;
  return user;
}

export async function linkIdentityAction(
  providerId: unknown,
  locale: unknown,
): Promise<{ ok: true; url: string } | { ok: false; error: IdentityActionError }> {
  const user = await freshUser();
  if (!user) return { ok: false, error: "NOT_FRESH" };
  const id = idSchema.safeParse(providerId);
  const loc = localeSchema.safeParse(locale);
  if (!id.success || !loc.success) return { ok: false, error: "INVALID" };
  return startIdentityLink(await authHeaders(), {
    userId: user.id,
    providerId: id.data,
    locale: loc.data,
  });
}

export async function unlinkIdentityAction(
  accountId: unknown,
): Promise<{ ok: true } | { ok: false; error: IdentityActionError }> {
  const user = await freshUser();
  if (!user) return { ok: false, error: "NOT_FRESH" };
  const id = idSchema.safeParse(accountId);
  if (!id.success) return { ok: false, error: "INVALID" };
  return unlinkIdentity(user.id, id.data);
}

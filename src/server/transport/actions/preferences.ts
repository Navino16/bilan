"use server";

import { getCurrentUser } from "@/server/auth/permissions";
import { isLocale } from "@/lib/locale-negotiation";
import { syncPreferredLocale } from "@/server/services/users/preferences";

// Signed out: a no-op, the NEXT_LOCALE cookie alone carries the choice.
export async function syncLocaleAction(locale: unknown): Promise<void> {
  if (!isLocale(locale)) return;
  const user = await getCurrentUser();
  if (user) await syncPreferredLocale(user.id, locale);
}

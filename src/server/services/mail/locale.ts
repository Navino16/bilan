import type { PrismaClient } from "@prisma/client";
import type { Locale } from "@/i18n/config";
import { db as defaultDb } from "@/server/db";
import { isLocale } from "@/lib/locale-negotiation";

// Spec §3.4, the one rule for every mail: a known recipient's stored preference,
// else the locale of the page that triggered the send.
export function pickMailLocale(stored: string | null | undefined, pageLocale: Locale): Locale {
  return isLocale(stored) ? stored : pageLocale;
}

export async function mailLocale(
  userId: string,
  pageLocale: Locale,
  db: PrismaClient = defaultDb,
): Promise<Locale> {
  const pref = await db.userPreference.findUnique({ where: { userId }, select: { locale: true } });
  return pickMailLocale(pref?.locale, pageLocale);
}

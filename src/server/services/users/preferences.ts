import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import type { Locale } from "@/i18n/config";

// Never overwrites: an existing row holds a locale the user already chose.
export async function storeSignupLocale(
  userId: string,
  locale: Locale,
  db: PrismaClient = defaultDb,
): Promise<void> {
  await db.userPreference.upsert({
    where: { userId },
    create: { userId, locale },
    update: {},
  });
}

// Called on every language switch and sign-in: write only when it changes something.
export async function syncPreferredLocale(
  userId: string,
  locale: Locale,
  db: PrismaClient = defaultDb,
): Promise<boolean> {
  const pref = await db.userPreference.findUnique({ where: { userId }, select: { locale: true } });
  if (pref?.locale === locale) return false;
  await db.userPreference.upsert({
    where: { userId },
    create: { userId, locale },
    update: { locale },
  });
  return true;
}

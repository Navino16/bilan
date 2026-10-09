import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import { defaultLocale, locales, type Locale } from "@/i18n/config";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function toLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : defaultLocale;
}

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

// The language switcher calls this on every switch: write only when it changes something.
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

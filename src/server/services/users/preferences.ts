import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/server/db";
import type { Locale } from "@/i18n/config";
import {
  LINK_WINDOW_DAYS_DEFAULT,
  linkSettingsSchema,
  type LinkSettings,
  type LinkSettingsInput,
} from "@/lib/validation/link-settings";

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

export class PreferenceInputError extends Error {}

export async function getLinkSuggestionSettings(
  userId: string,
  db: PrismaClient = defaultDb,
): Promise<LinkSettings> {
  const pref = await db.userPreference.findUnique({
    where: { userId },
    select: { linkWindowDays: true, linkMinAmount: true },
  });
  return {
    windowDays: pref?.linkWindowDays ?? LINK_WINDOW_DAYS_DEFAULT,
    minAmount: pref ? Number(pref.linkMinAmount) : 0,
  };
}

// `locale` only seeds a missing row; an existing row keeps the user's language.
export async function updateLinkSuggestionSettings(
  userId: string,
  input: LinkSettingsInput,
  locale: Locale,
  db: PrismaClient = defaultDb,
): Promise<LinkSettings> {
  const parsed = linkSettingsSchema.safeParse(input);
  if (!parsed.success) throw new PreferenceInputError("INVALID");
  const data = {
    linkWindowDays: parsed.data.windowDays,
    linkMinAmount: parsed.data.minAmount,
  };
  await db.userPreference.upsert({
    where: { userId },
    create: { userId, locale, ...data },
    update: data,
  });
  return parsed.data;
}

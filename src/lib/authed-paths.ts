import { locales } from "@/i18n/config";

/** Top-level segments of app/[locale]/(authenticated) — kept in sync by a unit test. */
export const AUTHED_SEGMENTS = [
  "accounts",
  "admin",
  "budgets",
  "categories",
  "dashboard",
  "groups",
  "import",
  "insights",
  "settings",
  "transactions",
] as const;

const AUTHED_PATH = new RegExp(`^/(${locales.join("|")})/(?:${AUTHED_SEGMENTS.join("|")})(?:/|$)`);

/** Locale of an authenticated-area pathname, or null for public paths. */
export function authedPathLocale(pathname: string): string | null {
  return AUTHED_PATH.exec(pathname)?.[1] ?? null;
}

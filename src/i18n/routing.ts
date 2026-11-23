import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

// Persistent like the theme cookie: the browsing locale is per browser (spec §3.4).
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const routing = defineRouting({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always",
  localeCookie: { maxAge: LOCALE_COOKIE_MAX_AGE },
});

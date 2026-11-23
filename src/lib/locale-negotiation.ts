import { defaultLocale, locales, type Locale } from "@/i18n/config";

// Client-safe: also read by the root error boundary from document.cookie / navigator.languages.

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function cookieLocale(cookie: string | null | undefined): Locale | undefined {
  const value = cookie?.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)?.[1];
  return isLocale(value) ? value : undefined;
}

export function acceptLanguageLocale(header: string | null | undefined): Locale | undefined {
  const ranked = (header ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { lang: tag.split("-")[0].toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((l) => l.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.map((l) => l.lang).find(isLocale);
}

export function negotiateLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  return cookieLocale(cookie) ?? acceptLanguageLocale(acceptLanguage) ?? defaultLocale;
}

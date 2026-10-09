import { defaultLocale, locales, type Locale } from "@/i18n/config";
import { env } from "@/env";

const isLocale = (v: string | undefined): v is Locale =>
  !!v && (locales as readonly string[]).includes(v);

function fromPath(pathname: string): Locale | undefined {
  const segment = pathname.split("/")[1];
  return isLocale(segment) ? segment : undefined;
}

function fromReferer(referer: string | null, appUrl: string): Locale | undefined {
  if (!referer) return undefined;
  try {
    const url = new URL(referer);
    return url.origin === new URL(appUrl).origin ? fromPath(url.pathname) : undefined;
  } catch {
    return undefined;
  }
}

function fromCookie(cookie: string | null): Locale | undefined {
  const value = cookie?.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)?.[1];
  return isLocale(value) ? value : undefined;
}

function fromAcceptLanguage(header: string | null): Locale | undefined {
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

function negotiated(headers: Headers): Locale {
  return (
    fromCookie(headers.get("cookie")) ??
    fromAcceptLanguage(headers.get("accept-language")) ??
    defaultLocale
  );
}

// Locale of the page a request comes from: the /fr|/en path of a same-origin Referer,
// then the next-intl cookie, then Accept-Language — the order the locale middleware uses.
export function requestLocale(headers: Headers | undefined, appUrl: string = env.APP_URL): Locale {
  if (!headers) return defaultLocale;
  return fromReferer(headers.get("referer"), appUrl) ?? negotiated(headers);
}

// Locale of the requested page itself (responses the proxy renders on its own).
export function pageLocale(pathname: string, headers: Headers): Locale {
  return fromPath(pathname) ?? negotiated(headers);
}

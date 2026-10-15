import { defaultLocale, type Locale } from "@/i18n/config";
import { env } from "@/env";
import { acceptLanguageLocale, cookieLocale, isLocale } from "@/lib/locale-negotiation";

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

function negotiated(headers: Headers): Locale | undefined {
  return (
    cookieLocale(headers.get("cookie")) ?? acceptLanguageLocale(headers.get("accept-language"))
  );
}

// Locale of the page a request comes from: the /fr|/en path of a same-origin Referer,
// then the next-intl cookie, then Accept-Language — the order the locale middleware uses.
// Undefined when the request carries none of them.
export function requestLocaleHint(
  headers: Headers | undefined,
  appUrl: string = env.APP_URL,
): Locale | undefined {
  if (!headers) return undefined;
  return fromReferer(headers.get("referer"), appUrl) ?? negotiated(headers);
}

export function requestLocale(headers: Headers | undefined, appUrl: string = env.APP_URL): Locale {
  return requestLocaleHint(headers, appUrl) ?? defaultLocale;
}

// Locale of the requested page itself (responses the proxy renders on its own).
export function pageLocale(pathname: string, headers: Headers): Locale {
  return fromPath(pathname) ?? negotiated(headers) ?? defaultLocale;
}

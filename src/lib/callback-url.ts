import { locales } from "@/i18n/config";

/** Request header the proxy stamps with the requested path + query (always overwritten). */
export const REQUEST_PATH_HEADER = "x-bilan-path";

const MAX_LENGTH = 2048;
const PROBE_ORIGIN = "http://callback.invalid";
// Control chars and whitespace are stripped or reinterpreted by URL parsers
// ("/\t/evil" → "//evil"); backslashes are read as "/" by browsers.
const UNSAFE_CHARS = /[\s\\\u0000-\u001f\u007f]/;
const LOCALE = `(${locales.join("|")})`;
const APP_PATH = new RegExp(`^/${LOCALE}(?:[/?#]|$)`);
const AUTH_PAGE = new RegExp(`^/${LOCALE}/(?:login|register|reset|setup)(?:[/?#]|$)`);

export function safeCallbackPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || UNSAFE_CHARS.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;

  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.startsWith("//") || !APP_PATH.test(path) || AUTH_PAGE.test(path)) return null;
  return path;
}

/** Locale prefix of a path accepted by safeCallbackPath. */
export function pathLocale(safePath: string): string {
  return APP_PATH.exec(safePath)![1];
}

export function postLoginPath(raw: unknown, locale: string): string {
  return safeCallbackPath(raw) ?? `/${locale}/dashboard`;
}

export function loginRedirectPath(locale: string, target: unknown): string {
  const safe = safeCallbackPath(target);
  if (!safe || safe === `/${locale}/dashboard`) return `/${locale}/login`;
  return `/${locale}/login?callbackUrl=${encodeURIComponent(safe)}`;
}

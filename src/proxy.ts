import createIntlMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { defaultLocale, locales } from "@/i18n/config";
import { authedPathLocale } from "@/lib/authed-paths";
import { loginRedirectPath, REQUEST_PATH_HEADER } from "@/lib/callback-url";
import { isSetupNeededCached } from "@/server/services/setup-status";
import { withClientIp } from "@/server/http/client-ip";
import { notFoundResponse } from "@/server/http/not-found";
import { getAppName } from "@/server/services/settings/app-settings";
import { pageLocale } from "@/server/http/request-locale";
import { BASE_SECURITY_HEADERS } from "@/lib/security-headers";

// Persistent like the theme cookie: the browsing locale is per browser (spec §3.4).
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const intlMiddleware = createIntlMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always",
  localeCookie: { maxAge: LOCALE_COOKIE_MAX_AGE },
});

// Spec §6.6 — security headers attached to every (non-static) page response; /api gets
// its own from next.config.ts.
//
// CSP note (scope 8.5): a per-request nonce was evaluated but not shipped. The
// app authors no inline <script> (the theme is server-rendered, no pre-paint
// script), so the only inline scripts are Next's own RSC bootstrap, which need
// either a nonce or 'unsafe-inline'. Nonce-ing Next's scripts requires injecting
// the CSP onto the *request* headers, which the next-intl middleware (URL
// rewrites) doesn't propagate cleanly — attempting it risks breaking every page.
// Instead we ship the plan's documented hardening: drop 'unsafe-eval' in
// production (only dev/HMR needs it) and add object-src 'none'. Rollback = the
// previous policy (add back 'unsafe-eval', drop object-src).
const isProd = process.env.NODE_ENV === "production";
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const SECURITY_HEADERS: Record<string, string> = {
  ...BASE_SECURITY_HEADERS,
  "Content-Security-Policy": [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    // Only behind HTTPS: on plain HTTP (dev, LAN, CI) Safari upgrades even localhost
    // subresources and the page loads without CSS.
    ...(isProd && process.env.APP_URL?.startsWith("https://") ? ["upgrade-insecure-requests"] : []),
  ].join("; "),
};

// Spec §3.5 / §5.1 — until the first user exists, /setup is the only reachable
// page; once setup is done, /setup permanently 404s.
const setupPath = /^\/(fr|en)\/setup(\/|$)/;

// Spec §3.2 — authenticated areas. The proxy only performs a cheap presence
// check on the session cookie (UX fast-path: unauthenticated requests get a 307
// to /login without a DB round-trip). The authoritative check is the
// (authenticated) layout's requireSession(). The __Secure- prefix lands once the
// deployment is on HTTPS (Better Auth toggles it from the request protocol).

function hasSessionCookie(req: NextRequest): boolean {
  return (
    req.cookies.has("better-auth.session_token") ||
    req.cookies.has("__Secure-better-auth.session_token")
  );
}

function withSecurityHeaders<R extends Response>(response: R): R {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (await isSetupNeededCached()) {
    if (!setupPath.test(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = `/${pageLocale(pathname, req.headers)}/setup`;
      return Response.redirect(url, 307);
    }
  } else if (setupPath.test(pathname)) {
    return withSecurityHeaders(notFoundResponse(pathname, req.headers, await getAppName()));
  }

  const target = `${pathname}${req.nextUrl.search}`;
  const authedLocale = authedPathLocale(pathname);
  if (authedLocale && !hasSessionCookie(req)) {
    return Response.redirect(new URL(loginRedirectPath(authedLocale, target), req.nextUrl), 307);
  }

  // next-intl forwards the incoming request headers to the app, so these reach
  // requireSession() (stale-cookie deep links) and Server Actions; both discard any client value.
  const headers = withClientIp(req.headers);
  headers.set(REQUEST_PATH_HEADER, target);
  return withSecurityHeaders(intlMiddleware(new NextRequest(req, { headers })));
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};

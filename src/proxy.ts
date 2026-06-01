import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { defaultLocale, locales } from "@/i18n/config";
import { isSetupNeededCached } from "@/server/services/setup-status";

const intlMiddleware = createIntlMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always",
});

// Spec §6.6 — security headers attached to every (non-static) response.
// Strict CSP with per-request nonce is deferred to scope 8.5; the current CSP
// is the most restrictive policy compatible with Next.js dev tooling.
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
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
const authedPath =
  /^\/(fr|en)\/(dashboard|transactions|accounts|budgets|categories|groups|import|settings|admin)(\/|$)/;

function hasSessionCookie(req: NextRequest): boolean {
  return (
    req.cookies.has("better-auth.session_token") ||
    req.cookies.has("__Secure-better-auth.session_token")
  );
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (await isSetupNeededCached()) {
    if (!setupPath.test(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = `/${defaultLocale}/setup`;
      return Response.redirect(url, 307);
    }
  } else if (setupPath.test(pathname)) {
    return new Response("Not found", { status: 404 });
  }

  const authedMatch = authedPath.exec(pathname);
  if (authedMatch && !hasSessionCookie(req)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${authedMatch[1]}/login`;
    return Response.redirect(url, 307);
  }

  const response = intlMiddleware(req);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};

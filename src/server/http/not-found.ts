import type { Locale } from "@/i18n/config";
import { pageLocale } from "./request-locale";

const COPY: Record<Locale, { message: string; back: string }> = {
  fr: { message: "Cette page n’existe pas ou a été déplacée.", back: "Retour" },
  en: { message: "This page doesn’t exist or has moved.", back: "Back" },
};

// Minimal Bilan-styled 404 for the proxy's own not-found branch, which renders outside
// the app's ErrorShell / next-intl tree. Dependency-free HTML.
export function notFoundResponse(pathname: string, headers: Headers): Response {
  const locale = pageLocale(pathname, headers);
  const { message, back } = COPY[locale];
  const body = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bilan — 404</title><style>body{min-height:100vh;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;font-family:system-ui,sans-serif;background:#f7f4ed;color:#15130f;text-align:center}p.code{color:#6b7280;font-family:monospace;margin:0}h1{font-size:2rem;margin:0}a{color:#1f4d3a}@media(prefers-color-scheme:dark){body{background:#0f1114;color:#e6e1d4}}</style></head><body><p class="code">404</p><h1>Bilan</h1><p>${message}</p><a href="/${locale}">${back}</a></body></html>`;
  return new Response(body, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Language": locale },
  });
}

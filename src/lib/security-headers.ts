// Spec §6.6. Pages get them from proxy.ts with their CSP, API routes from next.config.ts:
// running the proxy on /api would cap upload bodies at its 10 MB clone limit.
export const BASE_SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

// API responses are data or downloads, never rendered as a page.
export const API_SECURITY_HEADERS: Record<string, string> = {
  ...BASE_SECURITY_HEADERS,
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

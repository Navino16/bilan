// Bilan app-shell service worker (hand-authored, no build step).
// Bump CACHE (-v3, …) whenever the shell changes so old caches are evicted on activate.
//
// SECURITY: only STATIC, non-sensitive assets are ever cached. Authenticated
// HTML pages (dashboard/transactions/…) contain private financial data and must
// never be persisted in the shared Cache API — they are passed straight through
// to the network (no respondWith), so nothing is stored and cross-user/offline
// disclosure is impossible.
const CACHE = "bilan-shell-v2";
const ASSETS = ["/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first ONLY for static, non-sensitive assets. Everything else (pages,
  // /api, anything requiring auth) is left to the network — never stored.
  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:css|js|png|svg|ico|webp|woff2?)$/.test(url.pathname);
  if (!isStatic) return;

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }),
    ),
  );
});

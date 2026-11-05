/* SiteSnap HK service worker — shell assets only.
   Auth lives in sessionStorage (never written into Cache Storage).
   Navigate / gate / auth.config: network-first so password gate updates aren't stuck behind an old shell. */
const CACHE = "sitesnap-shell-user-language-v8";
const shell = ["./style.css?v=user-menu-8", "./i18n.js?v=user-menu-8", "./app.js?v=user-menu-8", "./ai.js?v=user-menu-8"].map(
  (s) => new URL(s, self.registration.scope).href,
);
const networkFirst = ["./index.html", "./gate.js", "./auth.config.js"].map(
  (s) => new URL(s, self.registration.scope).href,
);

self.addEventListener("install", (e) =>
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll(shell);
      await self.skipWaiting();
    })(),
  ),
);

self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys())
        if (k.startsWith("sitesnap-shell-") && k !== CACHE)
          await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);

async function fromNetworkFirst(req, fallbackUrl) {
  try {
    const fresh = await fetch(req, { cache: "no-store" });
    return fresh;
  } catch (_) {
    const c = await caches.open(CACHE);
    return (await c.match(fallbackUrl)) || Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;

  const scopePath = new URL(self.registration.scope).pathname;
  const isHome =
    e.request.mode === "navigate" &&
    (u.pathname === scopePath ||
      u.pathname === scopePath.replace(/\/$/, "") ||
      u.href.split("?")[0] === networkFirst[0]);

  if (isHome || networkFirst.includes(u.href.split("?")[0])) {
    const key = isHome ? networkFirst[0] : u.href.split("?")[0];
    e.respondWith(fromNetworkFirst(e.request, key));
    return;
  }

  if (!shell.includes(u.href)) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => (await c.match(u.href)) || fetch(e.request)),
  );
});

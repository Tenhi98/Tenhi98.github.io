const CACHE = "sitesnap-shell-source-v2",
  shell = ["./index.html", "./style.css", "./app.js", "./ai.js", "./gate.js", "./auth.config.js"].map(
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
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  const isHome =
    e.request.mode === "navigate" &&
    (u.pathname === new URL(self.registration.scope).pathname ||
      u.href.split("?")[0] === shell[0]);
  if (!isHome && !shell.includes(u.href)) return;
  e.respondWith(
    caches
      .open(CACHE)
      .then(
        async (c) =>
          (await c.match(isHome ? shell[0] : u.href)) || fetch(e.request),
      ),
  );
});

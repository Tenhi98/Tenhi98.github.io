/* SiteSnap（Claude 版）離線支援
   安裝時把整個介面存進快取，所以在地盤沒有網絡時也能開啟。
   頁面：先試網絡（有更新就用新版），失敗才用快取。
   其他檔案：先用快取（快），同時在背景更新。 */
const VERSION = "sitesnap-claude-v1";
const ASSETS = ["./", "./index.html", "./style.css?v=1", "./i18n.js?v=1", "./store.js?v=1", "./app.js?v=1", "./ai.js?v=1", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("sitesnap-claude-") && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return; // AI 等外部請求不經快取

  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        if (fresh.ok) (await caches.open(VERSION)).put("./index.html", fresh.clone());
        return fresh;
      } catch {
        const c = await caches.open(VERSION);
        return (await c.match("./index.html")) || (await c.match("./")) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req);
    const update = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(update); return hit; }
    return (await update) || Response.error();
  })());
});

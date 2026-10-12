/* Author: Barzil Bruton.
 * Service worker for the batch watermark tool.
 *
 * Page loads are network first with a 3-second fallback: if the network has
 * not answered the page request within NAV_TIMEOUT_MS and a cached copy exists,
 * the cached copy is served so a slow connection still opens quickly.
 *
 * The choice is made once per page load and every module that page requests
 * follows it. A page served from cache loads its modules from cache; a page
 * served from the network loads them from the network. The app is split
 * across several module files, and taking some from each source could pair a
 * new module with an old one it no longer matches.
 *
 * The cache only ever holds one complete deploy. build.mjs replaces CACHE with
 * a name derived from a hash of every shipped file and fills APP_SHELL with
 * the shipped file list, so each deploy installs a full fresh copy and the
 * previous one is deleted on activation. Network responses for the app's own
 * files are not written into it, which keeps it from mixing versions.
 *
 * CDN files (the ffmpeg core, JSZip, Google Fonts) live under pinned version
 * URLs that never change, so they are served cache first and cached on first
 * use. The ffmpeg core is about 32 MB and is downloaded once.
 */
const CACHE = "watermark-dev";
const APP_SHELL = [];
const NAV_TIMEOUT_MS = 3000;

const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

/* Local development is never cached, so an edit shows up on reload. */
const host = self.location.hostname;
const LOCAL = host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/* Page loads served from cache, by client id. Their module requests are
   answered from cache too. Entries are removed when the client goes away. */
const fromCache = new Set();

self.addEventListener("install", (e) => {
  self.skipWaiting();
  if (LOCAL || !APP_SHELL.length) return;
  /* addAll is all or nothing: a partial copy is never installed. If it fails,
     the previous worker and its complete cache stay in charge. */
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

/* Resolves with the network response, or with null if it fails. */
const fromNetwork = (req) => fetch(req).catch(() => null);

/* Network first, but after `ms` a cached copy is used if one exists. The
   network request is not abandoned; if no cached copy exists, its answer is
   awaited. `onCache` runs when the cached copy wins. */
async function networkWithFallback(req, cache, ms, onCache) {
  const network = fromNetwork(req);
  const timer = new Promise((r) => setTimeout(() => r("timeout"), ms));
  const first = await Promise.race([network, timer]);
  if (first && first !== "timeout") return first;
  const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
  if (hit) { onCache(); return hit; }
  const res = first === "timeout" ? await network : null;
  return res || new Response("Offline and not cached yet.", { status: 504, statusText: "Offline" });
}

async function forgetClosedClients() {
  const open = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map((c) => c.id));
  for (const id of fromCache) if (!open.has(id)) fromCache.delete(id);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || LOCAL) return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN.test(url.origin);
  if (!sameOrigin && !cdn) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (cdn) {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fromNetwork(req);
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
        return res || new Response("Offline and not cached yet.", { status: 504, statusText: "Offline" });
      }

      if (req.mode === "navigate") {
        const client = e.resultingClientId;
        if (client) fromCache.delete(client);
        e.waitUntil(forgetClosedClients());
        return networkWithFallback(req, cache, NAV_TIMEOUT_MS, () => { if (client) fromCache.add(client); });
      }

      if (fromCache.has(e.clientId)) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      const res = await fromNetwork(req);
      if (res) return res;
      return (await cache.match(req)) || new Response("Offline and not cached yet.", { status: 504, statusText: "Offline" });
    })()
  );
});

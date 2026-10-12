/* Author: Barzil Bruton.
 * Service worker for the batch watermark tool.
 *
 * Same-origin files (the page and its modules) are served network first, with
 * the cache as the offline fallback. Stale-while-revalidate is not used: the
 * app is split across several module files, and serving some from cache and
 * some from the network could pair a new module with an old one it no longer
 * matches. Network first always loads one consistent version while online.
 *
 * CDN files (the ffmpeg core, JSZip, Google Fonts) live under pinned version
 * URLs that never change, so they are served cache first. The ffmpeg core is
 * about 32 MB and is downloaded once.
 *
 * APP_SHELL is precached on install so the app opens offline even for files
 * the first visit loaded before this worker was in control. build.mjs fills
 * the list in from its ship list; the source copy is empty. Changing CACHE
 * discards everything cached under the previous name on activation.
 */
const CACHE = "watermark-v2";
const APP_SHELL = [];

const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

/* Local development is never cached, so an edit shows up on reload. */
const host = self.location.hostname;
const LOCAL = host === "localhost" || host === "127.0.0.1" || host === "[::1]";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  if (LOCAL || !APP_SHELL.length) return;
  /* Each file is added on its own, so one failed request does not block the
     install. Anything missing is fetched from the network when needed. */
  e.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(APP_SHELL.map((u) => cache.add(u))))
  );
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
      }

      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) {
        const hit = await cache.match(req);
        if (hit) return hit;
        return new Response("Offline and not cached yet.", { status: 504, statusText: "Offline" });
      }
    })()
  );
});

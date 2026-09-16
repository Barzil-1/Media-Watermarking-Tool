/* Service worker for the batch watermark tool.
 *
 * The point of this file is the video core: @ffmpeg/core-mt is about 32 MB and
 * lives on a CDN under a pinned version number, so it never changes and should
 * only ever be downloaded once. Same-origin files use stale-while-revalidate so
 * a new deploy is picked up on the next visit without a hard refresh.
 *
 * Bump CACHE when you want to throw everything away and start clean.
 */
const CACHE = "watermark-v1";

const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener("install", () => self.skipWaiting());

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
  if (req.method !== "GET") return;

  // Never cache during local testing, or an edit to the page looks like it did nothing.
  const host = self.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN.test(url.origin);
  if (!sameOrigin && !cdn) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);

      // Pinned CDN assets never change: serve from cache the moment we have one.
      if (hit && cdn) return hit;

      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);

      if (hit) {
        e.waitUntil(network);
        return hit;
      }
      const res = await network;
      if (res) return res;
      return new Response("Offline and not cached yet.", { status: 504, statusText: "Offline" });
    })()
  );
});

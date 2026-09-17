/* Author: Barzil Bruton.
 * Local test server. Development only - not needed on Cloudflare Pages, which
 * reads the headers from _headers instead.
 *
 *   node serve.mjs            -> http://localhost:8080
 *   node serve.mjs 3000       -> pick another port
 *
 * It sends the same COOP/COEP pair as _headers, so `crossOriginIsolated` is
 * true and you are testing the fast multi-threaded video core, not the slow
 * fallback. Opening the .html by double-click cannot do videos at all.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.argv[2] || 8080);
// Optional folder to serve, so you can check the built copy: node serve.mjs 8080 dist
const ROOT = path.resolve(import.meta.dirname ?? ".", process.argv[3] || ".");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8"
};

http
  .createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (pathname === "/") pathname = "/batch-watermark.html";

    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Not found: ${pathname}`);
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Content-Length": body.length,
        // the two lines that make SharedArrayBuffer available
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cache-Control": "no-store"
      });
      res.end(body);
    });
  })
  .listen(PORT, () => {
    console.log(`Serving ${ROOT}`);
    console.log(`  http://localhost:${PORT}`);
    console.log("  cross-origin isolated: yes (multi-threaded video core)");
  });

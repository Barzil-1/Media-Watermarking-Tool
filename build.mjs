/* Author: Barzil Bruton.
 * Assembles dist/: exactly the files the client's copy needs, nothing else.
 *
 *   node build.mjs
 *
 * Then drag dist/ onto Cloudflare Pages (or Netlify Drop). Development files
 * like serve.mjs and DEPLOY.md are deliberately left out, so nothing internal
 * ends up publicly readable.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname ?? ".");
const DIST = path.join(ROOT, "dist");

// Allowlist, not a denylist: a new stray file in the folder can never leak.
const SHIP = [
  "batch-watermark.html",
  "_headers",
  "_redirects",
  "manifest.webmanifest",
  "sw.js",
  "icon-192.png",
  "icon-512.png",
  "vendor/ffmpeg/ffmpeg.js",
  "vendor/ffmpeg/814.ffmpeg.js"
];

let failed = false;

// Guard against shipping a build that cannot load its own video engine.
const page = fs.readFileSync(path.join(ROOT, "batch-watermark.html"), "utf8");
if (!page.includes('FF_MAIN = "vendor/ffmpeg/ffmpeg.js"')) {
  console.error("! batch-watermark.html does not point at the vendored ffmpeg loader.");
  console.error("  Videos will fail with a cross-origin Worker error. Not building.");
  process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });

let total = 0;
for (const rel of SHIP) {
  const from = path.join(ROOT, rel);
  const to = path.join(DIST, rel);
  if (!fs.existsSync(from)) {
    console.error(`! missing: ${rel}`);
    failed = true;
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const size = fs.statSync(to).size;
  total += size;
  console.log(`  ${String(Math.ceil(size / 1024)).padStart(5)} KB  ${rel}`);
}

if (failed) {
  console.error("\nBuild incomplete: fix the missing files above.");
  process.exit(1);
}

console.log(`\ndist/ ready: ${SHIP.length} files, ${(total / 1024).toFixed(0)} KB total.`);
console.log("Drag the dist folder onto https://dash.cloudflare.com (Workers & Pages).");
console.log("The 32 MB video core is NOT in here; it loads from the CDN on first use.");

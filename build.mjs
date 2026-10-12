/* Author: Barzil Bruton.
 * Assembles dist/: exactly the files the deployed site needs, nothing else.
 *
 *   node build.mjs
 *
 * Cloudflare runs this on every push to main and serves dist/. Development
 * files such as serve.mjs and DEPLOY.md are left out, so nothing internal is
 * publicly readable.
 *
 * The build fails, and ships nothing, if any of these checks fail:
 *   1. src/shared/engine.js points at the vendored ffmpeg loader.
 *   2. The page's module entry point is part of the build.
 *   3. Every relative import in a shipped module resolves to a shipped file.
 *   4. sw.js contains the CACHE and APP_SHELL markers the build fills in.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname ?? ".");
const DIST = path.join(ROOT, "dist");
const ENTRY_PAGE = "batch-watermark.html";
const ENGINE = "src/shared/engine.js";
const SHELL_MARKER = "const APP_SHELL = [];";
const CACHE_MARKER = 'const CACHE = "watermark-dev";';

/* Allowlist, not a denylist: a stray file in the folder can never leak.
   SHIP_FILES are copied as listed. SHIP_DIRS are copied recursively, keeping
   only files with the given extensions. */
const SHIP_FILES = [
  ENTRY_PAGE,
  "_headers",
  "_redirects",
  "manifest.webmanifest",
  "sw.js",
  "icon-192.png",
  "icon-512.png",
  "vendor/ffmpeg/ffmpeg.js",
  "vendor/ffmpeg/814.ffmpeg.js"
];
const SHIP_DIRS = [
  { dir: "src", ext: [".js"] }
];

/* Files Cloudflare reads as configuration rather than serves. They are
   shipped but never precached. */
const NOT_SERVED = new Set(["_headers", "_redirects", "sw.js"]);

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const fail = (lines) => {
  for (const l of lines) console.error(l);
  console.error("\nBuild stopped. Nothing was written to dist/.");
  process.exit(1);
};

function walk(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (ext.includes(path.extname(e.name))) out.push(rel(p));
  }
  return out;
}

const ship = [...SHIP_FILES];
for (const { dir, ext } of SHIP_DIRS) ship.push(...walk(path.join(ROOT, dir), ext).sort());
const shipped = new Set(ship);

const missing = ship.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) fail(missing.map((f) => `! missing: ${f}`));

/* Check 1: the engine must load ffmpeg.js from this origin, or every video
   export fails with a cross-origin Worker error. */
const engineSrc = fs.readFileSync(path.join(ROOT, ENGINE), "utf8");
if (!engineSrc.includes('FF_MAIN = "vendor/ffmpeg/ffmpeg.js"')) {
  fail([`! ${ENGINE} does not point at the vendored ffmpeg loader.`,
    "  Videos would fail with a cross-origin Worker error."]);
}

/* Check 2: the page's module entry point is shipped. */
const page = fs.readFileSync(path.join(ROOT, ENTRY_PAGE), "utf8");
const entries = [...page.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
if (!entries.length) fail([`! ${ENTRY_PAGE} has no <script type="module" src="..."> entry point.`]);
const badEntries = entries.filter((e) => !shipped.has(e));
if (badEntries.length) fail(badEntries.map((e) => `! ${ENTRY_PAGE} loads ${e}, which is not in the build.`));

/* Check 3: every relative import in a shipped module resolves to a shipped
   file. A module left out of the build only fails at load time in the
   browser, so it is caught here instead. */
const IMPORT_RE = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
const unresolved = [];
for (const f of ship.filter((x) => x.endsWith(".js") && x.startsWith("src/"))) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec.startsWith(".")) continue;
    const target = rel(path.resolve(path.dirname(path.join(ROOT, f)), spec));
    if (!shipped.has(target)) unresolved.push(`! ${f} imports ${spec}, which is not in the build.`);
  }
}
if (unresolved.length) fail(unresolved);

/* Check 4: the service worker receives the cache name and precache list. */
const swSrc = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
for (const marker of [CACHE_MARKER, SHELL_MARKER]) {
  if (!swSrc.includes(marker)) fail([`! sw.js is missing the line: ${marker}`]);
}

fs.rmSync(DIST, { recursive: true, force: true });

let total = 0;
for (const f of ship) {
  const to = path.join(DIST, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), to);
  const size = fs.statSync(to).size;
  total += size;
  console.log(`  ${String(Math.ceil(size / 1024)).padStart(5)} KB  ${f}`);
}

/* The precache list is generated from the ship list, so a new module or
   asset is cached for offline use without editing sw.js. "./" is the root
   URL, which _redirects serves as the entry page.

   The cache name is a hash of every shipped file. Any change to the app
   therefore changes sw.js, the browser installs the new worker, and the new
   deploy is cached as a complete set while the previous one is discarded. */
const shell = ["./", ...ship.filter((f) => !NOT_SERVED.has(f))];
const hash = crypto.createHash("sha256");
for (const f of ship) if (f !== "sw.js") hash.update(f + "\0").update(fs.readFileSync(path.join(ROOT, f)));
const version = hash.digest("hex").slice(0, 12);
fs.writeFileSync(
  path.join(DIST, "sw.js"),
  swSrc
    .replace(CACHE_MARKER, `const CACHE = "watermark-${version}";`)
    .replace(SHELL_MARKER, `const APP_SHELL = ${JSON.stringify(shell)};`)
);

console.log(`\ndist/ ready: ${ship.length} files, ${(total / 1024).toFixed(0)} KB total, ${shell.length} precached as watermark-${version}.`);
console.log("Push to main and Cloudflare builds and deploys it.");
console.log("The 32 MB video core is not in here; it loads from the CDN on first use.");

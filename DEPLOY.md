# Deploying the watermark tool

## What is in this folder

| File | What it is |
| --- | --- |
| `batch-watermark.html` | The whole tool. Still one file, still no build step. |
| `_headers` | The COOP/COEP headers that unlock the fast video core. |
| `_redirects` | Serves the tool at the bare domain. |
| `manifest.webmanifest`, `icon-192.png`, `icon-512.png` | Let the client install it as an app. |
| `sw.js` | Caches the video core so the 32 MB download happens once. |
| `vendor/ffmpeg/` | The ffmpeg.wasm loader and its worker chunk. Must be same-origin — see below. |
| `serve.mjs` | Local test server with the right headers. Development only. |
| `build.mjs` | Assembles `dist/` — the exact files to deploy. Development only. |

All five support files are optional in the sense that the tool still runs without
them. What you lose without each one is spelled out below.

## Why it can no longer be a double-clicked file

Opening the HTML from the file system gives the page a null origin. Web workers
created from blob URLs and cross-origin WebAssembly fetches are both unreliable
there, and ffmpeg.wasm needs both. Images still work offline from a file, but
video does not, so the tool needs a real origin.

## Sending it to the client

The client cannot be sent a zip. Opened from a file on disk the page has a null
origin, where the video engine's worker cannot start — images would work and
every video would refuse. It has to be a URL.

```
node build.mjs          # writes dist/
node serve.mjs 8100 dist    # optional: check the built copy first
```

Then deploy `dist/` as below and send him the link. He installs nothing.

`build.mjs` copies from an explicit allowlist, so `serve.mjs`, `DEPLOY.md` and
anything else you leave lying around never end up publicly readable.

## Testing locally

```
node serve.mjs              # the working folder
node serve.mjs 8100 dist    # the built copy
```

Then open <http://localhost:8080>. This sends the same COOP/COEP pair as
`_headers`, so you are testing the fast video core rather than the fallback.
`sw.js` deliberately does no caching on localhost, so edits show up on reload.

## Why `vendor/ffmpeg/` has to be same-origin

`ffmpeg.js` spawns its own worker from a sibling file, `814.ffmpeg.js`, and a
`Worker` cannot be constructed from a different origin — serving `ffmpeg.js`
from a CDN fails with a SecurityError. Both files are a few kilobytes, so they
are vendored here and the page loads them from its own origin.

The library does accept a `classWorkerURL` option to point at a blob URL
instead, but in the UMD build that path creates the worker with
`{ type: "module" }`, and the chunk uses `importScripts`, so it breaks. Don't
reach for it.

Only `ffmpeg-core.wasm` (32.7 MB) comes from jsDelivr. That one is fetched with
`fetch()` and wrapped in a blob URL, which is allowed cross-origin, and jsDelivr
sends both `Access-Control-Allow-Origin: *` and
`Cross-Origin-Resource-Policy: cross-origin`, which is what COEP requires.

If you upgrade `@ffmpeg/ffmpeg`, re-download both files from
`https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@<version>/dist/umd/` — the chunk
number can change between versions.

## Deploying to Cloudflare Pages

1. Sign in at <https://dash.cloudflare.com> and go to **Workers & Pages → Create → Pages → Upload assets**.
2. Give the project a name, then drag this entire folder in. There is no build
   command and no framework preset to choose.
3. Deploy. You get a `https://<project>.pages.dev` URL straight away.

To update later, drag the folder in again and create a new deployment.

Netlify works identically (`https://app.netlify.com/drop`) and reads the same
`_headers` and `_redirects` files. **GitHub Pages will not work well here** — it
cannot set custom response headers, so the fast video core stays unavailable.

### Check the headers landed

Open the deployed URL, then in the browser console:

```js
crossOriginIsolated   // must be true
```

If it prints `false`, the `_headers` file did not take effect. The tool still
works, it just falls back to the single-threaded core and every video takes
roughly two to three times longer. Nothing else changes and the output is
identical.

## What to tell the client

> Open <the URL> in Chrome or Edge. Click the install icon in the address bar
> (or **⋮ → Cast, save and share → Install page as app**) and it becomes an icon
> you can pin to the taskbar, exactly like a normal program.
>
> The first time you use a video it will spend a moment getting ready — that is a
> one-off download. After that it works even with no internet.
>
> Nothing you add is ever uploaded anywhere. Every photo and video stays on your
> own computer; the website only sends the page itself.

## Notes for future work

**Fonts.** The page still loads Google Fonts over the network. That is COEP-safe
because the `<link>` carries `crossorigin`, but it means the watermark depends on
a third party being reachable. If you ever want to remove that dependency,
download the seven families as `.woff2`, drop them in a `fonts/` folder, and
replace the `<link>` with local `@font-face` rules. Nothing else has to change.

**Why the ffmpeg core is not bundled.** Cloudflare Pages rejects single files
over 25 MiB and `ffmpeg-core.wasm` is larger than that, so it is fetched from
jsDelivr at a pinned version and cached by `sw.js`. If you move to a host without
that limit, self-hosting it is a two-line change to `FF_CORE` in the page.

**Speed.** Encoding is the entire cost of the video feature. If clips get long
enough that the wait becomes the complaint, the next step is a WebCodecs fast
path (hardware encoder, 10–30× faster) behind a feature test, falling back to
ffmpeg.wasm for anything it cannot demux. That is a contained addition — the
engine already sits behind `renderVideo()` — but it brings its own edge cases
around rotation metadata, B-frame timestamps and AAC passthrough, which is why
it is not in this version.

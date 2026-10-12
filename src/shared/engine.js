/* Author: Barzil Bruton.
 * Loads and owns the ffmpeg.wasm instance used for every video export.
 *
 * ffmpeg.wasm runs in a worker. The multi-threaded core needs
 * SharedArrayBuffer, which only exists when the page is served cross-origin
 * isolated (see _headers). Without isolation the single-threaded core is used:
 * same output, slower.
 *
 * ffmpeg.js is served from this origin on purpose. It spawns its own worker
 * from a sibling file (814.ffmpeg.js), and a Worker cannot be created from
 * another origin, so loading it from a CDN fails with a SecurityError. Only the
 * 32 MB core comes from the CDN, fetched with fetch() and turned into a blob
 * URL, which is allowed. build.mjs checks the FF_MAIN line below. */

import { toast } from "./dom.js";
import { isBusy, setJob, workPct, workNote } from "./progress.js";
import { withTimeout } from "./util.js";

const FF_MAIN = "vendor/ffmpeg/ffmpeg.js";
const FF_CORE = (mt) => `https://cdn.jsdelivr.net/npm/@ffmpeg/${mt ? "core-mt" : "core"}@0.12.10/dist/umd/`;

let ff = null;
let ffLoading = null;
let ffMT = false;

export const isMultiThreaded = () => ffMT;

function loadScript(src) {
  return new Promise((res, rej) => {
    const el = document.createElement("script");
    el.crossOrigin = "anonymous";
    el.onload = () => res();
    el.onerror = () => rej(new Error("script failed"));
    el.src = src;
    document.head.appendChild(el);
  });
}

/* Fetches `url` into a blob URL. With `onBytes`, the body is streamed and the
   callback receives (received, total) as it arrives. */
async function blobURL(url, type, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("fetch failed");
  if (!onBytes || !r.body || !r.body.getReader) {
    return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
  }
  const total = Number(r.headers.get("content-length")) || 0;
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes(got, total);
  }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

/* Resolves with a loaded ffmpeg instance, loading it on first use. Concurrent
   callers share one load. The whole load is capped at 5 minutes and the loader
   script at 30 seconds, so a stalled CDN ends in an error rather than a
   spinner that never stops. */
export function ensureEngine() {
  if (ff) return Promise.resolve(ff);
  if (location.protocol === "file:") return Promise.reject(new Error("videos need a served page"));
  if (ffLoading) return ffLoading;
  ffLoading = withTimeout((async () => {
    if (!isBusy()) setJob("Getting the video tool ready…");
    if (!window.FFmpegWASM) await withTimeout(loadScript(FF_MAIN), 30000, "the video tool");
    const mt = !!self.crossOriginIsolated;
    const base = FF_CORE(mt);
    /* The core is about 32 MB and downloads once. The first time, it is the
       longest wait in the tool, so its progress is reported. */
    const onBytes = (got, total) => {
      const mb = (b) => (b / 1048576).toFixed(1);
      if (total) {
        workPct(got / total);
        workNote(`${mb(got)} MB of ${mb(total)} MB`);
        if (!isBusy()) setJob(`Getting the video tool ready · ${Math.round((got / total) * 100)}%`);
      } else {
        workNote(`${mb(got)} MB downloaded`);
      }
    };
    const opts = {
      coreURL: await blobURL(base + "ffmpeg-core.js", "text/javascript"),
      wasmURL: await blobURL(base + "ffmpeg-core.wasm", "application/wasm", onBytes)
    };
    workNote("");
    workPct(null);
    if (mt) opts.workerURL = await blobURL(base + "ffmpeg-core.worker.js", "text/javascript");
    const inst = new window.FFmpegWASM.FFmpeg();
    await inst.load(opts);
    ff = inst;
    ffMT = mt;
    if (!isBusy()) setJob("");
    return ff;
  })(), 300000, "the video tool");
  ffLoading.catch(() => { ffLoading = null; if (!isBusy()) setJob(""); });
  return ffLoading;
}

/* Terminates the worker. The next ensureEngine() call loads a fresh one. */
export function killEngine() {
  try { if (ff) ff.terminate(); } catch (e) {}
  ff = null;
  ffLoading = null;
}

/* Loads the engine and reports a plain-language toast on failure. Resolves to
   true when the engine is ready. */
export async function engineReady() {
  if (location.protocol === "file:") {
    toast("Videos need this page opened from a web address. Opened straight from a file on the computer, only pictures can be watermarked.");
    return false;
  }
  try {
    await ensureEngine();
    return true;
  } catch (e) {
    console.error("[watermark] the video engine failed to load:", e);
    toast("The video tool could not load. Check the internet connection, then reload the page.");
    return false;
  }
}

/* Author: Barzil Bruton.
 * Runs one ffmpeg.wasm encode to an H.264 MP4 with progress, a time cap and
 * an audio fallback. Both modes use it: the watermark mode for each video,
 * the Post maker for a post with a video panel. */

import { ensureEngine, killEngine } from "./engine.js";
import { withTimeout } from "./util.js";

/* Each encode attempt is capped. A worker that never posts back would
   otherwise hang the export indefinitely. */
export const ENCODE_TIMEOUT_MS = 4 * 60 * 1000;

/* Whether the source container can usually hand its audio to an MP4 as is. */
export function canCopyAudioFrom(file) {
  return /mp4|quicktime|m4v/i.test(file.type || "") || /\.(mp4|m4v|mov)$/i.test(file.name);
}

/* Name under which a source video is written into ffmpeg's file system. */
export function inputNameFor(file) {
  const m = /\.[a-z0-9]+$/i.exec(file.name);
  return "input" + (m ? m[0].toLowerCase() : ".mp4");
}

/* Writes `files` ({ name, data }) into the engine, runs ffmpeg with `args`
   (inputs, filter and maps, without the audio codec or output name) and
   returns the MP4 as a Blob.
   duration:      source length in seconds, used to turn log times into progress.
   canCopyAudio:  try copying the audio stream first, then re-encode to AAC.
   onProgress(f): called with a fraction that only ever moves forward.
   ticketRef:     the job ticket; after a cancel, the killed engine is left alone.
   tag:           log prefix, for example "[watermark] clip.mp4".
   timeoutMs:     cap for each encode attempt, ENCODE_TIMEOUT_MS by default. */
export async function encodeMp4({ files, args, duration, canCopyAudio, onProgress, ticketRef, tag, timeoutMs = ENCODE_TIMEOUT_MS }) {
  const engine = await ensureEngine();
  const dur = duration || 0;
  /* ffmpeg.wasm's own "progress" event is documented as accurate only when
     input and output lengths match. With a filter graph (always used here,
     for the overlay) that often fails and the event may never report a usable
     value. ffmpeg's own log lines ("time=00:00:04.83") are the reliable
     source, so the "log" event is parsed as well. Either source can be stale,
     so the bar only ever moves forward. */
  let bestFrac = 0;
  const report = (f) => {
    if (!isFinite(f) || f <= bestFrac) return;
    bestFrac = Math.min(1, f);
    onProgress(bestFrac);
  };
  const onProg = (e) => {
    const t = e && typeof e.time === "number" ? e.time / 1e6 : NaN;
    const f = dur && isFinite(t) && t > 0 ? t / dur
      : e && typeof e.progress === "number" ? e.progress : NaN;
    report(f);
  };
  const TIME_RE = /\btime=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/;
  const onLog = (e) => {
    if (!dur || !e || typeof e.message !== "string") return;
    const m = TIME_RE.exec(e.message);
    if (!m) return;
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]);
    report(secs / dur);
  };
  /* On timeout the worker is killed so it cannot affect the next attempt or
     the next file, and the audio-codec retry is skipped, because a stuck
     video filter is not fixed by a different audio codec. */
  const run = async (fullArgs) => {
    bestFrac = 0; // Each exec() is a fresh encode from t=0, including a retry.
    let code;
    try {
      code = await withTimeout(engine.exec(fullArgs), timeoutMs, "the video encode");
    } catch (e) {
      killEngine();
      throw e;
    }
    if (typeof code === "number" && code !== 0) throw new Error("ffmpeg exit " + code);
  };
  engine.on("progress", onProg);
  engine.on("log", onLog);
  try {
    for (const f of files) await engine.writeFile(f.name, f.data);
    let done = false;
    let timedOut = false;
    if (canCopyAudio) {
      try {
        await run([...args, "-c:a", "copy", "out.mp4"]);
        done = true;
      } catch (e) {
        if (ticketRef.cancelled) throw e;
        if (/timed out/.test(e.message || "")) timedOut = true;
        /* The fallback re-runs the whole encode, which roughly doubles the
           wait since video encoding is most of the cost, so it is logged. */
        console.warn(`${tag}: audio stream copy failed, re-encoding audio and running the full encode again`, e);
      }
    }
    if (!done && timedOut) throw new Error("the video encode timed out");
    if (!done) await run([...args, "-c:a", "aac", "-b:a", "128k", "out.mp4"]);
    const data = await engine.readFile("out.mp4");
    const blob = new Blob([data], { type: "video/mp4" });
    if (!blob.size) throw new Error("empty output");
    return blob;
  } finally {
    if (!ticketRef.cancelled) {
      try { if (engine.off) engine.off("progress", onProg); } catch (e) {}
      try { if (engine.off) engine.off("log", onLog); } catch (e) {}
      for (const name of [...files.map((f) => f.name), "out.mp4"]) {
        try { await engine.deleteFile(name); } catch (e) {}
      }
    }
  }
}

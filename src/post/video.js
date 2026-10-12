/* Author: Barzil Bruton.
 * Exports a post that has a video panel. drawPost() paints everything except
 * the video into a PNG with a transparent rounded hole where the video goes.
 * ffmpeg scales and crops the video with the same numbers the preview uses,
 * places it on the post background and lays the PNG on top, so the PNG's
 * opaque corners round the video. */

import { BRAND } from "./brand.js";
import { drawPost, coverCrop } from "./render.js";
import { encodeMp4, canCopyAudioFrom, inputNameFor, ENCODE_TIMEOUT_MS } from "../shared/encode.js";

/* A post video is encoded at the full post size, which takes roughly two
   to five times the clip length here. The time cap therefore grows with the
   clip, so a long clip is not stopped while it is still making progress. */
const SECONDS_PER_CLIP_SECOND = 8;
const timeoutFor = (duration) => Math.max(ENCODE_TIMEOUT_MS, (duration || 0) * SECONDS_PER_CLIP_SECOND * 1000);

/* Filter graph for the video panel at rectangle r of a W x H post.
   1. The video is scaled to cover the panel at the panel's zoom
      (force_original_aspect_ratio=increase), the scale coverCrop() gives the
      preview, then cropped to the panel at the preview's offset. The offset
      is clamped in ffmpeg against the scaled size it actually produced.
   2. pad places it at the panel's position on a W x H frame filled with the
      post background. pad is used rather than a separate color source because
      it keeps the video's own frame rate and length; a color source runs at
      a fixed rate of its own, which the browser cannot read from the video.
   3. The chrome PNG is overlaid on top.
   All sizes and positions are even (see layouts.js), as libx264 requires. */
export function postVideoFilter(W, H, r, panel) {
  const zoom = Math.max(1, panel.crop.zoom || 1);
  const c = coverCrop(panel.w, panel.h, r.w, r.h, panel.crop);
  const tw = Math.round(r.w * zoom);
  const th = Math.round(r.h * zoom);
  const x = Math.max(0, Math.round(c.sx * c.s));
  const y = Math.max(0, Math.round(c.sy * c.s));
  const bg = "0x" + BRAND.bg.slice(1);
  return `[0:v]scale=${tw}:${th}:force_original_aspect_ratio=increase:flags=bicubic,` +
    `crop=${r.w}:${r.h}:'min(${x},iw-ow)':'min(${y},ih-oh)',setsar=1,` +
    `pad=${W}:${H}:${r.x}:${r.y}:color=${bg}[base];` +
    `[base][1:v]overlay=0:0:format=auto,format=yuv420p[v]`;
}

/* Renders the post as an MP4. `state.panels[index]` is the video panel; its
   `file`, `w`, `h`, `duration` and `crop` are read. The chrome and the filter
   are computed before the first await, so edits made while the encode runs
   do not change the file being made. Resolves to the MP4 Blob. */
export async function renderPostVideo({ W, H, state, opts, index, onProgress, ticketRef }) {
  const panel = state.panels[index];
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const info = drawPost(c.getContext("2d"), W, H, state, { ...opts, hole: index });
  const filter = postVideoFilter(W, H, info.layout.panels[index], panel);
  const png = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png")
  );
  c.width = 0;
  c.height = 0;
  const inName = inputNameFor(panel.file);
  return encodeMp4({
    files: [
      { name: inName, data: new Uint8Array(await panel.file.arrayBuffer()) },
      { name: "chrome.png", data: new Uint8Array(await png.arrayBuffer()) }
    ],
    args: ["-i", inName, "-i", "chrome.png", "-filter_complex", filter,
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-movflags", "+faststart"],
    duration: panel.duration,
    canCopyAudio: canCopyAudioFrom(panel.file),
    onProgress,
    ticketRef,
    tag: `[post] ${panel.name}`,
    timeoutMs: timeoutFor(panel.duration)
  });
}

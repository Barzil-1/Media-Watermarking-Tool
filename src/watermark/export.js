/* Author: Barzil Bruton.
 * Produces finished watermarked files: photos through a full-resolution
 * canvas, videos through ffmpeg.wasm with a watermark PNG overlaid. */

import { S } from "./settings.js";
import { getLines, ensureFont, STYLES, effectivePos, rotatedBBox, motionLane, drawWatermark } from "./render.js";
import { encodeMp4, canCopyAudioFrom, inputNameFor } from "../shared/encode.js";

export function outTypeFor(it) {
  if (it && it.kind === "video") return "video/mp4";
  if (S.format !== "original") return S.format;
  const ok = ["image/jpeg", "image/png", "image/webp"];
  return it && ok.includes(it.type) ? it.type : it ? "image/png" : "image/jpeg";
}
export function extFor(type) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4" }[type] || "png";
}
export function cleanSuffix() {
  return (S.suffix || "").replace(/[\\/:*?"<>|]/g, "");
}

async function renderFull(it) {
  await ensureFont();
  const c = document.createElement("canvas");
  c.width = it.w;
  c.height = it.h;
  const ctx = c.getContext("2d");
  const type = outTypeFor(it);
  if (type === "image/jpeg") { ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, it.w, it.h); }
  ctx.drawImage(it.img, 0, 0, it.w, it.h);
  drawWatermark(ctx, it.w, it.h, effectivePos(it));
  const blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), type, S.quality / 100)
  );
  c.width = 0; c.height = 0;
  const base = it.name.replace(/\.[^.]+$/, "");
  return { blob, name: `${base}${cleanSuffix()}.${extFor(blob.type || type)}` };
}

/* Output size for a video. H.264 requires even width and height. */
function targetDims(it) {
  const cap = S.videoMax === "original" ? 0 : parseInt(S.videoMax, 10);
  let w = it.w;
  let h = it.h;
  if (cap && Math.max(w, h) > cap) {
    const k = cap / Math.max(w, h);
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  return { w: Math.max(2, w - (w % 2)), h: Math.max(2, h - (h % 2)) };
}

/* A transparent PNG the size of the whole frame, painted by the same
   drawWatermark() the photos use, so video and photo output match. */
async function watermarkPNG(it, W, H) {
  await ensureFont();
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  drawWatermark(ctx, W, H, effectivePos(it));
  const blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png")
  );
  c.width = 0;
  c.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

/* For a moving watermark, ffmpeg slides a small sprite across the frame
   instead of compositing one fixed full-frame image. This renders only the
   watermark graphic, cropped to its rotated bounding box with no placement.
   drawWatermark() is not reused because it always positions onto a full
   frame; this mirrors only its drawing half. */
async function watermarkSpritePNG(it, W, H) {
  await ensureFont();
  const lines = getLines();
  const base = Math.min(W, H);
  const style = STYLES[S.style] || STYLES.badge;
  const probe = document.createElement("canvas").getContext("2d");
  const L = style.layout(probe, lines, base);
  const { bw, bh } = rotatedBBox(L.w, L.h, S.rotation);
  const pad = Math.ceil(base * 0.02) + 8;
  const cw = Math.max(2, Math.ceil(bw) + pad * 2);
  const ch = Math.max(2, Math.ceil(bh) + pad * 2);
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.globalAlpha = S.opacity / 100;
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((S.rotation * Math.PI) / 180);
  style.draw(ctx, L);
  ctx.restore();
  const blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png")
  );
  c.width = 0;
  c.height = 0;
  return { data: new Uint8Array(await blob.arrayBuffer()), w: cw, h: ch };
}

/* Filter graph for a moving watermark: the sprite slides across the frame
   and off both edges on a continuous loop for the whole video. The only value
   ffmpeg supplies at encode time is `t` (output timestamp). Sizes, lane and
   period are plain numbers computed here, so nothing depends on ffmpeg's own
   W, H or main_w variable names. The expressions are single-quoted, which lets
   the commas inside mod(...) stay unescaped: ffmpeg's filtergraph parser only
   treats , and : as separators outside quotes. */
function buildMotionFilter(W, H, sw, sh, dir, period, pos) {
  const lane = motionLane(pos);
  const laneX = Math.round(lane.cx * W - sw / 2);
  const laneY = Math.round(lane.cy * H - sh / 2);
  const p = Math.max(0.5, period);
  const prog = `mod(t,${p})/${p}`;
  let x, y;
  if (dir === "top-bottom" || dir === "bottom-top") {
    x = String(laneX);
    const span = H + sh * 2;
    y = dir === "top-bottom" ? `-${sh}+${span}*(${prog})` : `${H + sh}-${span}*(${prog})`;
  } else {
    y = String(laneY);
    const span = W + sw * 2;
    x = dir === "left-right" ? `-${sw}+${span}*(${prog})` : `${W + sw}-${span}*(${prog})`;
  }
  return `[0:v]scale=${W}:${H}:flags=bicubic[s];[s][1:v]overlay=x='${x}':y='${y}':format=auto,format=yuv420p[v]`;
}

async function renderVideo(it, onProgress, ticketRef) {
  const { w: W, h: H } = targetDims(it);
  const moving = S.motion !== "none" && S.style !== "tiled" && getLines().length > 0;
  const sprite = moving ? await watermarkSpritePNG(it, W, H) : null;
  const png = moving ? null : await watermarkPNG(it, W, H);
  const inName = inputNameFor(it.file);
  const filter = moving
    ? buildMotionFilter(W, H, sprite.w, sprite.h, S.motion, S.motionSpeed, effectivePos(it))
    : `[0:v]scale=${W}:${H}:flags=bicubic[s];[s][1:v]overlay=0:0:format=auto,format=yuv420p[v]`;
  const blob = await encodeMp4({
    files: [
      { name: inName, data: new Uint8Array(await it.file.arrayBuffer()) },
      { name: "wm.png", data: moving ? sprite.data : png }
    ],
    args: ["-i", inName, "-i", "wm.png", "-filter_complex", filter,
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-movflags", "+faststart"],
    duration: it.duration,
    canCopyAudio: canCopyAudioFrom(it.file),
    onProgress,
    ticketRef,
    tag: `[watermark] ${it.name}`
  });
  return { blob, name: `${it.name.replace(/\.[^.]+$/, "")}${cleanSuffix()}.mp4` };
}

export function failMessage(it, err) {
  if (it.kind === "video" && /timed out/.test((err && err.message) || "")) {
    return `${it.name} took too long to convert and was stopped. Try a shorter clip, a smaller resolution (see Video size), or turn off the moving watermark.`;
  }
  return it.kind === "video"
    ? `${it.name} could not be converted. It may use a video format the browser cannot read. Save it as an MP4 and try again.`
    : `${it.name} could not be saved. It may be too large for the browser.`;
}

export async function renderItem(it, onProgress, ticketRef) {
  return it.kind === "video" ? renderVideo(it, onProgress, ticketRef) : renderFull(it);
}

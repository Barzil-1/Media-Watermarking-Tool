/* Author: Barzil Bruton.
 * File-type detection, size limits, and helpers for working with a loaded
 * video element (seeking and frame thumbnails). */

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const VIDEO_RE = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|3g2|ogv|mpe?g|wmv|flv|ts)$/i;

/* Above the warning size a video still loads, with a notice that it will be
   slow. Above the maximum it is refused: the whole file has to fit in the
   ffmpeg worker's memory alongside the output. */
export const VIDEO_WARN_BYTES = 150 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 400 * 1024 * 1024;

export const BLANK_PX = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export const isVideoFile = (f) => (f.type || "").startsWith("video/") || VIDEO_RE.test(f.name);
export const isImageFile = (f) => (f.type || "").startsWith("image/") || IMAGE_RE.test(f.name);

export const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");

/* Seeks `item.video` to `t` (clamped to the clip) and records the time on
   `item.time`. Resolves on the "seeked" event, or after 4 seconds so a video
   that never reports a seek cannot stall the caller. */
export function seekTo(item, t) {
  const v = item.video;
  const last = item.duration ? Math.max(0, item.duration - 0.05) : 0;
  item.time = Math.max(0, Math.min(t, last));
  return new Promise((res) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeEventListener("seeked", finish);
      res();
    };
    const timer = setTimeout(finish, 4000);
    v.addEventListener("seeked", finish);
    try { v.currentTime = item.time; } catch (e) { finish(); }
    if (v.readyState >= 2 && Math.abs(v.currentTime - item.time) < 0.005) finish();
  });
}

/* Stores a 152px square cover-cropped JPEG of the current video frame on
   `item.thumb`, or an empty string if the frame cannot be drawn. */
export function grabThumb(item) {
  try {
    const c = document.createElement("canvas");
    c.width = 152;
    c.height = 152;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, 152, 152);
    const k = Math.max(152 / item.w, 152 / item.h);
    const dw = item.w * k;
    const dh = item.h * k;
    g.drawImage(item.video, (152 - dw) / 2, (152 - dh) / 2, dw, dh);
    item.thumb = c.toDataURL("image/jpeg", 0.72);
    c.width = 0;
    c.height = 0;
  } catch (e) {
    item.thumb = "";
  }
}

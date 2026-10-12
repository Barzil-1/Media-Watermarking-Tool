/* Author: Barzil Bruton.
 * Draws a post. drawPost() is the single drawing path: the live preview calls
 * it at the post's full pixel size under a canvas scale, and the export calls
 * it on a full-size canvas, so line breaks, font sizes and crops in the
 * preview are computed exactly as in the exported file. */

import { brandFont, drawLockup, fitLockupHeight, themeById } from "./brand.js";
import { headlineFontById, headlineFont } from "./fonts.js";
import { layoutFor } from "./layouts.js";
import { roundRectPath } from "../shared/canvas.js";
import { drawWatermark, effectivePos } from "../watermark/render.js";

/* ---------- Headline ---------- */

/* Font size bounds as fractions of the post's shorter side. */
const MAX_SIZE = 0.105;
const MIN_SIZE = 0.04;

/* Splits one line into runs, marking text between a pair of stars as amber.
   The stars themselves are removed. A star without a partner stays as text. */
function runsOf(line) {
  const out = [];
  const re = /\*([^*]+)\*/g;
  let i = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > i) out.push({ t: line.slice(i, m.index), amber: false });
    out.push({ t: m[1], amber: true });
    i = m.index + m[0].length;
  }
  if (i < line.length) out.push({ t: line.slice(i), amber: false });
  return out;
}

/* Turns runs into words. A word is a list of { t, amber } pieces, so a word
   can change color part way through (for example "*Thika*'s"). */
function wordsOf(runs) {
  const words = [];
  let cur = null;
  for (const r of runs) {
    for (const part of r.t.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { cur = null; continue; }
      if (!cur) { cur = []; words.push(cur); }
      cur.push({ t: part, amber: r.amber });
    }
  }
  return words;
}

/* The headline as paragraphs (one per typed line) of words. Leading and
   trailing blank lines are dropped; blank lines in between are kept. */
export function parseHeadline(text) {
  const lines = (text || "").replace(/\r/g, "").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((l) => wordsOf(runsOf(l)));
}

const wordWidth = (ctx, word) => word.reduce((a, p) => a + ctx.measureText(p.t).width, 0);

/* Greedy word wrap at the current ctx.font. Returns lines of words. */
function wrap(ctx, paragraphs, maxW) {
  const space = ctx.measureText(" ").width;
  const lines = [];
  let widest = 0;
  for (const words of paragraphs) {
    if (!words.length) { lines.push([]); continue; }
    let line = [];
    let w = 0;
    for (const word of words) {
      const ww = wordWidth(ctx, word);
      if (line.length && w + space + ww > maxW) {
        lines.push(line);
        widest = Math.max(widest, w);
        line = [];
        w = 0;
      }
      w += (line.length ? space : 0) + ww;
      line.push(word);
    }
    lines.push(line);
    widest = Math.max(widest, w);
  }
  return { lines, widest };
}

/* Largest whole-pixel size between the bounds at which the wrapped headline,
   set in `font` (see fonts.js), fits the rectangle. If it does not fit even
   at the minimum, returns the minimum with fits: false. */
export function fitHeadline(ctx, paragraphs, r, W, H, font) {
  const base = Math.min(W, H);
  const lo0 = Math.round(base * MIN_SIZE);
  const hi0 = Math.round(base * MAX_SIZE);
  const test = (px) => {
    ctx.font = headlineFont(font, px);
    const wr = wrap(ctx, paragraphs, r.w);
    const ok = wr.widest <= r.w && wr.lines.length * px * font.lineHeight <= r.h;
    return { ok, lines: wr.lines };
  };
  if (!paragraphs.length) return { px: hi0, lines: [], fits: true };
  let lo = lo0;
  let hi = hi0;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = test(mid);
    if (t.ok) { best = { px: mid, lines: t.lines }; lo = mid + 1; } else hi = mid - 1;
  }
  if (best) return { ...best, fits: true };
  return { px: lo0, lines: test(lo0).lines, fits: false };
}

/* Ends the last of `lines` with an ellipsis, dropping words from it until it
   fits `maxW`. Returns a new array; the input is not modified. */
function truncate(ctx, lines, maxW, space) {
  const out = lines.slice(0, -1);
  const last = lines[lines.length - 1].slice();
  const ell = ctx.measureText("\u2026").width;
  const width = (ws) => ws.reduce((a, w, i) => a + (i ? space : 0) + wordWidth(ctx, w), 0);
  while (last.length > 1 && width(last) + ell > maxW) last.pop();
  const tail = last.length ? last[last.length - 1] : [];
  const amber = tail.length ? tail[tail.length - 1].amber : false;
  if (last.length) last[last.length - 1] = [...tail, { t: "\u2026", amber }];
  else last.push([{ t: "\u2026", amber: false }]);
  out.push(last);
  return out;
}

function drawHeadline(ctx, text, r, W, H, font, pal) {
  const fit = fitHeadline(ctx, parseHeadline(text), r, W, H, font);
  if (!fit.lines.length) return fit;
  ctx.save();
  ctx.font = headlineFont(font, fit.px);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const cap = ctx.measureText("H").actualBoundingBoxAscent || fit.px * 0.7;
  const lh = fit.px * font.lineHeight;
  const space = ctx.measureText(" ").width;
  let lines = fit.lines;
  let top;
  if (fit.fits) {
    /* A fitting headline is centered in its box. */
    top = r.y + (r.h - ((lines.length - 1) * lh + cap)) / 2;
  } else {
    /* An overflowing headline is anchored to the top and cut after the last
       whole line that fits, ending in an ellipsis, so no line is drawn half
       clipped. The clip only matters for a single word wider than the box. */
    top = r.y;
    const descent = ctx.measureText("gjpqy").actualBoundingBoxDescent || fit.px * 0.25;
    const maxLines = Math.max(1, Math.floor((r.h - cap - descent) / lh) + 1);
    if (lines.length > maxLines) lines = truncate(ctx, lines.slice(0, maxLines), r.w, space);
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
  }
  lines.forEach((line, i) => {
    let x = r.x;
    const y = top + cap + i * lh;
    line.forEach((word, wi) => {
      if (wi) x += space;
      for (const p of word) {
        ctx.fillStyle = p.amber ? pal.accentText : pal.text;
        ctx.fillText(p.t, x, y);
        x += ctx.measureText(p.t).width;
      }
    });
  });
  ctx.restore();
  return fit;
}

/* ---------- Panels ---------- */

/* Smallest zoom for an iw x ih source in a w x h panel: the whole source
   visible. Zoom 1 is plain cover, where the source just fills the panel. */
export function minZoom(iw, ih, w, h) {
  return Math.min(w / iw, h / ih) / Math.max(w / iw, h / ih);
}

/* Places an iw x ih source in a w x h panel. `crop` holds zoom (1 is plain
   cover, below 1 zooms out down to minZoom) and cx, cy, the source point at
   the panel's center as fractions of the source. On an axis the source
   fills, the center is clamped so no gap shows. On an axis it does not fill
   (zoomed out), the whole source is shown, centered.
   Returns the source rectangle (sx, sy, sw, sh), where it lands inside the
   panel (dx, dy, dw, dh), the scale s and the clamped center. The video
   export uses the same numbers. */
export function coverCrop(iw, ih, w, h, crop) {
  const zoom = Math.max(minZoom(iw, ih, w, h), crop.zoom || 1);
  const s = Math.max(w / iw, h / ih) * zoom;
  const axis = (n, panel, c) => {
    const shown = panel / s;
    if (shown >= n) {
      const d = n * s;
      return { src: 0, span: n, dst: (panel - d) / 2, len: d, c: 0.5 };
    }
    const src = Math.min(Math.max(c * n - shown / 2, 0), n - shown);
    return { src, span: shown, dst: 0, len: panel, c: (src + shown / 2) / n };
  };
  const x = axis(iw, w, crop.cx);
  const y = axis(ih, h, crop.cy);
  return { s, sx: x.src, sy: y.src, sw: x.span, sh: y.span, dx: x.dst, dy: y.dst, dw: x.len, dh: y.len, cx: x.c, cy: y.c };
}

function drawPanel(ctx, r, panel, radius, border, hole, pal) {
  ctx.save();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  if (hole) {
    /* The video panel is left transparent so ffmpeg can lay the video
       underneath, on a frame filled with the panel color; the opaque
       surroundings give it rounded corners. */
    ctx.clip();
    ctx.clearRect(r.x, r.y, r.w, r.h);
  } else {
    ctx.fillStyle = pal.surface;
    ctx.fill();
    if (panel && panel.media) {
      ctx.clip();
      const c = coverCrop(panel.w, panel.h, r.w, r.h, panel.crop);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(panel.media, c.sx, c.sy, c.sw, c.sh, r.x + c.dx, r.y + c.dy, c.dw, c.dh);
    }
  }
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, r.x + border / 2, r.y + border / 2, r.w - border, r.h - border, Math.max(0, radius - border / 2));
  ctx.lineWidth = border;
  ctx.strokeStyle = pal.line;
  ctx.stroke();
  ctx.restore();
}

/* Shown in the preview when a post has nothing in it yet. Never exported. */
function drawPlaceholder(ctx, r, radius, pal) {
  ctx.save();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = pal.surface;
  ctx.fill();
  ctx.fillStyle = pal.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = brandFont(600, Math.round(Math.min(r.w, r.h) * 0.07));
  ctx.fillText("Add photos or a video", r.x + r.w / 2, r.y + r.h / 2);
  ctx.restore();
}

/* ---------- Footer ---------- */

function drawFooter(ctx, r, text, pal) {
  ctx.save();
  ctx.fillStyle = pal.accent;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (text) {
    let px = Math.round(r.h * 0.36);
    ctx.font = brandFont(700, px);
    const maxW = r.w * 0.9;
    const w = ctx.measureText(text).width;
    if (w > maxW) {
      px = Math.max(8, Math.floor((px * maxW) / w));
      ctx.font = brandFont(700, px);
    }
    ctx.fillStyle = pal.accentInk;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const cap = ctx.measureText("H").actualBoundingBoxAscent || px * 0.7;
    ctx.fillText(text, r.x + r.w / 2, r.y + (r.h + cap) / 2);
  }
  ctx.restore();
}

/* ---------- Post ---------- */

/* Paints the whole post onto ctx, in the post's own W x H pixel space.
   state: { headline, panels: [{ media, w, h, crop }] }, where media is an
          image or a video element (its current frame is drawn)
   opts:  { preset, theme, font, footerOn, footerText, watermark, placeholder, hole }
   theme is a palette id (see brand.js THEMES) and font a headline font id
   (see fonts.js). `hole` is the index of a panel to leave transparent (the
   video panel).
   Returns the layout used and whether the headline fit. Requires loadBrand()
   to have resolved, the headline font to be loaded (fonts.js
   ensureHeadlineFont), and the watermark font if watermark is set. */
export function drawPost(ctx, W, H, state, opts) {
  const panels = state.panels || [];
  const L = layoutFor(opts.preset, panels.length, !!opts.footerOn);
  const pal = themeById(opts.theme);
  ctx.save();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  drawLockup(ctx, L.logo.x, L.logo.y, fitLockupHeight(ctx, L.logo.w, L.logo.h), pal);
  const fit = drawHeadline(ctx, state.headline, L.headline, W, H, headlineFontById(opts.font), pal);

  if (!panels.length) {
    if (opts.placeholder) drawPlaceholder(ctx, L.panels[0], L.radius, pal);
  } else {
    panels.forEach((p, i) => drawPanel(ctx, L.panels[i], p, L.radius, L.border, opts.hole === i, pal));
  }

  if (L.footer) drawFooter(ctx, L.footer, (opts.footerText || "").trim(), pal);
  if (opts.watermark) drawWatermark(ctx, W, H, effectivePos(null));
  ctx.restore();
  return { layout: L, headlineFits: fit.fits };
}

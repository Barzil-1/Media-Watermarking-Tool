/* Author: Barzil Bruton.
 * Draws the watermark. drawWatermark() paints onto any canvas at any size,
 * with every dimension relative to min(W, H), so the preview, a full-size
 * photo export and the overlay PNG for a video all come from this one
 * function and match exactly. */

import { S } from "./settings.js";
import { roundRectPath } from "../shared/canvas.js";

const FONTS = {
  Oswald: '"Oswald", "Arial Narrow", sans-serif',
  Bebas: '"Bebas Neue", "Arial Narrow", sans-serif',
  RobotoCondensed: '"Roboto Condensed", "Arial Narrow", sans-serif',
  Montserrat: '"Montserrat", Arial, sans-serif',
  Archivo: '"Archivo", Arial, sans-serif',
  Slab: '"Roboto Slab", Georgia, serif',
  Arial: 'Arial, Helvetica, sans-serif'
};

export const ANCHORS = [
  ["tl", "Top left"], ["tc", "Top center"], ["tr", "Top right"],
  ["ml", "Middle left"], ["mc", "Center"], ["mr", "Middle right"],
  ["bl", "Bottom left"], ["bc", "Bottom center"], ["br", "Bottom right"]
];

/* ---------- Text ---------- */
export function getLines() {
  return S.text.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => (S.uppercase ? l.toUpperCase() : l));
}
function fontStr(px) {
  const weight = S.bold && S.font !== "Bebas" ? 700 : 400;
  return `${weight} ${px}px ${FONTS[S.font] || FONTS.Arial}`;
}
/* Resolves once the selected font is loaded for the current text, so a canvas
   draw never falls back to a substitute face. */
export function ensureFont() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const sample = getLines().join(" ") || "A";
  return document.fonts.load(fontStr(48), sample).catch(() => {});
}
function fitText(ctx, lines, maxW, maxH) {
  ctx.font = fontStr(100);
  const w100 = lines.map((l) => ctx.measureText(l).width);
  const mw = Math.max(1, ...w100);
  const fs = Math.max(1, Math.min((maxW * 100) / mw, maxH / (lines.length * S.lineHeight)));
  return { fs, w100, textW: (mw * fs) / 100, textH: lines.length * fs * S.lineHeight };
}
function textBlock(ctx, lines, fs, ox, oy, mode) {
  ctx.font = fontStr(fs);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const cap = ctx.measureText("H").actualBoundingBoxAscent || fs * 0.7;
  const lh = fs * S.lineHeight;
  const n = lines.length;
  for (let i = 0; i < n; i++) {
    const yb = oy + (i - (n - 1) / 2) * lh + cap / 2;
    if (mode === "stroke") ctx.strokeText(lines[i], ox, yb);
    else ctx.fillText(lines[i], ox, yb);
  }
}
function shadowOn(ctx, blur) {
  if (!S.shadow) return;
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = blur * 0.25;
}
function shadowOff(ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/* ---------- Styles ----------
   Each style provides layout() returning {w, h, ...} and draw() painting
   centered on (0, 0). Full-frame styles set fullFrame and provide drawFull(). */
export const STYLES = {
  badge: {
    bgName: "Badge color", outlineName: "Border ring",
    layout(ctx, lines, base) {
      const D = (base * S.size) / 100;
      const r = D / 2;
      const f = fitText(ctx, lines, D * 0.82, D * 0.64);
      let fs = f.fs;
      for (let k = 0; k < 40; k++) {
        const lh = fs * S.lineHeight;
        const total = lines.length * lh;
        let fits = true;
        for (let i = 0; i < lines.length; i++) {
          const top = -total / 2 + i * lh + lh * 0.18;
          const bottom = -total / 2 + (i + 1) * lh - lh * 0.18;
          const edge = Math.min(r * 0.98, Math.max(Math.abs(top), Math.abs(bottom)));
          const chord = 2 * Math.sqrt(r * r - edge * edge) * 0.86;
          if ((f.w100[i] * fs) / 100 > chord) { fits = false; break; }
        }
        if (fits) break;
        fs *= 0.95;
      }
      return { w: D, h: D, D, fs, lines };
    },
    draw(ctx, L) {
      const r = L.D / 2;
      shadowOn(ctx, r * 0.12);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = S.bgColor;
      ctx.fill();
      shadowOff(ctx);
      if (S.outline) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
        ctx.lineWidth = r * 0.025;
        ctx.strokeStyle = S.textColor;
        ctx.stroke();
      }
      ctx.fillStyle = S.textColor;
      textBlock(ctx, L.lines, L.fs, 0, 0, "fill");
    }
  },

  plain: {
    bgName: "Outline color", outlineName: "Outline",
    layout(ctx, lines, base) {
      const W = (base * S.size) / 100;
      const f = fitText(ctx, lines, W, W * 0.8);
      return { w: f.textW, h: f.textH, fs: f.fs, lines };
    },
    draw(ctx, L) {
      ctx.lineJoin = "round";
      shadowOn(ctx, L.fs * 0.12);
      if (S.outline) {
        ctx.strokeStyle = S.bgColor;
        ctx.lineWidth = L.fs * 0.14;
        textBlock(ctx, L.lines, L.fs, 0, 0, "stroke");
        shadowOff(ctx);
      }
      ctx.fillStyle = S.textColor;
      textBlock(ctx, L.lines, L.fs, 0, 0, "fill");
      shadowOff(ctx);
    }
  },

  label: {
    bgName: "Label color", outlineName: "Border",
    layout(ctx, lines, base) {
      const W = (base * S.size) / 100;
      const f = fitText(ctx, lines, W * 0.82, W * 0.6);
      const padX = f.fs * 0.7;
      const padY = f.fs * 0.45;
      return { w: f.textW + padX * 2, h: f.textH + padY * 2, fs: f.fs, lines };
    },
    draw(ctx, L) {
      const radius = L.lines.length === 1 ? L.h / 2 : Math.min(L.h / 2, L.fs * 0.9);
      shadowOn(ctx, L.fs * 0.3);
      roundRectPath(ctx, -L.w / 2, -L.h / 2, L.w, L.h, radius);
      ctx.fillStyle = S.bgColor;
      ctx.fill();
      shadowOff(ctx);
      if (S.outline) {
        const lw = L.fs * 0.08;
        roundRectPath(ctx, -L.w / 2 + lw * 2, -L.h / 2 + lw * 2, L.w - lw * 4, L.h - lw * 4, Math.max(0, radius - lw * 2));
        ctx.lineWidth = lw;
        ctx.strokeStyle = S.textColor;
        ctx.stroke();
      }
      ctx.fillStyle = S.textColor;
      textBlock(ctx, L.lines, L.fs, 0, 0, "fill");
    }
  },

  tiled: {
    bgName: "Outline color", outlineName: "Outline", fullFrame: true,
    drawFull(ctx, lines, base, W, H) {
      const Wt = (base * S.size) / 100;
      const f = fitText(ctx, lines, Wt, Wt * 0.6);
      const stepX = f.textW * (1.35 + S.gap / 100);
      const stepY = f.textH * (1.6 + S.gap / 100);
      const R = Math.hypot(W, H) / 2 + Math.max(stepX, stepY);
      ctx.translate(W / 2, H / 2);
      ctx.rotate((S.rotation * Math.PI) / 180);
      ctx.lineJoin = "round";
      let row = 0;
      for (let y = -R; y <= R; y += stepY, row++) {
        const off = row % 2 ? stepX / 2 : 0;
        for (let x = -R - off; x <= R + stepX; x += stepX) {
          if (S.outline) {
            ctx.strokeStyle = S.bgColor;
            ctx.lineWidth = f.fs * 0.14;
            textBlock(ctx, lines, f.fs, x, y, "stroke");
          }
          shadowOn(ctx, f.fs * 0.1);
          ctx.fillStyle = S.textColor;
          textBlock(ctx, lines, f.fs, x, y, "fill");
          shadowOff(ctx);
        }
      }
    }
  }
};

/* ---------- Placement ---------- */
/* The position used for `item`: its own when per-file positioning is on and
   it has one, otherwise the shared position. */
export function effectivePos(item) {
  if (S.perImage && item && item.pos) return item.pos;
  return { anchor: S.anchor, cx: S.cx, cy: S.cy };
}
export function rotatedBBox(w, h, rotationDeg) {
  const a = (rotationDeg * Math.PI) / 180;
  return {
    bw: Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)),
    bh: Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))
  };
}
function placement(w, h, W, H, base, pos) {
  if (pos.anchor === "custom") return { x: pos.cx * W, y: pos.cy * H };
  const { bw, bh } = rotatedBBox(w, h, S.rotation);
  const m = (base * S.margin) / 100;
  const x = { l: m + bw / 2, c: W / 2, r: W - m - bw / 2 }[pos.anchor[1]];
  const y = { t: m + bh / 2, m: H / 2, b: H - m - bh / 2 }[pos.anchor[0]];
  return { x, y };
}

/* ---------- Moving watermark (video only) ----------
   Size, rotation and styling stay fixed; only the position changes over time.
   One axis sweeps edge to edge, fully off both sides, on a continuous loop.
   The other axis is fixed: taken from a dragged custom position if there is
   one, otherwise centered. The same formula drives the live preview here and
   the exported video (as an ffmpeg expression in export.js
   buildMotionFilter), so the scrubbed preview matches the encoded output. */
export function motionLane(pos) {
  return pos && pos.anchor === "custom" ? pos : { cx: 0.5, cy: 0.5 };
}
function motionProgress(t, period) {
  const p = period > 0 ? period : 1;
  return (((t % p) + p) % p) / p;
}
function motionXY(dir, t, W, H, w, h, pos) {
  const { bw, bh } = rotatedBBox(w, h, S.rotation);
  const lane = motionLane(pos);
  const prog = motionProgress(t, S.motionSpeed);
  if (dir === "top-bottom" || dir === "bottom-top") {
    const span = H + bh * 2;
    const y = dir === "top-bottom" ? -bh / 2 + span * prog : H + bh / 2 - span * prog;
    return { x: lane.cx * W, y };
  }
  const span = W + bw * 2;
  const x = dir === "left-right" ? -bw / 2 + span * prog : W + bw / 2 - span * prog;
  return { x, y: lane.cy * H };
}

/* Paints the watermark onto `ctx` for a W x H frame. When `t` is given and a
   motion direction is set, the position follows the motion path at time `t`
   (seconds); otherwise it uses the anchor or custom position `pos`. */
export function drawWatermark(ctx, W, H, pos, t) {
  const lines = getLines();
  if (!lines.length) return;
  const base = Math.min(W, H);
  const style = STYLES[S.style] || STYLES.badge;
  ctx.save();
  ctx.globalAlpha = S.opacity / 100;
  if (style.fullFrame) {
    style.drawFull(ctx, lines, base, W, H);
  } else {
    const L = style.layout(ctx, lines, base);
    const p = t != null && S.motion !== "none"
      ? motionXY(S.motion, t, W, H, L.w, L.h, pos)
      : placement(L.w, L.h, W, H, base, pos);
    ctx.translate(p.x, p.y);
    ctx.rotate((S.rotation * Math.PI) / 180);
    style.draw(ctx, L);
  }
  ctx.restore();
}

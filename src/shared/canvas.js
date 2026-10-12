/* Author: Barzil Bruton.
 * Canvas drawing helpers shared by the rendering code of every mode. */

/* Builds a rounded-rectangle path. The radius is clamped to half the shorter
   side so small boxes stay valid. The caller fills or strokes it. */
export function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

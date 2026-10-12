/* Author: Barzil Bruton.
 * Thika Superhighway brand: color tokens, the Urbanist font, the amber mark,
 * and the logo lockup used on every post.
 *
 * The lockup matches the site header: the mark, then a two-line wordmark,
 * "Thika" in weight 800 with -0.02em tracking above "SUPERHIGHWAY" in weight
 * 600 with 0.18em tracking, muted, about a third of the size.
 *
 * loadBrand() must resolve before anything is measured or drawn, so the first
 * render and every export use Urbanist and never a fallback face. */

/* Dark "night highway" palette: asphalt surfaces and one amber accent. */
export const BRAND = {
  bg: "#0b0c0f",
  surface: "#14161b",
  surface2: "#1c1f26",
  line: "#2b3039",
  text: "#f3f4f6",
  muted: "#a6acb8",
  accent: "#ffb81c",
  accentInk: "#14110a"
};

export const FONT_FAMILY = "Urbanist";

/* The mark's source is 240px tall. Lockups are kept at or below this height so
   the mark is never upscaled. */
export const MARK_SOURCE_HEIGHT = 240;

const asset = (p) => new URL(`../../assets/thika/${p}`, import.meta.url).href;

/* Unicode ranges match the subsets the font files were cut to, so the browser
   only downloads latin-ext when the text needs it. */
const FONT_FACES = [
  {
    file: "fonts/urbanist-latin-wght-normal.woff2",
    unicodeRange: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"
  },
  {
    file: "fonts/urbanist-latin-ext-wght-normal.woff2",
    unicodeRange: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF"
  }
];

export function brandFont(weight, px) {
  return `${weight} ${px}px "${FONT_FAMILY}", system-ui, sans-serif`;
}

let loading = null;
let mark = null;

/* Registers the Urbanist faces and decodes the mark. Safe to call repeatedly;
   every call shares one load. Resolves once the weights the lockup uses are
   ready. */
export function loadBrand() {
  if (loading) return loading;
  loading = (async () => {
    for (const f of FONT_FACES) {
      const face = new FontFace(FONT_FAMILY, `url("${asset(f.file)}") format("woff2")`, {
        weight: "100 900",
        style: "normal",
        unicodeRange: f.unicodeRange
      });
      document.fonts.add(face);
    }
    const img = new Image();
    img.src = asset("mark.png");
    await Promise.all([
      img.decode(),
      document.fonts.load(brandFont(800, 64), "Thika"),
      document.fonts.load(brandFont(600, 64), "SUPERHIGHWAY")
    ]);
    mark = img;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

/* Resolves once Urbanist at `weight` is loaded for every character in `text`,
   including latin-ext characters. Call before measuring arbitrary text. */
export async function ensureBrandText(weight, text) {
  await loadBrand();
  await document.fonts.load(brandFont(weight, 64), text || "A");
}

/* ---------- Tracked text ----------
   Width of `text` at the current ctx.font with `tracking` px added between
   characters. The trailing space after the last character is not counted, so
   left-, right- and center-aligned placement all use the visible extent. */
function trackedWidth(ctx, text, tracking) {
  const base = ctx.measureText(text).width;
  return base + tracking * Math.max(0, [...text].length - 1);
}

/* Draws `text` left-aligned at (x, baseline y) with `tracking` px between
   characters. Uses canvas letterSpacing where supported (keeps kerning) and
   places characters one at a time elsewhere. */
function fillTracked(ctx, text, x, y, tracking) {
  ctx.textAlign = "left";
  if ("letterSpacing" in ctx) {
    const prev = ctx.letterSpacing;
    ctx.letterSpacing = `${tracking}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = prev;
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
}

/* ---------- Lockup ----------
   All proportions are fractions of the lockup height H, which is the mark's
   drawn height. */
const L = {
  gap: 0.16,        // mark to wordmark
  thikaSize: 0.58,  // font size of "Thika"
  subRatio: 1 / 3,  // "SUPERHIGHWAY" size relative to "Thika"
  lineGap: 0.1,     // between the two wordmark lines
  thikaTrack: -0.02,
  subTrack: 0.18
};

/* Measures the lockup at height H. Returns its width and height and the
   positions draw needs. Requires loadBrand() to have resolved. */
export function measureLockup(ctx, H) {
  const markW = (H * mark.naturalWidth) / mark.naturalHeight;
  const thikaPx = H * L.thikaSize;
  const subPx = thikaPx * L.subRatio;
  ctx.save();
  ctx.font = brandFont(800, thikaPx);
  const thikaAsc = ctx.measureText("Thika").actualBoundingBoxAscent;
  const thikaW = trackedWidth(ctx, "Thika", L.thikaTrack * thikaPx);
  ctx.font = brandFont(600, subPx);
  const subAsc = ctx.measureText("SUPERHIGHWAY").actualBoundingBoxAscent;
  const subW = trackedWidth(ctx, "SUPERHIGHWAY", L.subTrack * subPx);
  ctx.restore();
  const textX = markW + H * L.gap;
  const block = thikaAsc + H * L.lineGap + subAsc;
  const top = (H - block) / 2;
  return {
    w: textX + Math.max(thikaW, subW),
    h: H,
    markW, thikaPx, subPx, textX,
    thikaBaseline: top + thikaAsc,
    subBaseline: top + thikaAsc + H * L.lineGap + subAsc
  };
}

/* Draws the lockup with its top-left corner at (x, y) and height H. Requires
   loadBrand() to have resolved. Returns the measured box. */
export function drawLockup(ctx, x, y, H) {
  const m = measureLockup(ctx, H);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mark, x, y, m.markW, H);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = BRAND.text;
  ctx.font = brandFont(800, m.thikaPx);
  fillTracked(ctx, "Thika", x + m.textX, y + m.thikaBaseline, L.thikaTrack * m.thikaPx);
  ctx.fillStyle = BRAND.muted;
  ctx.font = brandFont(600, m.subPx);
  fillTracked(ctx, "SUPERHIGHWAY", x + m.textX, y + m.subBaseline, L.subTrack * m.subPx);
  ctx.restore();
  return m;
}

/* Largest lockup height that fits a w x h box, capped at the mark's source
   height so the mark is never upscaled. */
export function fitLockupHeight(ctx, w, h) {
  const probe = measureLockup(ctx, 100);
  return Math.min(MARK_SOURCE_HEIGHT, h, (w / probe.w) * 100);
}

/* Author: Barzil Bruton.
 * Post sizes and their layouts. Each preset's layout is a function of the
 * panel count (1 to 3) and whether the footer is shown, returning rectangles
 * in the post's own pixel space. Every coordinate and size is an even number,
 * because the video export (libx264, yuv420p) requires even dimensions. */

export const PRESETS = [
  { id: "portrait", label: "Portrait 4:5", W: 1080, H: 1350, platforms: "Instagram feed, Telegram, X" },
  { id: "square", label: "Square 1:1", W: 1080, H: 1080, platforms: "All platforms" },
  { id: "landscape", label: "Landscape 16:9", W: 1600, H: 900, platforms: "X timeline, Telegram" },
  { id: "story", label: "Story 9:16", W: 1080, H: 1920, platforms: "Telegram, Instagram, WhatsApp stories" }
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

const even = (v) => 2 * Math.round(v / 2);
const rect = (x, y, w, h) => ({ x: even(x), y: even(y), w: even(w), h: even(h) });

/* n equal rectangles side by side across (x, y, w, h), `gap` apart. The last
   one absorbs rounding so the row ends exactly at x + w. */
function row(n, x, y, w, h, gap) {
  const each = (w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => {
    const x0 = even(x + i * (each + gap));
    const x1 = i === n - 1 ? even(x + w) : even(x + i * (each + gap) + each);
    return { x: x0, y: even(y), w: x1 - x0, h: even(h) };
  });
}

/* n equal rectangles stacked down (x, y, w, h), `gap` apart. */
function column(n, x, y, w, h, gap) {
  const each = (h - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => {
    const y0 = even(y + i * (each + gap));
    const y1 = i === n - 1 ? even(y + h) : even(y + i * (each + gap) + each);
    return { x: even(x), y: y0, w: even(w), h: y1 - y0 };
  });
}

/* Shared styling scale: corner radius and border width grow with the post's
   shorter side, so every size looks like the same design. */
function chrome(W, H) {
  const k = Math.min(W, H) / 1080;
  return { radius: even(28 * k), border: Math.max(2, even(2 * k)) };
}

/* Footer: a full-width amber strip along the bottom edge on every preset. */
const footerRect = (W, H, fh) => rect(0, H - fh, W, fh);

const LAYOUTS = {
  /* Logo top-left, headline across the top, panels in a row, footer strip. */
  portrait(n, footer) {
    const W = 1080, H = 1350, m = 56;
    const fh = 96;
    const panelsTop = 584;
    const panelsBottom = footer ? H - fh - 36 : H - m;
    return {
      W, H, ...chrome(W, H),
      logo: rect(m, m, W - 2 * m, 92),
      headline: rect(m, 176, W - 2 * m, 372),
      panels: row(n, m, panelsTop, W - 2 * m, panelsBottom - panelsTop, 16),
      footer: footer ? footerRect(W, H, fh) : null
    };
  },

  square(n, footer) {
    const W = 1080, H = 1080, m = 48;
    const fh = 88;
    const panelsTop = 488;
    const panelsBottom = footer ? H - fh - 32 : H - m;
    return {
      W, H, ...chrome(W, H),
      logo: rect(m, m, W - 2 * m, 84),
      headline: rect(m, 156, W - 2 * m, 300),
      panels: row(n, m, panelsTop, W - 2 * m, panelsBottom - panelsTop, 16),
      footer: footer ? footerRect(W, H, fh) : null
    };
  },

  /* Logo and headline in a left column, panels in a row on the right. */
  landscape(n, footer) {
    const W = 1600, H = 900, m = 56;
    const fh = 84;
    const colW = 560;
    const bottom = footer ? H - fh - 40 : H - m;
    const panelsX = m + colW + 48;
    return {
      W, H, ...chrome(W, H),
      logo: rect(m, m, colW, 92),
      headline: rect(m, 176, colW, bottom - 176),
      panels: row(n, panelsX, m, W - m - panelsX, bottom - m, 16),
      footer: footer ? footerRect(W, H, fh) : null
    };
  },

  /* Headline at the top, panels stacked vertically, footer strip. */
  story(n, footer) {
    const W = 1080, H = 1920, m = 64;
    const fh = 112;
    const panelsTop = 676;
    const panelsBottom = footer ? H - fh - 44 : H - m;
    return {
      W, H, ...chrome(W, H),
      logo: rect(m, m, W - 2 * m, 100),
      headline: rect(m, 196, W - 2 * m, 440),
      panels: column(n, m, panelsTop, W - 2 * m, panelsBottom - panelsTop, 20),
      footer: footer ? footerRect(W, H, fh) : null
    };
  }
};

/* Rectangles for `presetId` with `count` panels (clamped to 1..3). */
export function layoutFor(presetId, count, footer) {
  const n = Math.max(1, Math.min(3, count));
  return (LAYOUTS[presetId] || LAYOUTS.portrait)(n, footer);
}

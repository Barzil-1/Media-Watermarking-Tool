/* Author: Barzil Bruton.
 * Headline typefaces a post can use. Urbanist is the brand face and the
 * default. The others are already loaded by the page for the watermark mode,
 * so offering them adds no new download. */

import { FONT_FAMILY, ensureBrandText } from "./brand.js";

export const HEADLINE_FONTS = [
  { id: "urbanist", label: "Urbanist (brand)", family: `"${FONT_FAMILY}", system-ui, sans-serif`, weight: 800, lineHeight: 1.06 },
  { id: "montserrat", label: "Montserrat (wide)", family: '"Montserrat", Arial, sans-serif', weight: 800, lineHeight: 1.08 },
  { id: "oswald", label: "Oswald (condensed)", family: '"Oswald", "Arial Narrow", sans-serif', weight: 700, lineHeight: 1.1 },
  { id: "bebas", label: "Bebas Neue (tall capitals)", family: '"Bebas Neue", "Arial Narrow", sans-serif', weight: 400, lineHeight: 1.0 },
  { id: "slab", label: "Roboto Slab (serif)", family: '"Roboto Slab", Georgia, serif', weight: 700, lineHeight: 1.12 }
];

export const headlineFontById = (id) => HEADLINE_FONTS.find((f) => f.id === id) || HEADLINE_FONTS[0];

export const headlineFont = (f, px) => `${f.weight} ${px}px ${f.family}`;

/* Resolves once the headline face is loaded for every character in `text`,
   so measuring and drawing never use a fallback face. */
export async function ensureHeadlineFont(id, text) {
  const f = headlineFontById(id);
  if (f.id === "urbanist") return ensureBrandText(f.weight, text);
  if (!document.fonts || !document.fonts.load) return;
  await document.fonts.load(headlineFont(f, 64), text || "A").catch(() => {});
}

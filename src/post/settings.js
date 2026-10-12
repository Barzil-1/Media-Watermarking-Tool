/* Author: Barzil Bruton.
 * Post maker settings that persist between visits, under their own
 * localStorage key, separate from the watermark settings. The headline,
 * photos and crops are per-session state and live in index.js. */

import { loadSaved, makeSaver } from "../shared/storage.js";

export const POST_DEFAULTS = {
  preset: "portrait",
  theme: "dark",
  font: "urbanist",
  footerOn: true,
  footerText: "thikasuperhighwayvip.com",
  format: "image/jpeg",
  watermark: false
};

const POST_KEY = "thikaPost.settings.v1";

/* Mutated in place, never replaced; holds only POST_DEFAULTS keys. */
export const P = { ...POST_DEFAULTS, ...loadSaved(POST_KEY, POST_DEFAULTS) };

export const persistPost = makeSaver(POST_KEY, () => P);

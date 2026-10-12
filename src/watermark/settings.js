/* Author: Barzil Bruton.
 * Watermark-mode settings: defaults, the live settings object, and its
 * persistence under its own localStorage key. */

import { loadSaved, makeSaver } from "../shared/storage.js";

export const DEFAULTS = {
  text: "TELEGRAM\n@YOURCHANNEL\nNEWS",
  uppercase: true,
  bold: true,
  style: "badge",
  font: "Oswald",
  textColor: "#1B1B1B",
  bgColor: "#E6E6E6",
  shadow: true,
  outline: false,
  lineHeight: 1.1,
  size: 30,
  opacity: 92,
  rotation: 0,
  gap: 60,
  anchor: "mc",
  cx: 0.5,
  cy: 0.5,
  margin: 4,
  perImage: false,
  format: "original",
  quality: 92,
  videoMax: "original",
  motion: "none",
  motionSpeed: 6,
  suffix: "_wm"
};

const SETTINGS_KEY = "batchWatermark.settings.v1";

/* The single settings object for this mode. It is mutated in place and never
   replaced, so every module that imports it sees current values. It only ever
   holds DEFAULTS keys. */
export const S = { ...DEFAULTS, ...loadSaved(SETTINGS_KEY, DEFAULTS) };

export const persistSettings = makeSaver(SETTINGS_KEY, () => S);

export function resetSettings() {
  Object.assign(S, DEFAULTS);
}

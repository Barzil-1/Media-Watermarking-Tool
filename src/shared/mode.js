/* Author: Barzil Bruton.
 * The active mode ("watermark" or "post"). Shared handlers such as file drop
 * and keyboard shortcuts read it to act only for the mode on screen. */

let mode = "watermark";
const listeners = [];

export const getMode = () => mode;

export function onModeChange(fn) {
  listeners.push(fn);
}

export function setMode(next) {
  if (next === mode) return;
  mode = next;
  listeners.forEach((fn) => fn(mode));
}

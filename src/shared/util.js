/* Author: Barzil Bruton.
 * Small helpers with no DOM or app-state dependencies. */

/* Rejects with "<what> timed out" if `p` has not settled within `ms`. Used
   wherever a stalled network request or worker would otherwise leave the UI
   waiting indefinitely. */
export function withTimeout(p, ms, what) {
  let timer;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(what + " timed out")), ms); })
  ]);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.round(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function fmtMB(bytes) {
  return `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`;
}

/* Local date and time as YYYYMMDD-HHMM, for download file names. */
export function stamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/* Local date and time as YYYYMMDD-HHMMSS, for file names that must not repeat
   within a minute. */
export function stampSeconds() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

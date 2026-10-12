/* Author: Barzil Bruton.
 * Settings persistence in localStorage. Values stay in this browser and are
 * never sent anywhere. Every storage access is wrapped in try/catch because
 * storage can be unavailable (private browsing, blocked site data). */

/* Returns the saved values for the keys present in `defaults`, and nothing
   else. An older or corrupted blob therefore cannot inject unexpected keys,
   and a setting removed in a later version is simply ignored. */
export function loadSaved(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return {};
    const clean = {};
    for (const k of Object.keys(defaults)) if (k in saved) clean[k] = saved[k];
    return clean;
  } catch (e) {
    return {};
  }
}

/* Returns a debounced save function. `read` is called when the write fires,
   so the stored value is always the latest one. */
export function makeSaver(key, read, delay = 300) {
  let timer = 0;
  return function persist() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(read())); } catch (e) {}
    }, delay);
  };
}

/* Author: Barzil Bruton.
 * Post maker mode: photo panels with crop, headline, footer and export.
 * Drawing lives in render.js, layouts in layouts.js. */

import { $, toast } from "../shared/dom.js";
import { stampSeconds } from "../shared/util.js";
import { isImageFile, isVideoFile } from "../shared/media.js";
import { isBusy, onBusyChange, newTicket, setBusy, startWork, workItem } from "../shared/progress.js";
import { saveBlob } from "../shared/save.js";
import { loadBrand, ensureBrandText } from "./brand.js";
import { PRESETS, presetById, layoutFor } from "./layouts.js";
import { drawPost, coverCrop } from "./render.js";
import { P, persistPost } from "./settings.js";
import { ensureFont as ensureWatermarkFont } from "../watermark/render.js";

const MAX_PANELS = 3;
const MAX_ZOOM = 4;
const PREVIEW_MAX = 1600;

/* ---------- State ----------
   Each panel: { id, file, name, url, img, w, h, crop: { zoom, cx, cy } }.
   crop is normalized (see render.js coverCrop), so it survives a change of
   preset or panel count. */
const panels = [];
let selected = -1;
let headline = "";
let nextId = 1;
let brandReady = false;
let lastLayout = null;

const preview = $("#postPreview");
const pctx = preview.getContext("2d");
const els = {
  fileInput: $("#postFileInput"), add: $("#postAddBtn"), exportBtn: $("#postExport"),
  count: $("#postCount"), meta: $("#postMeta"), strip: $("#postStrip"), clear: $("#postClear"),
  preset: $("#postPreset"), presetHint: $("#postPresetHint"), headline: $("#postHeadline"),
  fitWarn: $("#postFitWarn"), zoomField: $("#postZoomField"), zoom: $("#postZoom"),
  zoomOut: $("#postZoomOut"), footerOn: $("#postFooterOn"), footerText: $("#postFooterText"),
  footerField: $("#postFooterField"), format: $("#postFormat"), watermark: $("#postWatermark")
};

const drawOpts = (placeholder) => ({
  preset: P.preset, footerOn: P.footerOn, footerText: P.footerText,
  watermark: P.watermark, placeholder
});

/* ---------- Preview ----------
   The preview canvas is the post scaled down, with drawPost() run in full
   post coordinates under a canvas transform. */
let rafId = 0;
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; renderPreview(); });
}

function renderPreview() {
  if (!brandReady) return;
  const { W, H } = presetById(P.preset);
  const k = Math.min(1, PREVIEW_MAX / Math.max(W, H));
  const cw = Math.round(W * k);
  const ch = Math.round(H * k);
  if (preview.width !== cw) preview.width = cw;
  if (preview.height !== ch) preview.height = ch;
  pctx.setTransform(k, 0, 0, k, 0, 0);
  const info = drawPost(pctx, W, H, { headline, panels }, drawOpts(true));
  lastLayout = info.layout;
  els.fitWarn.hidden = info.headlineFits;
  /* Selection outline, preview only. */
  if (panels.length > 1 && selected >= 0 && lastLayout.panels[selected]) {
    const r = lastLayout.panels[selected];
    pctx.save();
    pctx.lineWidth = Math.max(4, lastLayout.border * 2);
    pctx.strokeStyle = "#ffb81c";
    pctx.setLineDash([lastLayout.border * 6, lastLayout.border * 4]);
    pctx.strokeRect(r.x - pctx.lineWidth, r.y - pctx.lineWidth, r.w + pctx.lineWidth * 2, r.h + pctx.lineWidth * 2);
    pctx.restore();
  }
  pctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ---------- Files ---------- */
export function addFiles(list) {
  const all = [...list];
  const photos = all.filter((f) => isImageFile(f) && !isVideoFile(f));
  const videos = all.filter(isVideoFile).length;
  const room = MAX_PANELS - panels.length;
  if (!photos.length) {
    toast(videos ? "Only photos can go in a post for now." : "Nothing was added. Choose JPG, PNG or WebP photos.");
    return;
  }
  if (room <= 0) {
    toast("A post holds up to three photos. Remove one to add another.");
    return;
  }
  photos.slice(0, room).forEach(addPhoto);
  if (photos.length > room) toast(`A post holds up to three photos, so ${photos.length - room} ${photos.length - room === 1 ? "was" : "were"} not added.`);
  else if (videos) toast("Only photos can go in a post for now, so videos were not added.");
  refresh();
}

function addPhoto(file) {
  const p = { id: nextId++, file, name: file.name, url: URL.createObjectURL(file), img: null, w: 0, h: 0,
    crop: { zoom: 1, cx: 0.5, cy: 0.5 } };
  panels.push(p);
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    p.img = img;
    p.w = img.naturalWidth;
    p.h = img.naturalHeight;
    if (selected < 0) selected = panels.indexOf(p);
    refresh();
  };
  img.onerror = () => {
    removePanel(p.id, true);
    toast(`${file.name} could not be opened. Convert it to JPG or PNG and add it again.`);
  };
  img.src = p.url;
}

function removePanel(id, silent) {
  const i = panels.findIndex((p) => p.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(panels[i].url);
  panels.splice(i, 1);
  if (!panels.length) selected = -1;
  else if (selected >= panels.length) selected = panels.length - 1;
  else if (i < selected) selected--;
  refresh();
  if (!silent) toast("Photo removed.");
}

function movePanel(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= panels.length) return;
  [panels[i], panels[j]] = [panels[j], panels[i]];
  if (selected === i) selected = j;
  else if (selected === j) selected = i;
  refresh();
}

/* Panels that have finished loading. Only these are drawn or exported. */
const readyPanels = () => panels.filter((p) => p.img);

/* ---------- UI refresh ---------- */
function refresh() {
  renderStrip();
  updateBar();
  updateZoomUI();
  scheduleRender();
}

function renderStrip() {
  els.strip.textContent = "";
  panels.forEach((p, i) => {
    const wrap = document.createElement("div");
    wrap.className = "thumb post-thumb" + (i === selected ? " active" : "");
    wrap.setAttribute("role", "listitem");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb-btn";
    b.setAttribute("aria-label", `Select photo ${i + 1}, ${p.name}`);
    if (i === selected) b.setAttribute("aria-current", "true");
    const img = document.createElement("img");
    img.src = p.url; img.alt = ""; img.decoding = "async";
    b.appendChild(img);
    b.addEventListener("click", () => { selected = i; refresh(); });
    const x = document.createElement("button");
    x.type = "button";
    x.className = "thumb-x";
    x.textContent = "×";
    x.setAttribute("aria-label", `Remove ${p.name}`);
    x.addEventListener("click", () => removePanel(p.id));
    const num = document.createElement("span");
    num.className = "thumb-badge";
    num.textContent = String(i + 1);
    const moves = document.createElement("span");
    moves.className = "thumb-moves";
    for (const [dir, label, glyph] of [[-1, "earlier", "‹"], [1, "later", "›"]]) {
      const m = document.createElement("button");
      m.type = "button";
      m.className = "thumb-move";
      m.textContent = glyph;
      m.setAttribute("aria-label", `Move photo ${i + 1} ${label}`);
      m.disabled = dir < 0 ? i === 0 : i === panels.length - 1;
      m.addEventListener("click", () => movePanel(i, dir));
      moves.appendChild(m);
    }
    wrap.append(b, x, num, moves);
    els.strip.appendChild(wrap);
  });
}

function updateBar() {
  const n = readyPanels().length;
  els.count.textContent = n ? `${n} of ${MAX_PANELS} photos` : "No photos yet";
  els.exportBtn.disabled = isBusy() || n === 0;
  els.clear.disabled = isBusy() || panels.length === 0;
  els.add.disabled = panels.length >= MAX_PANELS;
  const pr = presetById(P.preset);
  els.meta.textContent = `${pr.label} · ${pr.W} × ${pr.H}`;
}

function updateZoomUI() {
  const p = panels[selected];
  els.zoomField.hidden = !(p && p.img);
  if (p) {
    els.zoom.value = String(p.crop.zoom);
    els.zoomOut.textContent = `${Math.round(p.crop.zoom * 100)}%`;
  }
}

function syncControls() {
  els.preset.value = P.preset;
  els.footerOn.checked = !!P.footerOn;
  els.footerText.value = P.footerText;
  els.format.value = P.format;
  els.watermark.checked = !!P.watermark;
  updatePresetHint();
  els.footerField.hidden = !P.footerOn;
}

function updatePresetHint() {
  const pr = presetById(P.preset);
  els.presetHint.textContent = `${pr.W} × ${pr.H} pixels, for ${pr.platforms}.`;
}

/* ---------- Crop interaction ---------- */
function clampCrop(p, r) {
  const c = coverCrop(p.w, p.h, r.w, r.h, p.crop);
  p.crop.cx = c.cx;
  p.crop.cy = c.cy;
}

function setZoom(i, z) {
  const p = panels[i];
  if (!p || !p.img || !lastLayout) return;
  p.crop.zoom = Math.min(MAX_ZOOM, Math.max(1, z));
  clampCrop(p, lastLayout.panels[i]);
  updateZoomUI();
  scheduleRender();
}

/* Moves the photo with the pointer: a drag of (dx, dy) post pixels shifts the
   visible window the opposite way in source space. */
function pan(i, dx, dy) {
  const p = panels[i];
  const r = lastLayout && lastLayout.panels[i];
  if (!p || !p.img || !r) return;
  clampCrop(p, r);
  const c = coverCrop(p.w, p.h, r.w, r.h, p.crop);
  p.crop.cx -= dx / (p.w * c.s);
  p.crop.cy -= dy / (p.h * c.s);
  clampCrop(p, r);
  scheduleRender();
}

/* Pointer position in post pixels. */
function toPost(e) {
  const r = preview.getBoundingClientRect();
  const { W, H } = presetById(P.preset);
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

function panelAt(pt) {
  if (!lastLayout) return -1;
  return lastLayout.panels.findIndex((r, i) => i < panels.length && pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h);
}

/* One pointer drags the photo under it. A second pointer on the same panel
   turns the gesture into a pinch zoom. */
const pointers = new Map();
let gesture = null;

function onPointerDown(e) {
  const pt = toPost(e);
  const i = panelAt(pt);
  if (i < 0 || !panels[i].img) return;
  preview.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, pt);
  if (pointers.size === 1) {
    if (selected !== i) { selected = i; refresh(); }
    gesture = { type: "pan", i, last: pt };
    preview.classList.add("dragging");
  } else if (pointers.size === 2 && gesture) {
    const [a, b] = [...pointers.values()];
    gesture = { type: "pinch", i: gesture.i, dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: panels[gesture.i].crop.zoom };
  }
}

function onPointerMove(e) {
  if (!pointers.has(e.pointerId) || !gesture) return;
  const pt = toPost(e);
  pointers.set(e.pointerId, pt);
  if (gesture.type === "pan") {
    pan(gesture.i, pt.x - gesture.last.x, pt.y - gesture.last.y);
    gesture.last = pt;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (gesture.dist > 0) setZoom(gesture.i, gesture.zoom * (d / gesture.dist));
  }
}

function onPointerEnd(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 1 && gesture) {
    gesture = { type: "pan", i: gesture.i, last: [...pointers.values()][0] };
  } else if (!pointers.size) {
    gesture = null;
    preview.classList.remove("dragging");
  }
}

function onWheel(e) {
  const i = panelAt(toPost(e));
  if (i < 0 || !panels[i].img) return;
  e.preventDefault();
  if (selected !== i) { selected = i; refresh(); }
  setZoom(i, panels[i].crop.zoom * Math.exp(-e.deltaY * 0.0015));
}

/* ---------- Export ---------- */
async function prepareFonts() {
  await loadBrand();
  await Promise.all([
    ensureBrandText(800, headline),
    ensureBrandText(700, P.footerText),
    P.watermark ? ensureWatermarkFont() : null
  ]);
}

async function exportPost() {
  const ready = readyPanels();
  if (!ready.length || isBusy()) return;
  newTicket();
  setBusy(true);
  startWork(1);
  try {
    workItem(0, "Making the post");
    await prepareFonts();
    const { W, H } = presetById(P.preset);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    drawPost(c.getContext("2d"), W, H, { headline, panels: ready }, drawOpts(false));
    const type = P.format === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), type, 0.92)
    );
    c.width = 0;
    c.height = 0;
    const name = `thika-post-${P.preset}-${stampSeconds()}.${type === "image/png" ? "png" : "jpg"}`;
    saveBlob(blob, name);
    toast(`Downloaded ${name}.`);
  } catch (err) {
    console.error("[post] export failed:", err);
    toast("The post could not be made. Try again, or use smaller photos.");
  } finally {
    setBusy(false);
  }
}

/* ---------- Wiring ---------- */
function onSetting(key, value) {
  P[key] = value;
  persistPost();
  if (key === "preset") { updatePresetHint(); updateBar(); }
  if (key === "footerOn") els.footerField.hidden = !value;
  if (key === "footerText") { ensureBrandText(700, value).then(scheduleRender); return; }
  if (key === "watermark" && value) { ensureWatermarkFont().then(scheduleRender); return; }
  scheduleRender();
}

export function initPost() {
  onBusyChange(updateBar);

  for (const pr of PRESETS) {
    const o = document.createElement("option");
    o.value = pr.id;
    o.textContent = `${pr.label} (${pr.platforms})`;
    els.preset.appendChild(o);
  }

  els.add.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => { addFiles(els.fileInput.files); els.fileInput.value = ""; });
  els.exportBtn.addEventListener("click", exportPost);
  els.clear.addEventListener("click", () => {
    const ask = panels.length === 1 ? "Remove the photo from the post?" : `Remove all ${panels.length} photos from the post?`;
    if (!confirm(ask)) return;
    panels.forEach((p) => URL.revokeObjectURL(p.url));
    panels.length = 0;
    selected = -1;
    refresh();
  });

  els.headline.addEventListener("input", () => {
    headline = els.headline.value;
    ensureBrandText(800, headline).then(scheduleRender);
  });
  els.preset.addEventListener("change", () => onSetting("preset", els.preset.value));
  els.footerOn.addEventListener("change", () => onSetting("footerOn", els.footerOn.checked));
  els.footerText.addEventListener("input", () => onSetting("footerText", els.footerText.value));
  els.format.addEventListener("change", () => onSetting("format", els.format.value));
  els.watermark.addEventListener("change", () => onSetting("watermark", els.watermark.checked));
  els.zoom.addEventListener("input", () => setZoom(selected, parseFloat(els.zoom.value)));

  preview.addEventListener("pointerdown", onPointerDown);
  preview.addEventListener("pointermove", onPointerMove);
  preview.addEventListener("pointerup", onPointerEnd);
  preview.addEventListener("pointercancel", onPointerEnd);
  preview.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("resize", scheduleRender);

  syncControls();
  refresh();
}

/* Called each time the mode is shown. The brand font and mark load on first
   use, so the watermark mode never downloads them. */
export function activatePost() {
  if (brandReady) { scheduleRender(); return; }
  loadBrand()
    .then(() => Promise.all([ensureBrandText(800, headline), ensureBrandText(700, P.footerText), P.watermark ? ensureWatermarkFont() : null]))
    .then(() => { brandReady = true; renderPreview(); })
    .catch((e) => {
      console.error("[post] brand assets failed to load:", e);
      toast("The post fonts could not load. Check the connection and reload the page.");
    });
}

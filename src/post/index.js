/* Author: Barzil Bruton.
 * Post maker mode: photo and video panels with crop, headline, footer and
 * export. Drawing lives in render.js, layouts in layouts.js, the video export
 * in video.js. */

import { $, toast } from "../shared/dom.js";
import { stampSeconds, fmtTime, fmtMB } from "../shared/util.js";
import { isImageFile, isVideoFile, VIDEO_WARN_BYTES, VIDEO_MAX_BYTES, MOBILE_UA, seekTo, grabThumb } from "../shared/media.js";
import { isBusy, onBusyChange, newTicket, setBusy, startWork, workItem, workPct } from "../shared/progress.js";
import { ensureEngine, engineReady } from "../shared/engine.js";
import { saveBlob } from "../shared/save.js";
import { loadBrand, ensureBrandText } from "./brand.js";
import { PRESETS, presetById, layoutFor } from "./layouts.js";
import { drawPost, coverCrop, minZoom } from "./render.js";
import { HEADLINE_FONTS, ensureHeadlineFont } from "./fonts.js";
import { renderPostVideo } from "./video.js";
import { P, persistPost } from "./settings.js";
import { ensureFont as ensureWatermarkFont } from "../watermark/render.js";

const MAX_PANELS = 3;
const MAX_ZOOM = 4;
const PREVIEW_MAX = 1600;

/* ---------- State ----------
   Each panel: { id, kind ("photo" or "video"), file, name, url, media, video,
   thumb, w, h, duration, crop: { zoom, cx, cy } }. media is the drawable
   source (the image, or the video element showing its poster frame) and is
   set once the file has loaded. crop is normalized (see render.js coverCrop),
   so it survives a change of preset or panel count. */
const panels = [];
let selected = -1;
let headline = "";
let nextId = 1;
let brandReady = false;
let lastLayout = null;
let mobileVideoWarned = false;

const preview = $("#postPreview");
const pctx = preview.getContext("2d");
const els = {
  fileInput: $("#postFileInput"), add: $("#postAddBtn"), exportBtn: $("#postExport"),
  count: $("#postCount"), meta: $("#postMeta"), strip: $("#postStrip"), clear: $("#postClear"),
  preset: $("#postPreset"), theme: $("#postTheme"), font: $("#postFont"), headline: $("#postHeadline"),
  fitWarn: $("#postFitWarn"), videoWarn: $("#postVideoWarn"), zoomField: $("#postZoomField"),
  zoom: $("#postZoom"), zoomOut: $("#postZoomOut"), footerOn: $("#postFooterOn"),
  footerText: $("#postFooterText"), footerField: $("#postFooterField"), format: $("#postFormat"),
  formatHint: $("#postFormatHint"), watermark: $("#postWatermark")
};

const drawOpts = (placeholder) => ({
  preset: P.preset, theme: P.theme, font: P.font, footerOn: P.footerOn, footerText: P.footerText,
  watermark: P.watermark, placeholder
});

const hasVideo = () => panels.some((p) => p.kind === "video");

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
const ONE_VIDEO = "Only one video per post. The other panels can hold photos.";

export function addFiles(list) {
  const all = [...list];
  const picked = all.filter((f) => isVideoFile(f) || isImageFile(f));
  const ignored = all.length - picked.length;
  if (!picked.length) {
    toast("Nothing was added. Choose JPG, PNG or WebP photos, or an MP4 video.");
    return;
  }
  let room = MAX_PANELS - panels.length;
  if (room <= 0) {
    toast("A post holds up to three panels. Remove one to add another.");
    return;
  }
  let video = hasVideo();
  let extraVideo = false;
  let over = 0;
  let tooBig = "";
  let bigWarn = "";
  let addedVideo = false;
  for (const file of picked) {
    const isVid = isVideoFile(file);
    if (isVid && video) { extraVideo = true; continue; }
    if (room <= 0) { over++; continue; }
    if (isVid) {
      if (file.size > VIDEO_MAX_BYTES) { tooBig = file.name; continue; }
      if (file.size > VIDEO_WARN_BYTES) bigWarn = file.name;
      addVideo(file);
      video = true;
      addedVideo = true;
    } else {
      addPhoto(file);
    }
    room--;
  }
  els.videoWarn.hidden = !extraVideo;
  refresh();
  if (extraVideo) toast(ONE_VIDEO);
  else if (tooBig) toast(`${tooBig} is too big for the browser (the limit is ${fmtMB(VIDEO_MAX_BYTES)}). Trim the video or save a smaller copy first.`);
  else if (over) toast(`A post holds up to three panels, so ${over} ${over === 1 ? "file was" : "files were"} not added.`);
  else if (ignored) toast(`${ignored} file${ignored > 1 ? "s were" : " was"} skipped. Only photos and videos can go in a post.`);
  else if (addedVideo && MOBILE_UA && !mobileVideoWarned) {
    mobileVideoWarned = true;
    toast("Video works best on a laptop or desktop. Phones can run low on memory partway through and stop the process.");
  } else if (bigWarn) toast(`${bigWarn} is a big video, so the post will take a while to make.`);
}

function newPanel(kind, file) {
  const p = { id: nextId++, kind, file, name: file.name, url: URL.createObjectURL(file), media: null,
    video: null, thumb: "", w: 0, h: 0, duration: 0, crop: { zoom: 1, cx: 0.5, cy: 0.5 } };
  panels.push(p);
  return p;
}

function addPhoto(file) {
  const p = newPanel("photo", file);
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    p.media = img;
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

/* The preview shows one still frame of the video, about a second in, the
   same frame the watermark mode uses for its preview. */
function addVideo(file) {
  const p = newPanel("video", file);
  const v = document.createElement("video");
  p.video = v;
  v.preload = "auto";
  v.muted = true;
  v.playsInline = true;
  v.addEventListener("loadeddata", () => {
    p.w = v.videoWidth;
    p.h = v.videoHeight;
    p.duration = isFinite(v.duration) ? v.duration : 0;
    if (!p.w || !p.h) { failVideo(p); return; }
    seekTo(p, p.duration ? Math.min(p.duration * 0.1, 1) : 0).then(() => {
      if (!panels.includes(p)) return;
      grabThumb(p);
      p.media = v;
      if (selected < 0) selected = panels.indexOf(p);
      refresh();
      ensureEngine().catch(() => {});
    });
  }, { once: true });
  v.addEventListener("error", () => failVideo(p), { once: true });
  v.src = p.url;
  v.load();
}

function failVideo(p) {
  if (!panels.includes(p)) return;
  removePanel(p.id, true);
  toast(`${p.name} could not be opened. Save it as an MP4 and add it again.`);
}

function disposePanel(p) {
  if (p.video) {
    try { p.video.pause(); } catch (e) {}
    p.video.removeAttribute("src");
    try { p.video.load(); } catch (e) {}
  }
  URL.revokeObjectURL(p.url);
}

function removePanel(id, silent) {
  const i = panels.findIndex((p) => p.id === id);
  if (i < 0) return;
  const kind = panels[i].kind;
  disposePanel(panels[i]);
  panels.splice(i, 1);
  if (!panels.length) selected = -1;
  else if (selected >= panels.length) selected = panels.length - 1;
  else if (i < selected) selected--;
  els.videoWarn.hidden = true;
  refresh();
  if (!silent) toast(kind === "video" ? "Video removed." : "Photo removed.");
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
const readyPanels = () => panels.filter((p) => p.media);

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
    wrap.className = "thumb post-thumb" + (i === selected ? " active" : "") + (p.kind === "video" ? " vid" : "");
    wrap.setAttribute("role", "listitem");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb-btn";
    b.setAttribute("aria-label", `Select ${p.kind} ${i + 1}, ${p.name}`);
    if (i === selected) b.setAttribute("aria-current", "true");
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    if (p.kind === "photo") img.src = p.url;
    else if (p.thumb) img.src = p.thumb;
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
    num.textContent = p.kind === "video" && p.duration ? `${i + 1} · ${fmtTime(p.duration)}` : String(i + 1);
    const moves = document.createElement("span");
    moves.className = "thumb-moves";
    for (const [dir, label, glyph] of [[-1, "earlier", "‹"], [1, "later", "›"]]) {
      const m = document.createElement("button");
      m.type = "button";
      m.className = "thumb-move";
      m.textContent = glyph;
      m.setAttribute("aria-label", `Move ${p.kind} ${i + 1} ${label}`);
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
  const vid = panels.find((p) => p.kind === "video");
  els.count.textContent = !n ? "Nothing added yet" : `${n} of ${MAX_PANELS} ${vid ? "panels" : "photos"}`;
  els.exportBtn.disabled = isBusy() || n === 0;
  els.clear.disabled = isBusy() || panels.length === 0;
  els.add.disabled = panels.length >= MAX_PANELS;
  els.formatHint.hidden = !vid;
  const pr = presetById(P.preset);
  els.meta.textContent = `${pr.label} · ${pr.W} × ${pr.H}` + (vid && vid.duration ? ` · MP4, ${fmtTime(vid.duration)}` : "");
}

/* Zoom range for panel i at the current preset: from the whole picture
   visible up to MAX_ZOOM. 100% is the picture just filling the panel. */
function zoomFloor(i) {
  const p = panels[i];
  const r = layoutFor(P.preset, panels.length, !!P.footerOn).panels[i];
  return p && p.media && r ? minZoom(p.w, p.h, r.w, r.h) : 1;
}

function updateZoomUI() {
  const p = panels[selected];
  els.zoomField.hidden = !(p && p.media);
  if (p && p.media) {
    const z = Math.max(zoomFloor(selected), p.crop.zoom);
    els.zoom.min = String(Math.floor(zoomFloor(selected) * 100) / 100);
    els.zoom.value = String(z);
    els.zoomOut.textContent = `${Math.round(z * 100)}%`;
  }
}

function syncControls() {
  els.preset.value = P.preset;
  els.theme.value = P.theme;
  els.font.value = P.font;
  els.footerOn.checked = !!P.footerOn;
  els.footerText.value = P.footerText;
  els.format.value = P.format;
  els.watermark.checked = !!P.watermark;
  els.footerField.hidden = !P.footerOn;
}

/* ---------- Crop interaction ---------- */
function clampCrop(p, r) {
  const c = coverCrop(p.w, p.h, r.w, r.h, p.crop);
  p.crop.cx = c.cx;
  p.crop.cy = c.cy;
}

function setZoom(i, z) {
  const p = panels[i];
  if (!p || !p.media || !lastLayout) return;
  p.crop.zoom = Math.min(MAX_ZOOM, Math.max(zoomFloor(i), z));
  clampCrop(p, lastLayout.panels[i]);
  updateZoomUI();
  scheduleRender();
}

/* Moves the media with the pointer: a drag of (dx, dy) post pixels shifts
   the visible window the opposite way in source space. */
function pan(i, dx, dy) {
  const p = panels[i];
  const r = lastLayout && lastLayout.panels[i];
  if (!p || !p.media || !r) return;
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

/* One pointer drags the media under it. A second pointer on the same panel
   turns the gesture into a pinch zoom. */
const pointers = new Map();
let gesture = null;

function onPointerDown(e) {
  const pt = toPost(e);
  const i = panelAt(pt);
  if (i < 0 || !panels[i].media) return;
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
  if (i < 0 || !panels[i].media) return;
  e.preventDefault();
  if (selected !== i) { selected = i; refresh(); }
  setZoom(i, panels[i].crop.zoom * Math.exp(-e.deltaY * 0.0015));
}

/* ---------- Export ---------- */
async function prepareFonts() {
  await loadBrand();
  await Promise.all([
    ensureHeadlineFont(P.font, headline),
    ensureBrandText(700, P.footerText),
    P.watermark ? ensureWatermarkFont() : null
  ]);
}

async function renderPhotoPost(W, H, state) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  drawPost(c.getContext("2d"), W, H, state, drawOpts(false));
  const type = P.format === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), type, 0.92)
  );
  c.width = 0;
  c.height = 0;
  return { blob, ext: type === "image/png" ? "png" : "jpg" };
}

function videoFailMessage(err) {
  return /timed out/.test((err && err.message) || "")
    ? "The post video took too long to make and was stopped. Try a shorter clip."
    : "The post video could not be made. The video may use a format the browser cannot read. Save it as an MP4 and try again.";
}

async function exportPost() {
  const ready = readyPanels();
  if (!ready.length || isBusy()) return;
  const vi = ready.findIndex((p) => p.kind === "video");
  const mine = newTicket();
  setBusy(true);
  startWork(1);
  try {
    if (vi >= 0) {
      workItem(0, "Getting the video tool ready");
      if (!(await engineReady())) return;
      if (mine.cancelled) { toast("Stopped."); return; }
    }
    workItem(0, vi >= 0 ? "Making the post video" : "Making the post");
    await prepareFonts();
    if (mine.cancelled) { toast("Stopped."); return; }
    const { W, H } = presetById(P.preset);
    const state = { headline, panels: ready };
    let out;
    if (vi >= 0) {
      const blob = await renderPostVideo({ W, H, state, opts: drawOpts(false), index: vi, onProgress: workPct, ticketRef: mine });
      if (mine.cancelled) { toast("Stopped."); return; }
      out = { blob, ext: "mp4" };
    } else {
      out = await renderPhotoPost(W, H, state);
    }
    const name = `thika-post-${P.preset}-${stampSeconds()}.${out.ext}`;
    saveBlob(out.blob, name);
    toast(`Downloaded ${name}.`);
  } catch (err) {
    if (mine.cancelled) toast("Stopped.");
    else {
      console.error("[post] export failed:", err);
      toast(vi >= 0 ? videoFailMessage(err) : "The post could not be made. Try again, or use smaller photos.");
    }
  } finally {
    setBusy(false);
  }
}

/* ---------- Wiring ---------- */
function onSetting(key, value) {
  P[key] = value;
  persistPost();
  if (key === "preset" || key === "footerOn") { updateBar(); updateZoomUI(); }
  if (key === "font") { ensureHeadlineFont(value, headline).then(scheduleRender); return; }
  if (key === "footerOn") els.footerField.hidden = !value;
  if (key === "footerText") { ensureBrandText(700, value).then(scheduleRender); return; }
  if (key === "watermark" && value) { ensureWatermarkFont().then(scheduleRender); return; }
  scheduleRender();
}

export function initPost() {
  onBusyChange(updateBar);

  for (const f of HEADLINE_FONTS) {
    const o = document.createElement("option");
    o.value = f.id;
    o.textContent = f.label;
    els.font.appendChild(o);
  }
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
    const vid = hasVideo();
    const ask = panels.length === 1
      ? `Remove the ${panels[0].kind} from the post?`
      : `Remove all ${panels.length} ${vid ? "panels" : "photos"} from the post?`;
    if (!confirm(ask)) return;
    panels.forEach(disposePanel);
    panels.length = 0;
    selected = -1;
    els.videoWarn.hidden = true;
    refresh();
  });

  els.headline.addEventListener("input", () => {
    headline = els.headline.value;
    ensureHeadlineFont(P.font, headline).then(scheduleRender);
  });
  els.preset.addEventListener("change", () => onSetting("preset", els.preset.value));
  els.theme.addEventListener("change", () => onSetting("theme", els.theme.value));
  els.font.addEventListener("change", () => onSetting("font", els.font.value));
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
    .then(() => Promise.all([ensureHeadlineFont(P.font, headline), ensureBrandText(700, P.footerText), P.watermark ? ensureWatermarkFont() : null]))
    .then(() => { brandReady = true; renderPreview(); })
    .catch((e) => {
      console.error("[post] brand assets failed to load:", e);
      toast("The post fonts could not load. Check the connection and reload the page.");
    });
}

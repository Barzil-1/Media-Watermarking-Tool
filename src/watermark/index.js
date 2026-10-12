/* Author: Barzil Bruton.
 * Watermark mode: the file list, live preview, settings controls and the
 * download flows. Rendering lives in render.js and file output in export.js. */

import { $, toast } from "../shared/dom.js";
import { sleep, fmtTime, fmtMB, stamp } from "../shared/util.js";
import {
  isVideoFile, isImageFile, VIDEO_WARN_BYTES, VIDEO_MAX_BYTES, BLANK_PX, MOBILE_UA, seekTo, grabThumb
} from "../shared/media.js";
import {
  isBusy, onBusyChange, newTicket, setBusy, startWork, workItem, workPct
} from "../shared/progress.js";
import { ensureEngine, engineReady } from "../shared/engine.js";
import { getMode } from "../shared/mode.js";
import { saveBlob, writeToFolder, dedupe, ZIP_LIMIT } from "../shared/save.js";
import { S, persistSettings, resetSettings } from "./settings.js";
import { ANCHORS, STYLES, ensureFont, effectivePos, drawWatermark } from "./render.js";
import { outTypeFor, extFor, cleanSuffix, failMessage, renderItem } from "./export.js";

/* ---------- State ----------
   Each item: { id, file, name, type, kind: "image" | "video", url, img, video,
   thumb, w, h, duration, time, ready, pos } */
const items = [];
let current = -1;
let nextId = 1;

/* ---------- Elements ---------- */
const fileInput = $("#fileInput");
const preview = $("#preview");
const pctx = preview.getContext("2d");
const els = {
  count: $("#count"), dlAll: $("#dlAll"), empty: $("#empty"), meta: $("#meta"),
  strip: $("#strip"), prev: $("#prevBtn"), next: $("#nextBtn"), dlOne: $("#dlOne"),
  clearAll: $("#clearAll"),
  posgrid: $("#posgrid"), posBlock: $("#posBlock"), gapField: $("#gapField"),
  bgLabel: $("#bgLabel"), outlineLabel: $("#outlineLabel"), resetPos: $("#resetPos"),
  qualityField: $("#qualityField"), nameExample: $("#nameExample"), stageTip: $("#stageTip"),
  scrub: $("#scrub"), scrubRange: $("#scrubRange"), scrubTime: $("#scrubTime"),
  videoField: $("#videoField"), motionField: $("#motionField"), motionSpeedField: $("#motionSpeedField")
};

/* ---------- Preview ---------- */
let rafId = 0;
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; renderPreview(); });
}
function renderPreview() {
  const it = items[current];
  const has = !!(it && it.ready);
  preview.hidden = !has;
  els.empty.hidden = items.length > 0;
  els.stageTip.hidden = !has || S.style === "tiled";
  if (!has) return;
  const src = it.kind === "video" ? it.video : it.img;
  if (it.kind === "video" && it.video.readyState < 2) return;
  const k = Math.min(1, 1800 / Math.max(it.w, it.h));
  const W = Math.max(1, Math.round(it.w * k));
  const H = Math.max(1, Math.round(it.h * k));
  if (preview.width !== W) preview.width = W;
  if (preview.height !== H) preview.height = H;
  pctx.clearRect(0, 0, W, H);
  try { pctx.drawImage(src, 0, 0, W, H); } catch (e) { return; }
  const t = it.kind === "video" ? it.time : undefined;
  drawWatermark(pctx, W, H, effectivePos(it), t);
}

/* ---------- Files ---------- */
let mobileVideoWarned = false;

export function addFiles(list) {
  const all = [...list];
  const picked = all.filter((f) => isVideoFile(f) || isImageFile(f));
  const ignored = all.length - picked.length;
  if (!picked.length) {
    toast("Nothing was added. Choose JPG, PNG or WebP pictures, or MP4 videos.");
    return;
  }
  const before = items.length;
  const tooBig = [];
  let bigWarn = "";
  for (const file of picked) {
    if (isVideoFile(file)) {
      if (file.size > VIDEO_MAX_BYTES) { tooBig.push(file.name); continue; }
      if (file.size > VIDEO_WARN_BYTES && !bigWarn) bigWarn = file.name;
      addVideo(file);
    } else {
      addImage(file);
    }
  }
  if (current < 0 && items.length) current = Math.min(before, items.length - 1);
  ensureFont().then(scheduleRender);
  refresh();
  const addedVideo = picked.some(isVideoFile);
  if (tooBig.length) {
    toast(`${tooBig.join(", ")} ${tooBig.length > 1 ? "are" : "is"} too big for the browser (the limit is ${fmtMB(VIDEO_MAX_BYTES)}). Trim the video or save a smaller copy first.`);
  } else if (ignored) {
    toast(`${ignored} file${ignored > 1 ? "s were" : " was"} skipped. Only pictures and videos can be watermarked.`);
  } else if (addedVideo && MOBILE_UA && !mobileVideoWarned) {
    mobileVideoWarned = true;
    toast("Video works best on a laptop or desktop. Phones can run low on memory partway through and stop the process, though photos are fine here either way.");
  } else if (bigWarn) {
    toast(`${bigWarn} is a big video, so it will take a while to finish.`);
  }
}

function addImage(file) {
  const item = { id: nextId++, file, name: file.name, type: file.type, kind: "image",
    url: URL.createObjectURL(file), img: new Image(), video: null, thumb: "",
    w: 0, h: 0, duration: 0, time: 0, ready: false, pos: null };
  items.push(item);
  item.img.decoding = "async";
  item.img.onload = () => {
    item.w = item.img.naturalWidth;
    item.h = item.img.naturalHeight;
    item.ready = true;
    if (current < 0) current = items.indexOf(item);
    refresh();
  };
  item.img.onerror = () => {
    removeItem(item.id, true);
    toast(`${file.name} could not be opened. Convert it to JPG or PNG and add it again.`);
  };
  item.img.src = item.url;
}

function addVideo(file) {
  const v = document.createElement("video");
  const item = { id: nextId++, file, name: file.name, type: file.type, kind: "video",
    url: URL.createObjectURL(file), img: null, video: v, thumb: "",
    w: 0, h: 0, duration: 0, time: 0, ready: false, pos: null };
  items.push(item);
  v.preload = "auto";
  v.muted = true;
  v.playsInline = true;
  v.addEventListener("loadeddata", () => {
    item.w = v.videoWidth;
    item.h = v.videoHeight;
    item.duration = isFinite(v.duration) ? v.duration : 0;
    if (!item.w || !item.h) { failVideo(item); return; }
    seekTo(item, item.duration ? Math.min(item.duration * 0.1, 1) : 0).then(() => {
      grabThumb(item);
      item.ready = true;
      if (current < 0) current = items.indexOf(item);
      refresh();
      ensureEngine().catch(() => {});
    });
  }, { once: true });
  v.addEventListener("error", () => failVideo(item), { once: true });
  v.src = item.url;
  v.load();
}

function failVideo(item) {
  const name = item.name;
  removeItem(item.id, true);
  toast(`${name} could not be opened. Save it as an MP4 and add it again.`);
}

/* Scrubbing issues many seeks; only the latest requested time is applied,
   one seek at a time. */
let seekBusy = false;
let pendingSeek = null;
async function pumpSeek(item) {
  if (seekBusy) return;
  seekBusy = true;
  while (pendingSeek !== null) {
    const t = pendingSeek;
    pendingSeek = null;
    await seekTo(item, t);
    renderPreview();
  }
  seekBusy = false;
}

function disposeItem(it) {
  if (it.video) {
    try { it.video.pause(); } catch (e) {}
    it.video.removeAttribute("src");
    try { it.video.load(); } catch (e) {}
  }
  URL.revokeObjectURL(it.url);
}
function removeItem(id, silent) {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const kind = items[i].kind;
  disposeItem(items[i]);
  items.splice(i, 1);
  if (!items.length) current = -1;
  else if (current >= items.length) current = items.length - 1;
  else if (i < current) current--;
  refresh();
  if (!silent) toast(kind === "video" ? "Video removed." : "Image removed.");
}
function clearAll() {
  items.forEach(disposeItem);
  items.length = 0;
  current = -1;
  refresh();
}
function select(i) {
  if (i < 0 || i >= items.length) return;
  current = i;
  refresh();
  const t = els.strip.children[i];
  if (t) t.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* ---------- UI refresh ---------- */
function refresh() {
  renderStrip();
  updateBar();
  updatePosUI();
  scheduleRender();
}
function renderStrip() {
  els.strip.textContent = "";
  items.forEach((it, i) => {
    const wrap = document.createElement("div");
    wrap.className = "thumb" + (i === current ? " active" : "") + (S.perImage && it.pos ? " own" : "") + (it.kind === "video" ? " vid" : "");
    wrap.setAttribute("role", "listitem");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "thumb-btn";
    b.setAttribute("aria-label", `Show ${it.name}`);
    if (i === current) b.setAttribute("aria-current", "true");
    const img = document.createElement("img");
    img.src = it.kind === "video" ? (it.thumb || BLANK_PX) : it.url;
    img.alt = ""; img.loading = "lazy"; img.decoding = "async";
    b.appendChild(img);
    b.addEventListener("click", () => select(i));
    const x = document.createElement("button");
    x.type = "button";
    x.className = "thumb-x";
    x.textContent = "×";
    x.setAttribute("aria-label", `Remove ${it.name}`);
    x.addEventListener("click", () => removeItem(it.id));
    const dot = document.createElement("span");
    dot.className = "thumb-dot";
    dot.title = "Has its own position";
    wrap.append(b, x, dot);
    if (it.kind === "video") {
      const badge = document.createElement("span");
      badge.className = "thumb-badge";
      badge.textContent = fmtTime(it.duration);
      wrap.appendChild(badge);
    }
    els.strip.appendChild(wrap);
  });
}
function countLabel() {
  if (!items.length) return "Nothing added yet";
  const v = items.filter((x) => x.kind === "video").length;
  const i = items.length - v;
  const part = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  if (!v) return part(i, "image", "images");
  if (!i) return part(v, "video", "videos");
  return `${part(i, "image", "images")} and ${part(v, "video", "videos")}`;
}
function updateBar() {
  const n = items.length;
  const anyVideo = items.some((x) => x.kind === "video");
  els.count.textContent = countLabel();
  els.dlAll.textContent = n > 1 ? (anyVideo ? `Download all ${n}` : `Download all ${n} as ZIP`) : "Download all";
  els.dlAll.disabled = isBusy() || n === 0;
  els.dlOne.disabled = isBusy() || !(items[current] && items[current].ready);
  els.clearAll.disabled = isBusy() || n === 0;
  els.prev.disabled = current <= 0;
  els.next.disabled = current < 0 || current >= n - 1;
  const it = items[current];
  els.dlOne.textContent = it && it.kind === "video" ? "Download this video" : "Download this image";
  if (it) {
    els.meta.textContent = "";
    const name = document.createElement("span");
    name.textContent = it.name;
    els.meta.appendChild(name);
    if (it.ready) {
      const d = document.createElement("span");
      d.className = "dims";
      d.textContent = it.kind === "video"
        ? `${it.w} × ${it.h} · ${fmtTime(it.duration)}`
        : `${it.w} × ${it.h}`;
      els.meta.appendChild(d);
    }
  } else {
    els.meta.innerHTML = "&nbsp;";
  }
  const showScrub = !!(it && it.ready && it.kind === "video" && it.duration);
  els.scrub.hidden = !showScrub;
  if (showScrub) {
    els.scrubRange.value = String(Math.round((it.time / it.duration) * 1000));
    els.scrubTime.textContent = `${fmtTime(it.time)} / ${fmtTime(it.duration)}`;
  }
  const ex = it ? it.name : "photo.jpg";
  const ext = it && it.kind === "video" ? "mp4" : extFor(outTypeFor(it));
  els.nameExample.textContent = `Example: ${ex.replace(/\.[^.]+$/, "")}${cleanSuffix()}.${ext}`;
}
function updatePosUI() {
  const tiled = S.style === "tiled";
  els.posBlock.hidden = tiled;
  els.gapField.hidden = !tiled;
  preview.classList.toggle("nodrag", tiled);
  const style = STYLES[S.style] || STYLES.badge;
  els.bgLabel.textContent = style.bgName;
  els.outlineLabel.textContent = style.outlineName;
  els.qualityField.hidden = S.format === "image/png";
  const hasVideo = items.some((x) => x.kind === "video");
  els.videoField.hidden = !hasVideo;
  const motionOK = !tiled && hasVideo;
  els.motionField.hidden = !motionOK;
  els.motionSpeedField.hidden = !motionOK || S.motion === "none";
  const pos = effectivePos(items[current]);
  [...els.posgrid.children].forEach((b) => b.classList.toggle("on", b.dataset.anchor === pos.anchor));
  [...els.posgrid.children].forEach((b) => b.setAttribute("aria-pressed", b.dataset.anchor === pos.anchor ? "true" : "false"));
  const it = items[current];
  els.resetPos.hidden = !S.perImage;
  els.resetPos.disabled = !(S.perImage && it && it.pos);
}
function syncControls() {
  document.querySelectorAll("[data-key]").forEach((el) => {
    const v = S[el.dataset.key];
    if (el.type === "radio") el.checked = el.value === v;
    else if (el.type === "checkbox") el.checked = !!v;
    else el.value = v;
  });
  updateOutputs();
  updatePosUI();
  updateBar();
}
function updateOutputs() {
  const fmt = {
    size: (v) => `${v}%`, opacity: (v) => `${v}%`, rotation: (v) => `${v}°`,
    margin: (v) => `${v}%`, lineHeight: (v) => Number(v).toFixed(2), quality: (v) => `${v}%`, gap: (v) => `${v}%`,
    motionSpeed: (v) => `${Number(v).toFixed(1)}s`
  };
  document.querySelectorAll("output[data-for]").forEach((o) => {
    const k = o.dataset.for;
    o.textContent = fmt[k] ? fmt[k](S[k]) : S[k];
  });
}

/* ---------- Controls ---------- */
function onControl(el) {
  const k = el.dataset.key;
  if (el.type === "radio") { if (!el.checked) return; S[k] = el.value; }
  else if (el.type === "checkbox") S[k] = el.checked;
  else if (el.type === "range") S[k] = parseFloat(el.value);
  else S[k] = el.value;
  updateOutputs();
  if (["style", "perImage", "format", "motion"].includes(k)) { updatePosUI(); renderStrip(); }
  if (["format", "suffix"].includes(k)) updateBar();
  if (["font", "bold", "text", "uppercase"].includes(k)) ensureFont().then(scheduleRender);
  scheduleRender();
  persistSettings();
}

function setPos(p) {
  if (S.style === "tiled") return;
  const it = items[current];
  if (S.perImage && it) {
    it.pos = { ...p };
  } else {
    S.anchor = p.anchor;
    if (p.anchor === "custom") { S.cx = p.cx; S.cy = p.cy; }
  }
  updatePosUI();
  if (S.perImage) renderStrip();
  scheduleRender();
  persistSettings();
}

/* ---------- Export ---------- */
async function downloadOne() {
  const it = items[current];
  if (!it || !it.ready || isBusy()) return;
  const mine = newTicket();
  setBusy(true);
  startWork(1);
  try {
    if (it.kind === "video") {
      workItem(0, "Getting the video tool ready");
      if (!(await engineReady())) return;
      if (mine.cancelled) { toast("Stopped."); return; }
    }
    workItem(0, `Watermarking ${it.name}`);
    const r = await renderItem(it, workPct, mine);
    if (mine.cancelled) { toast("Stopped."); return; }
    saveBlob(r.blob, r.name);
    toast(`Downloaded ${r.name}.`);
  } catch (err) {
    if (mine.cancelled) toast("Stopped.");
    else { console.error("[watermark] export failed:", err); toast(failMessage(it, err)); }
  } finally {
    setBusy(false);
  }
}

function estimateBytes(it) {
  return it.kind === "video" ? it.file.size : Math.max(60000, it.w * it.h * 0.45);
}

async function downloadAll() {
  const ready = items.filter((x) => x.ready);
  if (!ready.length || isBusy()) return;
  const videos = ready.filter((x) => x.kind === "video");
  const est = ready.reduce((a, x) => a + estimateBytes(x), 0);

  /* A batch with video can reach gigabytes, more than a ZIP can hold in
     memory, so it is written straight into a folder the user picks. */
  let dir = null;
  if (videos.length && ready.length > 1 && window.showDirectoryPicker) {
    try {
      dir = await window.showDirectoryPicker({ mode: "readwrite", id: "watermark-output" });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      dir = null;
    }
  }
  const mine = newTicket();
  setBusy(true);
  startWork(ready.length);
  const failed = [];
  const used = new Map();
  try {
    if (videos.length) {
      workItem(0, "Getting the video tool ready");
      if (!(await engineReady())) return;
      if (mine.cancelled) { toast("Stopped."); return; }
    }
    if (ready.length === 1 && !dir) {
      const it = ready[0];
      workItem(0, `Watermarking ${it.name}`);
      const r = await renderItem(it, workPct, mine);
      if (mine.cancelled) { toast("Stopped."); return; }
      saveBlob(r.blob, r.name);
      toast(`Downloaded ${r.name}.`);
      return;
    }

    const useZip = !dir && !!window.JSZip && (!videos.length || est <= ZIP_LIMIT);
    const zip = useZip ? new JSZip() : null;
    const singles = [];
    if (!dir && !useZip) {
      toast(window.JSZip
        ? "That is a lot of video for one ZIP, so the files will be saved one by one."
        : "The ZIP tool could not load, so files will be saved one by one. Check your internet connection to get a ZIP.");
    }

    for (let i = 0; i < ready.length; i++) {
      if (mine.cancelled) break;
      const it = ready[i];
      workItem(i, `Watermarking ${it.name}`);
      try {
        const r = await renderItem(it, workPct, mine);
        if (mine.cancelled) break;
        const name = dedupe(used, r.name);
        if (dir) await writeToFolder(dir, name, r.blob);
        else if (zip) zip.file(name, r.blob);
        else singles.push({ blob: r.blob, name });
      } catch (e) {
        if (mine.cancelled) break;
        console.error(`[watermark] export failed for ${it.name}:`, e);
        failed.push(it.name);
      }
      workPct(1);
      await sleep(0);
    }

    if (mine.cancelled) {
      toast(dir
        ? "Stopped. Whatever finished is already in the folder you chose."
        : "Stopped. Nothing was saved.");
      return;
    }

    const done = ready.length - failed.length;
    const skipped = failed.length ? ` Skipped: ${failed.join(", ")}.` : "";
    if (dir) {
      toast(`Saved ${done} files to the folder you chose.${skipped}`);
    } else if (zip) {
      startWork(1);
      workItem(0, "Packing the ZIP");
      const blob = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        (m) => workPct(m.percent / 100)
      );
      saveBlob(blob, `watermarked-${stamp()}.zip`);
      toast(`Downloaded ${done} files as a ZIP.${skipped}`);
    } else {
      for (const f of singles) {
        saveBlob(f.blob, f.name);
        await sleep(350);
      }
      toast(`Saved ${done} files.${skipped}`);
    }
  } catch (err) {
    if (!mine.cancelled) toast("The download could not be finished. Try fewer files at a time.");
  } finally {
    setBusy(false);
  }
}

/* ---------- Wiring ---------- */
export function initWatermark() {
  onBusyChange(updateBar);

  ANCHORS.forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.anchor = key;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", () => setPos({ anchor: key, cx: 0.5, cy: 0.5 }));
    els.posgrid.appendChild(b);
  });

  document.querySelectorAll("[data-key]").forEach((el) => {
    el.addEventListener("input", () => onControl(el));
    if (el.tagName === "SELECT" || el.type === "radio" || el.type === "checkbox") {
      el.addEventListener("change", () => onControl(el));
    }
  });

  els.resetPos.addEventListener("click", () => {
    const it = items[current];
    if (it) { it.pos = null; updatePosUI(); renderStrip(); scheduleRender(); }
  });
  $("#resetAll").addEventListener("click", () => {
    resetSettings();
    items.forEach((it) => (it.pos = null));
    syncControls();
    renderStrip();
    ensureFont().then(scheduleRender);
    persistSettings();
    toast("Settings reset.");
  });

  /* Dragging on the preview sets a custom position, as fractions of the frame. */
  let dragging = false;
  const pointToPos = (e) => {
    const r = preview.getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const cy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setPos({ anchor: "custom", cx, cy });
  };
  preview.addEventListener("pointerdown", (e) => {
    if (S.style === "tiled" || !items[current]) return;
    dragging = true;
    preview.classList.add("dragging");
    preview.setPointerCapture(e.pointerId);
    pointToPos(e);
  });
  preview.addEventListener("pointermove", (e) => { if (dragging) pointToPos(e); });
  const endDrag = () => { dragging = false; preview.classList.remove("dragging"); };
  preview.addEventListener("pointerup", endDrag);
  preview.addEventListener("pointercancel", endDrag);

  $("#addBtn").addEventListener("click", () => fileInput.click());
  $("#emptyAdd").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
  els.prev.addEventListener("click", () => select(current - 1));
  els.next.addEventListener("click", () => select(current + 1));
  els.clearAll.addEventListener("click", () => {
    if (confirm(`Remove all ${items.length} files from the list?`)) clearAll();
  });
  els.dlOne.addEventListener("click", downloadOne);
  els.dlAll.addEventListener("click", downloadAll);
  els.scrubRange.addEventListener("input", () => {
    const it = items[current];
    if (!it || it.kind !== "video" || !it.duration) return;
    const t = (parseFloat(els.scrubRange.value) / 1000) * it.duration;
    els.scrubTime.textContent = `${fmtTime(t)} / ${fmtTime(it.duration)}`;
    pendingSeek = t;
    pumpSeek(it);
  });

  document.addEventListener("keydown", (e) => {
    if (getMode() !== "watermark") return;
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (e.key === "ArrowLeft") select(current - 1);
    if (e.key === "ArrowRight") select(current + 1);
  });

  syncControls();
  refresh();
  ensureFont().then(scheduleRender);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRender);
  window.addEventListener("resize", scheduleRender);
}

/* Author: Barzil Bruton.
 * Owns the state of the current long-running job: the busy flag, the cancel
 * ticket, and the progress panel. Everything that takes time reports into
 * this module, and it paints the panel, the thin top bar and the header label
 * from the same state. */

import { shell } from "./dom.js";

let busy = false;
let ticket = null;
const busyListeners = [];

export const isBusy = () => busy;

/* Registers a callback run after every busy change, so each mode can refresh
   the buttons it disables while a job runs. */
export function onBusyChange(fn) {
  busyListeners.push(fn);
}

/* Starts a new cancellable job. The returned object's `cancelled` flag is set
   by cancelJob(); callers keep their own reference and check it after every
   await. */
export function newTicket() {
  ticket = { cancelled: false };
  return ticket;
}
export const currentTicket = () => ticket;

let work = null;
let workTimer = 0;
let workReveal = 0;

export function startWork(count) {
  work = { count, index: 0, title: "Working", pct: null, at: Date.now(), note: "" };
  shell.workStop.disabled = false;
  clearInterval(workTimer);
  workTimer = setInterval(drawWork, 500);
  /* A short delay before revealing the panel keeps fast jobs from flashing it. */
  if (shell.working.hidden) {
    clearTimeout(workReveal);
    workReveal = setTimeout(() => { if (work) shell.working.hidden = false; }, 400);
  }
  drawWork();
}

export function workItem(index, title) {
  if (!work) return;
  work.index = index;
  work.title = title;
  work.pct = null;
  work.note = "";
  work.at = Date.now();
  drawWork();
}

export function workPct(pct) {
  if (!work) return;
  work.pct = pct == null ? null : Math.max(0, Math.min(1, pct));
  drawWork();
}

export function workNote(text) {
  if (!work) return;
  work.note = text || "";
  drawWork();
}

/* Switches the panel to its stopping state after a cancel request. */
export function workStopping() {
  if (!work) return;
  work.title = "Stopping…";
  work.pct = null;
  work.note = "";
  drawWork();
}

function stopWork() {
  clearInterval(workTimer);
  clearTimeout(workReveal);
  workTimer = 0;
  workReveal = 0;
  work = null;
  shell.working.hidden = true;
}

function etaText(elapsed, pct) {
  const remain = (elapsed * (1 - pct)) / pct;
  if (!isFinite(remain) || remain < 5) return "almost done";
  if (remain < 60) return `about ${Math.max(5, Math.round(remain / 5) * 5)} seconds left`;
  const m = Math.round(remain / 60);
  return `about ${m} minute${m > 1 ? "s" : ""} left`;
}

function drawWork() {
  if (!work) return;
  const known = work.pct != null;
  const elapsed = (Date.now() - work.at) / 1000;
  shell.workTitle.textContent = work.title;
  shell.workTitle.title = work.title;
  shell.workPct.textContent = known ? `${Math.round(work.pct * 100)}%` : "…";
  shell.workBar.classList.toggle("pulse", !known);
  shell.workBar.style.width = known ? `${work.pct * 100}%` : "";

  /* Without a percentage the subtitle shows elapsed time, so the panel never
     looks frozen. */
  let sub = work.note;
  if (!sub) {
    if (known && work.pct > 0.02) sub = etaText(elapsed, work.pct);
    else if (elapsed > 2) sub = `${Math.round(elapsed)} seconds so far`;
  }
  shell.workSub.textContent = sub;

  const many = work.count > 1;
  shell.workOverall.hidden = !many;
  const overall = (work.index + (known ? work.pct : 0)) / Math.max(1, work.count);
  if (many) {
    shell.workOverallText.textContent = `File ${work.index + 1} of ${work.count}`;
    shell.workOverallBar.style.width = `${overall * 100}%`;
  }
  setProgress(many ? overall : known ? work.pct : 0);
  setJob(known ? `${work.title} · ${Math.round(work.pct * 100)}%` : work.title);
}

export function setBusy(on) {
  busy = on;
  shell.progress.hidden = !on;
  shell.cancel.hidden = !on;
  if (!on) {
    stopWork();
    setProgress(0);
    setJob("");
    ticket = null;
  }
  busyListeners.forEach((fn) => fn());
}

export function setProgress(f) {
  shell.progress.firstElementChild.style.width = `${Math.round(f * 100)}%`;
}

export function setJob(text) {
  shell.job.textContent = text || "";
  shell.job.hidden = !text;
}

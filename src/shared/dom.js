/* Author: Barzil Bruton.
 * DOM access shared by every mode: the query helper, the shell elements that
 * belong to the page frame rather than to one mode, and the toast. */

export const $ = (s) => document.querySelector(s);

export const shell = {
  toast: $("#toast"),
  progress: $("#progress"),
  job: $("#job"),
  cancel: $("#cancelBtn"),
  working: $("#working"),
  workTitle: $("#workTitle"),
  workPct: $("#workPct"),
  workBar: $("#workBar"),
  workSub: $("#workSub"),
  workOverall: $("#workOverall"),
  workOverallText: $("#workOverallText"),
  workOverallBar: $("#workOverallBar"),
  workStop: $("#workStop"),
  panel: $(".panel"),
  sheetBackdrop: $("#sheetBackdrop"),
  editBtn: $("#editBtn"),
  closeSheet: $("#closeSheet")
};

let toastTimer = 0;
export function toast(msg) {
  shell.toast.textContent = msg;
  shell.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => shell.toast.classList.remove("show"), 3800);
}

/* Author: Barzil Bruton.
 * The settings bottom sheet used below 880px. The side panel is the same
 * element at every width; this module only toggles whether it is slid up.
 * On desktop the toggle class has no visible effect. */

import { shell } from "./dom.js";

export function setSheetOpen(open) {
  shell.panel.classList.toggle("sheet-open", open);
  shell.sheetBackdrop.hidden = !open;
}

export function initSheet() {
  shell.editBtn.addEventListener("click", () => setSheetOpen(true));
  shell.closeSheet.addEventListener("click", () => setSheetOpen(false));
  shell.sheetBackdrop.addEventListener("click", () => setSheetOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && shell.panel.classList.contains("sheet-open")) setSheetOpen(false);
  });
}

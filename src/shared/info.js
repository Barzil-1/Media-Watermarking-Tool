/* Author: Barzil Bruton.
 * The (i) buttons next to settings. Each one shows or hides the short note
 * named by its aria-controls, directly below it. One listener serves every
 * button in both modes. */

export function initInfo() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".info");
    if (!btn) return;
    const note = document.getElementById(btn.getAttribute("aria-controls"));
    if (!note) return;
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    note.hidden = !open;
  });
}

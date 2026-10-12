/* Author: Barzil Bruton.
 * Files dropped anywhere on the page. The drop cover shows while files are
 * dragged over the window; dropped files go to `onFiles`, which routes them to
 * the active mode. */

const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");

export function initDrop(onFiles) {
  /* dragenter and dragleave fire for every child element crossed, so a depth
     counter decides when the pointer has actually left the window. */
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add("dropping"); });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dropping"); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove("dropping");
    onFiles(e.dataTransfer.files);
  });
}

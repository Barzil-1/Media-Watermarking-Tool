/* Author: Barzil Bruton.
 * Entry point loaded by batch-watermark.html. Wires the shared shell, starts
 * both modes, switches between them, and registers the service worker.
 *
 * Each mode keeps its own files, text and crops while the other is shown;
 * nothing is reset by switching. */

import { $, shell } from "./shared/dom.js";
import { initSheet } from "./shared/sheet.js";
import { initJobs } from "./shared/jobs.js";
import { initDrop } from "./shared/drop.js";
import { initInfo } from "./shared/info.js";
import { getMode, setMode, onModeChange } from "./shared/mode.js";
import { initWatermark, addFiles as addWatermarkFiles } from "./watermark/index.js";
import { initPost, activatePost, addFiles as addPostFiles } from "./post/index.js";

const MODES = {
  watermark: {
    button: $("#modeWm"), bar: $("#wmBar"), panel: $("#wmPanel"), pane: $("#wmPane"), stage: $("#stage"),
    sheetTitle: "Watermark settings", editLabel: "Edit watermark"
  },
  post: {
    button: $("#modePost"), bar: $("#postBar"), panel: $("#postPanel"), pane: $("#postPane"), stage: $("#postStage"),
    sheetTitle: "Post settings", editLabel: "Edit post"
  }
};

function showMode(mode) {
  for (const [name, m] of Object.entries(MODES)) {
    const on = name === mode;
    m.button.setAttribute("aria-pressed", on ? "true" : "false");
    m.bar.hidden = !on;
    m.panel.hidden = !on;
    m.pane.hidden = !on;
  }
  const m = MODES[mode];
  /* The progress overlay is positioned inside a stage, so it moves to the
     stage on screen. A job keeps reporting into it across a switch. */
  m.stage.appendChild(shell.working);
  $("#sheetTitle").textContent = m.sheetTitle;
  shell.panel.setAttribute("aria-label", m.sheetTitle);
  shell.editBtn.textContent = m.editLabel;
  if (mode === "post") activatePost();
}

initSheet();
initInfo();
initJobs();
initWatermark();
initPost();
initDrop((files) => (getMode() === "post" ? addPostFiles(files) : addWatermarkFiles(files)));

onModeChange(showMode);
MODES.watermark.button.addEventListener("click", () => setMode("watermark"));
MODES.post.button.addEventListener("click", () => setMode("post"));

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

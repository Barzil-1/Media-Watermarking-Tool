/* Author: Barzil Bruton.
 * Entry point loaded by batch-watermark.html. Wires the shared shell, starts
 * the watermark mode, and registers the service worker. */

import { initSheet } from "./shared/sheet.js";
import { initJobs } from "./shared/jobs.js";
import { initWatermark } from "./watermark/index.js";

initSheet();
initJobs();
initWatermark();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* Author: Barzil Bruton.
 * Cancellation of the current job. Kept apart from progress.js so that
 * module does not depend on the video engine. */

import { shell } from "./dom.js";
import { currentTicket, workStopping, setJob } from "./progress.js";
import { killEngine } from "./engine.js";

/* Marks the current ticket cancelled and terminates the ffmpeg worker, which
   rejects any encode in flight. Export loops check the ticket after each
   await and stop. */
export function cancelJob() {
  const ticket = currentTicket();
  if (!ticket || ticket.cancelled) return;
  ticket.cancelled = true;
  shell.workStop.disabled = true;
  workStopping();
  setJob("Stopping…");
  killEngine();
}

export function initJobs() {
  shell.cancel.addEventListener("click", cancelJob);
  shell.workStop.addEventListener("click", cancelJob);
}

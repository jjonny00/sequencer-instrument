import { unlockAudioSync } from "./audioUnlock";

let installed = false;

/**
 * On the first pointerup/touchend/click, run unlockAudioSync() once.
 */
export function initFirstGestureUnlock() {
  if (installed) {
    return;
  }
  installed = true;

  const handler = () => {
    try {
      unlockAudioSync();
    } catch {
      // ignore
    }
  };

  window.addEventListener("pointerup", handler, { capture: true, once: true });
  window.addEventListener("touchend", handler, { capture: true, once: true });
  window.addEventListener("click", handler, { capture: true, once: true });
}

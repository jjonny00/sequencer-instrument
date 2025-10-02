import { unlockAudioSync } from "./audioUnlock";

/**
 * Installs a one-time, capture-phase listener on the first *completed* gesture.
 * This guarantees WebAudio unlock even if React's handlers don't run in PWA.
 */
let installed = false;

export function initFirstGestureUnlock(): void {
  if (installed || typeof window === "undefined") {
    return;
  }

  installed = true;

  const handler = () => {
    try {
      unlockAudioSync();
    } catch {}
  };

  window.addEventListener("pointerup", handler, { capture: true, once: true });
  window.addEventListener("touchend", handler, { capture: true, once: true });
  window.addEventListener("click", handler, { capture: true, once: true });
}

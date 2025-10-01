import { unlockAudioSync } from "./audioUnlock";

let installed = false;

/**
 * On the first pointer/touch/click, run unlockAudioSync() once at capture time.
 */
export function initFirstGestureUnlock() {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  const eventTypes: Array<keyof WindowEventMap> = [
    "pointerdown",
    "pointerup",
    "touchstart",
    "touchend",
    "click",
  ];

  const options: AddEventListenerOptions = { capture: true };

  const cleanup = () => {
    for (const type of eventTypes) {
      window.removeEventListener(type, handler, options);
    }
  };

  const handler = () => {
    cleanup();
    try {
      unlockAudioSync();
    } catch {
      // ignore
    }
  };

  for (const type of eventTypes) {
    window.addEventListener(type, handler, options);
  }
}

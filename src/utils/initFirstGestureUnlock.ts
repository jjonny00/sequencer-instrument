import { unlockAudioSync } from "./audioUnlock";

let installed = false;

/**
 * On the very first gesture, synchronously unlock audio and forward the click.
 */
export function initFirstGestureUnlock() {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  const handler = (event: Event) => {
    try {
      unlockAudioSync();
      const target = event.target as HTMLElement | null;
      if (target?.click) {
        queueMicrotask(() => {
          try {
            target.click();
          } catch {
            // ignore synthetic click failures
          }
        });
      }
    } catch {
      // ignore unlock failures
    }
  };

  const options: AddEventListenerOptions = { capture: true, once: true };

  window.addEventListener("pointerdown", handler, options);
  window.addEventListener("touchstart", handler, options);
  window.addEventListener("mousedown", handler, options);
}

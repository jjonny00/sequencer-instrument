import * as Tone from "tone";

let initialized = false;

/**
 * Ensure the Tone.js AudioContext is unlocked on iOS/Safari.
 * This attaches a one-time pointer listener at capture phase,
 * guaranteeing it runs in a "real" user gesture context.
 */
export function initAudioUnlock() {
  if (initialized) return;
  initialized = true;

  if (Tone.context.state === "running") return;

  const unlock = () => {
    try {
      (Tone.context as any).resume();
    } catch (err) {
      console.warn("Audio unlock failed:", err);
    }
  };

  window.addEventListener("pointerdown", unlock, {
    once: true,
    capture: true,
  });
}

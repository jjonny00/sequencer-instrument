import * as Tone from "tone";

/**
 * Unlock WebAudio on iOS 26.0.1:
 * 1) If already running, bail.
 * 2) Try Tone.start() (Tone's wrapper).
 * 3) If state is still "interrupted", call raw AudioContext.resume().
 * 4) If still not running, play a 1-frame silent buffer to nudge the graph.
 */
export async function unlockAudio(): Promise<void> {
  try {
    if (typeof window === "undefined") {
      return;
    }

    const getContextState = () =>
      (Tone.context.state as AudioContextState | "interrupted");

    // Case 1: Already running
    if (getContextState() === "running") return;

    // Case 2: Suspended or interrupted — try Tone’s resume
    await Tone.start();

    // iOS 26 can report "interrupted" and ignore Tone.start()
    if (getContextState() === "interrupted") {
      console.warn("[audioUnlock] Context is 'interrupted' — trying raw resume()");
      try {
        await (Tone.context.rawContext as AudioContext).resume();
      } catch (err) {
        console.error("[audioUnlock] Raw resume failed:", err);
      }
    }

    // Case 3: Still not running — silent buffer hack (one-time nudge)
    if (getContextState() !== "running") {
      console.warn("[audioUnlock] Still not running — playing silent buffer nudge");
      try {
        const ctx = Tone.context.rawContext as AudioContext;
        const buffer = ctx.createBuffer(1, 1, 22050); // 1 frame @ 22.05kHz is fine
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch (err) {
        console.error("[audioUnlock] Silent buffer trick failed:", err);
      }
    }
  } catch (err) {
    console.error("[audioUnlock] unlockAudio error:", err);
  }
}

/** Small helpers (useful for debugging/testing) */
export function getAudioState(): AudioContextState {
  return (Tone.context?.state ?? "suspended") as AudioContextState;
}
export function isAudioRunning(): boolean {
  return getAudioState() === "running";
}

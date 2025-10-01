import * as Tone from "tone";

/**
 * Ensure Tone.js AudioContext is running on iOS (including PWA).
 * Handles "suspended" and "interrupted" states with fallbacks.
 */
export async function unlockAudio(): Promise<void> {
  try {
    let state = Tone.context.state as string;

    if (state === "running") return;

    // First try Tone's own unlock
    await Tone.start();

    state = Tone.context.state as string;

    if (state === "interrupted") {
      console.warn("Audio context is 'interrupted', trying raw resume");
      try {
        await (Tone.context.rawContext as AudioContext).resume();
      } catch (err) {
        console.error("Raw resume failed:", err);
      }
      state = Tone.context.state as string;
    }

    if (state !== "running") {
      console.warn("Audio context still not running, using silent buffer hack");
      try {
        const ctx = Tone.context.rawContext as AudioContext;
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      } catch (err) {
        console.error("Silent buffer hack failed:", err);
      }
    }
  } catch (err) {
    console.error("unlockAudio error:", err);
  }
}

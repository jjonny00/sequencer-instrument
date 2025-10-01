import * as Tone from "tone";

/**
 * Proven unlock: handle "interrupted" (iOS 26.0.1) and nudge with a silent buffer.
 * This function may be async internally, but callers on the start screen must NOT await it.
 */
export async function unlockAudio(): Promise<void> {
  try {
    if (Tone.context.state === "running") return;

    // Try Tone's own unlock first
    await Tone.start();

    // iOS 26.0.1: context may be "interrupted" and ignore Tone.start()
    const state = Tone.context.state as string;

    if (state === "interrupted") {
      try {
        await (Tone.context.rawContext as AudioContext).resume();
      } catch (err) {
        console.error("Raw resume failed:", err);
      }
    }

    // Still not running? Play a 1-frame silent buffer to wake the engine.
    if ((Tone.context.state as string) !== "running") {
      const ctx = Tone.context.rawContext as AudioContext;
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch (err) {
    console.error("unlockAudio error:", err);
  }
}

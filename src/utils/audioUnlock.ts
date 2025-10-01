import * as Tone from "tone";

/**
 * Handles "suspended" and "interrupted" (iOS 26.0.1),
 * then tickles the engine with a silent buffer if needed.
 */
export async function unlockAudio(): Promise<void> {
  try {
    if (Tone.context.state === "running") return;

    // Try Tone's own unlock first
    await Tone.start();

    // iOS 26.0.1 bug: "interrupted" state won't resume via Tone
    // @ts-expect-error -- lib.dom.d.ts does not yet include the "interrupted" state
    if (Tone.context.state === "interrupted") {
      try {
        await (Tone.context.rawContext as AudioContext).resume();
      } catch (err) {
        console.error("Raw resume failed:", err);
      }
    }

    // If still not running, play a 1-frame silent buffer to coax the engine
    // @ts-expect-error -- state may report "interrupted" even after Tone.start()
    if (Tone.context.state !== "running") {
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

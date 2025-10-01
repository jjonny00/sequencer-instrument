import * as Tone from "tone";

/**
 * Synchronous unlock for use inside user gestures (e.g. start screen buttons).
 * No await, no .then(). iOS PWA requires touching AudioContext immediately.
 */
export function unlockAudioSync(): void {
  try {
    const ctx = Tone.getContext().rawContext as AudioContext;

    if (ctx.state === "running") return;

    // Try resume (do not await)
    try {
      ctx.resume();
    } catch {}

    // Silent oscillator tickle
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + 0.001);
  } catch (err) {
    console.error("unlockAudioSync failed:", err);
    try {
      (Tone.start as any)?.();
    } catch {}
  }
}

/**
 * Async unlock for non-gesture contexts (background resume, overlays, etc).
 * Handles iOS 26.0.1 "interrupted" state and uses a silent buffer fallback.
 */
export async function unlockAudio(): Promise<void> {
  try {
    const context = Tone.context;
    const initialState = context.state as AudioContextState | "interrupted";
    if (initialState === "running") return;

    await Tone.start();

    let currentState = context.state as AudioContextState | "interrupted";
    if (currentState === "interrupted") {
      try {
        await (context.rawContext as AudioContext).resume();
      } catch (err) {
        console.error("Raw resume failed:", err);
      }
      currentState = context.state as AudioContextState | "interrupted";
    }

    if (currentState !== "running") {
      const ctx = context.rawContext as AudioContext;
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

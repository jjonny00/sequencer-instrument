import * as Tone from "tone";

/**
 * Synchronous unlock for use INSIDE a user gesture (tap/click).
 * No await/.then(). Touches the raw AudioContext and tickles it silently.
 */
export function unlockAudioSync(): void {
  try {
    const ctx = (Tone.getContext?.() ?? Tone.context)?.rawContext as
      | AudioContext
      | undefined;

    if (!ctx || ctx.state === "running") {
      return;
    }

    try {
      ctx.resume?.();
    } catch {}

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + 0.001);
    } catch {}
  } catch (err) {
    try {
      (Tone.start as unknown as (() => void) | undefined)?.();
    } catch {}
  }
}

/**
 * Async unlock for non-gesture contexts (resume after background, overlays).
 * Handles iOS 26.0.1 "interrupted" state and uses a silent buffer fallback.
 */
export async function unlockAudio(): Promise<void> {
  try {
    type ExtendedAudioState = AudioContextState | "interrupted";

    let state = Tone.context.state as ExtendedAudioState;

    if (state === "running") {
      return;
    }

    await Tone.start();

    state = Tone.context.state as ExtendedAudioState;

    if (state === "interrupted") {
      try {
        await (Tone.context.rawContext as AudioContext).resume();
      } catch (err) {
        console.error("Raw resume failed:", err);
      }
      state = Tone.context.state as ExtendedAudioState;
    }

    if (state !== "running") {
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

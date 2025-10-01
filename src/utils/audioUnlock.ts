import * as Tone from "tone";

type ToneLikeContext = {
  rawContext?: unknown;
  state: AudioContextState | "interrupted" | string;
};

const getToneContext = (): ToneLikeContext | undefined => {
  const context = (Tone.getContext?.() ?? Tone.context) as ToneLikeContext | undefined;
  return context;
};

/**
 * Synchronous unlock for use INSIDE a user gesture.
 * Immediately resumes and tickles the raw AudioContext.
 */
export function unlockAudioSync(): void {
  try {
    const toneContext = getToneContext();
    const ctx = toneContext?.rawContext as AudioContext | undefined;

    if (!ctx) {
      try {
        (Tone.start as unknown as (() => void) | undefined)?.();
      } catch {
        // ignore
      }
      return;
    }

    if (ctx.state === "running") {
      return;
    }

    try {
      ctx.resume?.();
    } catch {
      // ignore
    }

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + 0.001);
    } catch {
      // ignore
    }
  } catch {
    try {
      (Tone.start as unknown as (() => void) | undefined)?.();
    } catch {
      // ignore
    }
  }
}

/**
 * Async unlock for resume/visibility. Handles iOS 26.0.1 “interrupted” state.
 */
export async function unlockAudio(): Promise<void> {
  try {
    if (typeof window === "undefined") {
      return;
    }

    const toneContext = getToneContext();
    const rawContext = toneContext?.rawContext as AudioContext | undefined;

    if (toneContext?.state === "running") {
      return;
    }

    await Tone.start();

    if (toneContext?.state === "interrupted" && rawContext) {
      try {
        await rawContext.resume();
      } catch (err) {
        console.error("Raw resume failed:", err);
      }
    }

    if (toneContext?.state !== "running" && rawContext) {
      try {
        const buffer = rawContext.createBuffer(1, 1, 22050);
        const source = rawContext.createBufferSource();
        source.buffer = buffer;
        source.connect(rawContext.destination);
        source.start(0);
      } catch (err) {
        console.error("Silent buffer unlock failed:", err);
      }
    }
  } catch (err) {
    console.error("unlockAudio error:", err);
  }
}

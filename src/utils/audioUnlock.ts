import * as Tone from "tone";

type ToneLikeContext = {
  rawContext?: unknown;
  state?: AudioContextState | "interrupted" | string;
};

const getToneContext = (): ToneLikeContext | undefined =>
  (Tone.getContext?.() ?? Tone.context) as ToneLikeContext | undefined;

const getRawContext = (): AudioContext | undefined => {
  const context = getToneContext();
  const raw = context?.rawContext as AudioContext | undefined;
  return raw;
};

const resumeAudioContextSync = (ctx: AudioContext) => {
  try {
    const maybePromise = ctx.resume?.();
    if (typeof (maybePromise as Promise<void> | undefined)?.catch === "function") {
      (maybePromise as Promise<void>).catch(() => {
        // Ignore resume rejection triggered outside of user gestures.
      });
    }
  } catch {
    // ignore
  }
};

const tickleAudioContext = (ctx: AudioContext) => {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    try {
      osc.start(now);
    } catch {
      osc.start();
    }
    try {
      osc.stop(now + 0.001);
    } catch {
      osc.stop();
    }
    setTimeout(() => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    }, 0);
  } catch {
    // ignore
  }
};

const shouldAttemptResume = (
  toneState: ToneLikeContext["state"],
  rawState: AudioContextState | undefined
) => {
  if (!toneState && !rawState) {
    return true;
  }
  if (toneState === "interrupted" || toneState === "suspended") {
    return true;
  }
  return rawState !== "running";
};

/**
 * Synchronous unlock for use INSIDE a user gesture.
 * Immediately resumes and tickles the raw AudioContext.
 */
export function unlockAudioSync(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const toneContext = getToneContext();
    const ctx = getRawContext();

    if (!ctx || !toneContext) {
      try {
        (Tone.start as unknown as (() => void) | undefined)?.();
      } catch {
        // ignore
      }
      return;
    }

    if (!shouldAttemptResume(toneContext.state, ctx.state)) {
      return;
    }

    resumeAudioContextSync(ctx);
    tickleAudioContext(ctx);
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

    let toneContext = getToneContext();
    let rawContext = getRawContext();

    if (toneContext?.state === "running" && rawContext?.state === "running") {
      return;
    }

    await Tone.start();

    toneContext = getToneContext();
    rawContext = getRawContext();

    if (!toneContext || !rawContext) {
      return;
    }

    if (
      toneContext.state === "interrupted" ||
      toneContext.state === "suspended" ||
      rawContext.state === "suspended"
    ) {
      try {
        await rawContext.resume();
      } catch (err) {
        console.error("Raw resume failed:", err);
      }
    }

    toneContext = getToneContext();
    rawContext = getRawContext();

    if (!toneContext || !rawContext) {
      return;
    }

    if (toneContext.state !== "running" || rawContext.state !== "running") {
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

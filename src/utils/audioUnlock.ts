import * as Tone from "tone";

type AudioState = AudioContextState | "interrupted";

let hardUnlocked = false;

export function getAudioState(): AudioState {
  try {
    return (Tone.context?.state as AudioState) ?? "suspended";
  } catch {
    return "suspended";
  }
}

/**
 * Returns true if AudioContext is running.
 */
export function isAudioRunning(): boolean {
  return getAudioState() === "running";
}

function ensureHiddenContainer(): HTMLElement {
  let el = document.getElementById("__audio-unlock-bin__");
  if (!el) {
    el = document.createElement("div");
    el.id = "__audio-unlock-bin__";
    el.style.position = "fixed";
    el.style.width = "0";
    el.style.height = "0";
    el.style.overflow = "hidden";
    el.style.pointerEvents = "none";
    el.style.opacity = "0";
    document.body.appendChild(el);
  }
  return el;
}

// A 1-frame silent WAV (44-byte header + 0 data). Works in Safari.
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAAAABAA==";

/**
 * The most aggressive unlock:
 *  - Synchronously poke WebAudio resume (no await)
 *  - Play a hidden <audio> (Safari trusts media playback gestures)
 *  - Nudge with a 1-frame silent buffer
 * Call this inside the EARLIEST gesture (pointerdown/touchstart).
 */
export function unlockAudioSyncHard(): void {
  try {
    if (isAudioRunning()) {
      hardUnlocked = true;
      return;
    }

    const ctx = (Tone.getContext?.() ?? Tone.context).rawContext as AudioContext;

    // 1) Try to resume the raw context synchronously (do not await)
    try {
      ctx?.resume?.();
    } catch {}

    // 2) Kick Tone’s wrapper (don’t await)
    try {
      (Tone.start as any)?.();
    } catch {}

    // 3) Use a trusted media playback: hidden <audio> .play()
    try {
      const bin = ensureHiddenContainer();
      const el = document.createElement("audio");
      el.setAttribute("playsinline", "");
      el.muted = true;
      el.preload = "auto";
      el.src = SILENT_WAV_DATA_URI;
      bin.appendChild(el);
      // Do not await: keep within the same gesture turn
      el.play().catch(() => {});
      // Pause & cleanup soon after
      setTimeout(() => {
        try {
          el.pause();
        } catch {}
        try {
          bin.removeChild(el);
        } catch {}
      }, 200);
    } catch {}

    // 4) Nudge the audio graph with a 1-frame silent buffer
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch {}

    if (ctx.state === "running") hardUnlocked = true;
  } catch {
    // Ignore
  }
}

/**
 * Async unlock for non-gesture contexts (resume/visibility/etc).
 * Handles iOS 26 "interrupted" and uses media element + silent buffer fallback.
 */
export async function unlockAudio(): Promise<void> {
  try {
    if (isAudioRunning()) return;

    // Try Tone first
    await Tone.start();

    if (!isAudioRunning()) {
      const ctx = (Tone.context?.rawContext as AudioContext) ?? null;
      const state = ctx?.state as AudioState | undefined;
      if (state === "interrupted") {
        try {
          await ctx.resume();
        } catch (e) {
          console.error("[audioUnlock] raw resume failed", e);
        }
      }
    }

    if (!isAudioRunning()) {
      // Try media element in async path too
      try {
        const bin = ensureHiddenContainer();
        const el = document.createElement("audio");
        el.setAttribute("playsinline", "");
        el.muted = true;
        el.preload = "auto";
        el.src = SILENT_WAV_DATA_URI;
        bin.appendChild(el);
        await el.play().catch(() => {});
        try {
          el.pause();
        } catch {}
        try {
          bin.removeChild(el);
        } catch {}
      } catch {}
    }

    if (!isAudioRunning()) {
      // Final nudge
      try {
        const ctx = (Tone.getContext?.() ?? Tone.context).rawContext as AudioContext;
        const buffer = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
      } catch {}
    }

    if (isAudioRunning()) {
      hardUnlocked = true;
    }
  } catch (err) {
    console.error("[audioUnlock] unlockAudio error:", err);
  }
}

export function hasHardUnlocked(): boolean {
  return hardUnlocked || isAudioRunning();
}

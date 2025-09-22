import * as Tone from "tone";

import { SILENT_MP3_BASE64_CHUNKS } from "./silentMp3";

type ToneWithInternals = typeof Tone & {
  context: Tone.Context;
  Transport: typeof Tone.Transport;
  Destination: typeof Tone.Destination;
  Draw: typeof Tone.Draw;
  Listener: typeof Tone.Listener;
};

const toneInternals = Tone as ToneWithInternals;

const syncToneSingleton = <T extends object>(target: T, source: T) => {
  if (!target || !source) {
    return;
  }

  const prototype = Object.getPrototypeOf(source);
  if (prototype && prototype !== Object.getPrototypeOf(target)) {
    Object.setPrototypeOf(target, prototype);
  }

  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    }
  }
};

const MIN_FILTER_FREQUENCY = 80;
const MAX_FILTER_FREQUENCY = 12000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const minLog = Math.log(MIN_FILTER_FREQUENCY);
const maxLog = Math.log(MAX_FILTER_FREQUENCY);

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

type AsyncActionResult =
  | { status: "resolved" }
  | { status: "rejected"; error: unknown }
  | { status: "timeout" };

const runWithTimeout = async (
  action: () => void | Promise<unknown>,
  label: string,
  timeoutMs: number
) => {
  let actionPromise: Promise<void>;
  try {
    actionPromise = (async () => {
      await action();
    })();
  } catch (error) {
    console.warn(`[Audio Init] ${label} threw unexpectedly:`, error);
    return;
  }

  let actionResult: AsyncActionResult = { status: "timeout" };

  try {
    actionResult = await Promise.race([
      actionPromise
        .then(() => ({ status: "resolved" } as const))
        .catch((error) => ({ status: "rejected", error } as const)),
      wait(timeoutMs).then(() => ({ status: "timeout" } as const)),
    ]);
  } catch (error) {
    console.warn(`[Audio Init] ${label} threw unexpectedly:`, error);
    return;
  }

  if (actionResult.status === "timeout") {
    console.warn(
      `[Audio Init] ${label} timed out after ${timeoutMs}ms — continuing without waiting`
    );
  } else if (actionResult.status === "rejected") {
    console.warn(`[Audio Init] ${label} failed:`, actionResult.error);
  }
};

const SILENT_MP3_SRC = `data:audio/mp3;base64,${SILENT_MP3_BASE64_CHUNKS.join("")}`;

const applyToneContext = (newContext: Tone.Context) => {
  Tone.setContext(newContext);

  syncToneSingleton(toneInternals.context, newContext);
  syncToneSingleton(toneInternals.Transport, Tone.getTransport());
  syncToneSingleton(toneInternals.Destination, Tone.getDestination());
  syncToneSingleton(toneInternals.Draw, Tone.getDraw());
  const listener = Tone.getContext().listener as typeof Tone.Listener | undefined;
  if (listener) {
    syncToneSingleton(toneInternals.Listener, listener);
  }
};

export const isIOSPWA = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };

  return (
    navigatorWithStandalone.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
};

let silentUnlockCompleted = false;
let pendingSilentUnlock: Promise<void> | null = null;

export const silentUnlock = async (): Promise<void> => {
  if (typeof window === "undefined" || silentUnlockCompleted) {
    return;
  }

  if (!pendingSilentUnlock) {
    pendingSilentUnlock = (async () => {
      try {
        console.log("[Audio Init] Performing silent unlock");
        const audioElement = new Audio(SILENT_MP3_SRC);
        audioElement.preload = "auto";
        audioElement.loop = false;
        audioElement.volume = 0;

        try {
          await audioElement.play();
        } catch (error) {
          console.warn("[Audio Init] Silent unlock play() rejected:", error);
          return;
        }

        await new Promise<void>((resolve) => {
          const cleanup = () => {
            audioElement.pause();
            audioElement.removeAttribute("src");
            audioElement.load();
            resolve();
          };

          audioElement.addEventListener("ended", cleanup, { once: true });
          audioElement.addEventListener("error", cleanup, { once: true });
          window.setTimeout(cleanup, 200);
        });

        silentUnlockCompleted = true;
        console.log("[Audio Init] Silent unlock completed");
      } finally {
        pendingSilentUnlock = null;
      }
    })();
  }

  await pendingSilentUnlock;
};

const CONTEXT_CLOSE_TIMEOUT_MS = 750;

export const forceAudioContextCleanup = async (): Promise<void> => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const existingContext = Tone.getContext();
    const rawContext = existingContext.rawContext as AudioContext | undefined;

    try {
      existingContext.dispose();
    } catch (error) {
      console.warn("[Audio Init] Failed to dispose Tone context:", error);
    }

    const closableContext = Tone.context as Tone.Context & {
      close?: () => Promise<void>;
    };
    if (typeof closableContext?.close === "function") {
      await runWithTimeout(
        () => closableContext.close!(),
        "Tone.context.close()",
        CONTEXT_CLOSE_TIMEOUT_MS
      );
    }

    if (rawContext && typeof rawContext.close === "function") {
      await runWithTimeout(
        () => rawContext.close(),
        "raw AudioContext.close()",
        CONTEXT_CLOSE_TIMEOUT_MS
      );
    }

    let newRawContext: AudioContext | undefined;
    const audioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (typeof audioContextConstructor === "function") {
      try {
        newRawContext = new audioContextConstructor();
      } catch (error) {
        console.warn("[Audio Init] Failed to construct AudioContext directly:", error);
      }
    }

    const newContext =
      newRawContext !== undefined ? new Tone.Context(newRawContext) : new Tone.Context();

    applyToneContext(newContext);

    newRawContext = newContext.rawContext as AudioContext | undefined;
    if (newRawContext?.state === "suspended") {
      try {
        await newRawContext.resume();
      } catch (error) {
        console.warn("[Audio Init] Failed to resume new AudioContext:", error);
      }
    }

    console.log("[Audio Init] Forced AudioContext reset");
  } catch (error) {
    console.warn("[Audio Init] forceAudioContextCleanup encountered an error:", error);
  }
};

const createReloadOverlay = () => {
  if (typeof document === "undefined") {
    return null;
  }

  const overlay = document.createElement("div");
  overlay.textContent = "Refreshing audio system…";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(15, 23, 42, 0.92)",
    color: "#e2e8f0",
    fontSize: "1.1rem",
    fontWeight: "600",
    zIndex: "9999",
    textAlign: "center",
    padding: "24px",
  });

  document.body.appendChild(overlay);
  return overlay;
};

export const initAudioContextWithRetries = async (): Promise<boolean> => {
  if (typeof window === "undefined") {
    return false;
  }

  console.log("[Audio Init] Starting initialization pipeline");
  await silentUnlock();
  await forceAudioContextCleanup();

  const retryDelays = [0, 250, 500, 1000];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt];
    if (delay > 0) {
      await wait(delay);
      console.log(`[Audio Init] Attempting Tone.js start (retry ${attempt + 1})`);
    } else {
      console.log("[Audio Init] Attempting Tone.js start");
    }

    try {
      await Tone.start();
      await ensureAudioContextRunning();
      const context = Tone.getContext();
      if (context.state !== "running") {
        throw new Error(`Audio context in state: ${context.state}`);
      }

      console.log(`[Audio Init] Tone.js context running (attempt ${attempt + 1})`);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < retryDelays.length - 1) {
        console.warn("[Audio Init] Retry #", attempt + 1, error);
        await forceAudioContextCleanup();
      }
    }
  }

  console.warn("[Audio Init] Exhausted Tone.js retries", lastError);

  if (isIOSPWA()) {
    console.warn("[Audio Init] Triggering reload fallback for iOS PWA");
    const overlay = createReloadOverlay();
    window.setTimeout(() => {
      if (overlay?.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
      window.location.reload();
    }, 750);
    return false;
  }

  throw (lastError instanceof Error
    ? lastError
    : new Error("Failed to initialize audio context"));
};

export const filterValueToFrequency = (value: number) => {
  const normalized = clamp(value, 0, 1);
  const frequencyLog = minLog + (maxLog - minLog) * normalized;
  return Math.exp(frequencyLog);
};

export const frequencyToFilterValue = (frequency: number) => {
  const clamped = clamp(frequency, MIN_FILTER_FREQUENCY, MAX_FILTER_FREQUENCY);
  const freqLog = Math.log(clamped);
  return (freqLog - minLog) / (maxLog - minLog);
};

export const ensureAudioContextRunning = async (): Promise<void> => {
  let rawContext = Tone.getContext().rawContext as AudioContext | undefined;

  if (!rawContext || rawContext.state === "closed") {
    console.log("Audio context closed, creating fresh context");
    await forceAudioContextCleanup();
    rawContext = Tone.getContext().rawContext as AudioContext | undefined;
  }

  if (!rawContext) {
    console.warn("[Audio Init] Unable to obtain AudioContext after cleanup");
    return;
  }

  let state: AudioContextState = rawContext.state;

  if (state === "running") {
    return;
  }

  try {
    if (state === "suspended") {
      await rawContext.resume();
      state = rawContext.state;
    }

    if (isIOSPWA() && state !== "running") {
      const buffer = rawContext.createBuffer(1, 1, rawContext.sampleRate);
      const source = rawContext.createBufferSource();
      const gainNode = rawContext.createGain();

      gainNode.gain.setValueAtTime(0, rawContext.currentTime);
      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(rawContext.destination);

      source.start();
      source.stop(rawContext.currentTime + 0.001);

      await rawContext.resume();
      state = rawContext.state;
    }

    if (state !== "running") {
      console.warn("Audio context not running after unlock attempts");
    }
  } catch (error) {
    console.warn("Audio context failed to start:", error);
  }
};


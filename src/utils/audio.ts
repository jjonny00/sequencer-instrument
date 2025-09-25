import * as Tone from "tone";

const MIN_FILTER_FREQUENCY = 80;
const MAX_FILTER_FREQUENCY = 12000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const minLog = Math.log(MIN_FILTER_FREQUENCY);
const maxLog = Math.log(MAX_FILTER_FREQUENCY);

let audioActivationPromise: Promise<boolean> | null = null;

export let audioReady =
  typeof window === "undefined"
    ? true
    : Tone.getContext().state === "running";

const updateAudioReadyFlag = (): boolean => {
  if (typeof window === "undefined") {
    audioReady = true;
    return true;
  }

  const running = Tone.getContext().state === "running";
  audioReady = running;
  return running;
};

export const activateAudio = async (): Promise<boolean> => {
  if (updateAudioReadyFlag()) {
    return true;
  }

  if (!audioActivationPromise) {
    audioActivationPromise = (async () => {
      try {
        await Tone.start();
        console.log("Tone.js audio started successfully");
      } catch (error) {
        console.warn("Tone.js failed to start:", error);
      }

      const context = Tone.getContext();
      if (context.state === "suspended") {
        try {
          await context.resume();
        } catch (resumeError) {
          console.warn("AudioContext.resume() failed:", resumeError);
        }
      }

      const running = updateAudioReadyFlag();
      audioActivationPromise = null;
      return running;
    })();
  }

  const unlocked = await audioActivationPromise;
  updateAudioReadyFlag();
  return unlocked;
};

export const initAudioContext = async (): Promise<void> => {
  const unlocked = await activateAudio();
  if (!unlocked && !audioReady) {
    throw new Error("Audio context is not running");
  }
};

export const refreshAudioReadyState = (): boolean => updateAudioReadyFlag();

export const isIOSPWA = (): boolean => {
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

declare global {
  interface Window {
    activateAudio?: () => Promise<boolean>;
  }
}

if (typeof window !== "undefined") {
  window.activateAudio = activateAudio;
}

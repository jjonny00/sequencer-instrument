import * as Tone from "tone";

const MIN_FILTER_FREQUENCY = 80;
const MAX_FILTER_FREQUENCY = 12000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const minLog = Math.log(MIN_FILTER_FREQUENCY);
const maxLog = Math.log(MAX_FILTER_FREQUENCY);

const isIOSPWA = () => {
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

export const ensureAudioContextRunning = async (): Promise<void> => {
  const context = Tone.getContext();
  const rawContext = context.rawContext as AudioContext;

  if (rawContext.state === "running") {
    return;
  }

  try {
    if (rawContext.state === "suspended") {
      await rawContext.resume();
    }

    if (isIOSPWA() && rawContext.state !== "running") {
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
    }

    if (rawContext.state !== "running") {
      console.warn("Audio context not running after unlock attempts");
    }
  } catch (error) {
    console.warn("Audio context failed to start:", error);
  }
};


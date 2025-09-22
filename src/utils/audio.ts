import * as Tone from "tone";

const MIN_FILTER_FREQUENCY = 80;
const MAX_FILTER_FREQUENCY = 12000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const minLog = Math.log(MIN_FILTER_FREQUENCY);
const maxLog = Math.log(MAX_FILTER_FREQUENCY);

export const initAudioContext = async (): Promise<void> => {
  try {
    await Tone.start();
    console.log("Tone.js audio started successfully");
  } catch (error) {
    console.warn("Tone.js failed to start:", error);
    throw error;
  }
};

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

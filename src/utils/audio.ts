import * as Tone from "tone";

const MIN_FILTER_FREQUENCY = 80;
const MAX_FILTER_FREQUENCY = 12000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const minLog = Math.log(MIN_FILTER_FREQUENCY);
const maxLog = Math.log(MAX_FILTER_FREQUENCY);

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

export const ensureAudioContextRunning = () => {
  const context = Tone.getContext();
  if (context.state === "running") {
    return Promise.resolve();
  }
  try {
    return context.resume();
  } catch {
    return Promise.resolve();
  }
};


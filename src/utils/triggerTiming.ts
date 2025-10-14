import * as Tone from "tone";

import type { Chunk } from "../chunks";

export const BASS_DEFAULT_MAX_SUSTAIN_SECONDS = Tone.Time("8n").toSeconds();

export interface StepTriggerComputationInput {
  pattern: Chunk;
  steps: Array<number | boolean | null | undefined>;
  index: number;
  stepDurationSeconds: number;
}

export interface StepTriggerOptions {
  sustainSeconds?: number;
  holdDurationSeconds: number;
}

export function computeStepTriggerOptions({
  pattern,
  steps,
  index,
  stepDurationSeconds,
}: StepTriggerComputationInput): StepTriggerOptions {
  const stepCount = steps.length || 16;
  let holdSteps = 0;
  for (let offset = 1; offset < stepCount; offset += 1) {
    const nextIndex = (index + offset) % stepCount;
    if (steps[nextIndex]) {
      break;
    }
    holdSteps += 1;
  }

  const holdDurationSeconds = (holdSteps + 1) * stepDurationSeconds;
  const hasGlide = typeof pattern.glide === "number" && pattern.glide > 0;
  const glideOverlapSeconds = hasGlide
    ? Math.max(pattern.glide ?? 0, 0.05)
    : 0;
  const sustainFloorForGlide = hasGlide
    ? holdDurationSeconds + glideOverlapSeconds
    : 0;
  const sustainCeiling = hasGlide
    ? Number.POSITIVE_INFINITY
    : holdDurationSeconds;
  const releaseControl = pattern.sustain;
  const recordedDuration =
    pattern.stepDurations && pattern.stepDurations.length > index
      ? pattern.stepDurations[index]
      : undefined;
  const isBassPattern = pattern.instrument === "bass";
  const shouldClampBassSustain =
    isBassPattern && Boolean(pattern.plucky) && !hasGlide;

  const baseSustainSeconds = (() => {
    if (
      typeof recordedDuration === "number" &&
      Number.isFinite(recordedDuration) &&
      recordedDuration > 0
    ) {
      const limitedRecorded = Math.min(recordedDuration, sustainCeiling);
      return hasGlide
        ? Math.max(limitedRecorded, sustainFloorForGlide)
        : limitedRecorded;
    }
    if (releaseControl !== undefined && releaseControl !== null) {
      const clampedRelease = Math.max(releaseControl, 0);
      const limitedRelease = shouldClampBassSustain
        ? Math.min(clampedRelease, BASS_DEFAULT_MAX_SUSTAIN_SECONDS)
        : clampedRelease;
      const boundedRelease = Math.min(limitedRelease, sustainCeiling);
      return hasGlide
        ? Math.max(boundedRelease, sustainFloorForGlide)
        : boundedRelease;
    }
    if (shouldClampBassSustain) {
      return Math.min(holdDurationSeconds, BASS_DEFAULT_MAX_SUSTAIN_SECONDS);
    }
    if (isBassPattern) {
      if (hasGlide) {
        return sustainFloorForGlide;
      }
      return undefined;
    }
    return hasGlide
      ? Math.max(holdDurationSeconds, sustainFloorForGlide)
      : holdDurationSeconds;
  })();

  const sustainSeconds = (() => {
    if (baseSustainSeconds === undefined) {
      return undefined;
    }
    const clampedForBass = shouldClampBassSustain
      ? Math.min(baseSustainSeconds, BASS_DEFAULT_MAX_SUSTAIN_SECONDS)
      : baseSustainSeconds;
    const withGlideFloor = hasGlide
      ? Math.max(clampedForBass, sustainFloorForGlide)
      : clampedForBass;
    return Math.max(0.02, withGlideFloor);
  })();

  return {
    sustainSeconds,
    holdDurationSeconds,
  };
}

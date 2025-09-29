import * as Tone from "tone";

import type { Track, TrackInstrument } from "./tracks";

export interface PatternGroup {
  id: string;
  name: string;
  tracks: Track[];
}

export interface PerformanceNote {
  time: string | number;
  note: string;
  duration: string | number;
  velocity: number;
}

export interface PerformanceTrack {
  id: string;
  instrument: TrackInstrument;
  color: string;
  notes: PerformanceNote[];
}

export interface SongRow {
  slots: (string | null)[];
  muted: boolean;
  velocity: number;
  solo?: boolean;
  performanceTrackId?: string | null;
}

export const createPatternGroupId = () =>
  `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createSongRow = (length = 0): SongRow => ({
  slots: Array.from({ length }, () => null),
  muted: false,
  velocity: 1,
  solo: false,
  performanceTrackId: null,
});

export const createPerformanceTrackId = () =>
  `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const TICKS_PER_QUARTER = Tone.Transport.PPQ;
const TICKS_PER_SIXTEENTH = TICKS_PER_QUARTER / 4;
const TICKS_PER_MEASURE = TICKS_PER_SIXTEENTH * 16;

const toTicks = (value: string | number | undefined | null): number => {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "number") {
    return value * TICKS_PER_MEASURE;
  }
  try {
    return Tone.Time(value).toTicks();
  } catch (error) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("Failed to convert time to ticks", value, error);
    }
    return 0;
  }
};

const ensurePositiveTicks = (ticks: number, fallback: number) =>
  Number.isFinite(ticks) && ticks > 0 ? ticks : fallback;

export const getPerformanceTracksSpanMeasures = (
  tracks: PerformanceTrack[]
): number => {
  let maxEndTicks = 0;

  tracks.forEach((track) => {
    track.notes?.forEach((note) => {
      const startTicks = Math.max(0, toTicks(note.time));
      const durationTicks = ensurePositiveTicks(
        toTicks(note.duration),
        TICKS_PER_SIXTEENTH
      );
      const endTicks = startTicks + durationTicks;
      if (endTicks > maxEndTicks) {
        maxEndTicks = endTicks;
      }
    });
  });

  if (maxEndTicks <= 0 || TICKS_PER_MEASURE <= 0) {
    return 0;
  }

  return Math.ceil(maxEndTicks / TICKS_PER_MEASURE);
};

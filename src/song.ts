import * as Tone from "tone";

import type { Chunk } from "./chunks";
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
  packId?: string | null;
  characterId?: string | null;
  settings?: PerformanceTrackSettings;
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

export interface PerformanceTrackSettings {
  note?: string;
  sustain?: number;
  attack?: number;
  glide?: number;
  pan?: number;
  reverb?: number;
  delay?: number;
  distortion?: number;
  bitcrusher?: number;
  filter?: number;
  chorus?: number;
  pulseRate?: string | number;
  pulseDepth?: number;
  pulseShape?: string;
  pulseMode?: "amplitude" | "filter";
  pitchBend?: number;
  style?: string;
  mode?: string;
  arpRate?: string;
  arpGate?: number;
  arpLatch?: boolean;
  arpOctaves?: number;
  arpFreeRate?: number;
  tonalCenter?: string;
  scale?: string;
  degree?: number;
  useExtensions?: boolean;
  autopilot?: boolean;
  notes?: string[];
  degrees?: number[];
  harmoniaComplexity?: "simple" | "extended" | "lush";
  harmoniaTone?: number;
  harmoniaDynamics?: number;
  harmoniaBass?: boolean;
  harmoniaArp?: boolean;
  harmoniaPatternId?: string;
  harmoniaBorrowedLabel?: string;
  harmoniaStepDegrees?: (number | null)[];
  velocityFactor?: number;
  pitchOffset?: number;
  swing?: number;
  humanize?: number;
}

const cloneOptionalArray = <T,>(values: T[] | undefined) =>
  values ? values.slice() : undefined;

export const clonePerformanceTrackSettings = (
  settings: PerformanceTrackSettings | undefined
): PerformanceTrackSettings | undefined => {
  if (!settings) {
    return undefined;
  }
  return {
    ...settings,
    notes: cloneOptionalArray(settings.notes),
    degrees: cloneOptionalArray(settings.degrees),
    harmoniaStepDegrees: cloneOptionalArray(settings.harmoniaStepDegrees),
  };
};

export const createPerformanceSettingsSnapshot = (
  pattern: Chunk
): PerformanceTrackSettings => ({
  note: pattern.note,
  sustain: pattern.sustain,
  attack: pattern.attack,
  glide: pattern.glide,
  pan: pattern.pan,
  reverb: pattern.reverb,
  delay: pattern.delay,
  distortion: pattern.distortion,
  bitcrusher: pattern.bitcrusher,
  filter: pattern.filter,
  chorus: pattern.chorus,
  pulseRate: pattern.pulseRate,
  pulseDepth: pattern.pulseDepth,
  pulseShape: pattern.pulseShape,
  pulseMode: pattern.pulseMode,
  pitchBend: pattern.pitchBend,
  style: pattern.style,
  mode: pattern.mode,
  arpRate: pattern.arpRate,
  arpGate: pattern.arpGate,
  arpLatch: pattern.arpLatch,
  arpOctaves: pattern.arpOctaves,
  arpFreeRate: pattern.arpFreeRate,
  tonalCenter: pattern.tonalCenter,
  scale: pattern.scale,
  degree: pattern.degree,
  useExtensions: pattern.useExtensions,
  autopilot: pattern.autopilot,
  notes: cloneOptionalArray(pattern.notes),
  degrees: cloneOptionalArray(pattern.degrees),
  harmoniaComplexity: pattern.harmoniaComplexity,
  harmoniaTone: pattern.harmoniaTone,
  harmoniaDynamics: pattern.harmoniaDynamics,
  harmoniaBass: pattern.harmoniaBass,
  harmoniaArp: pattern.harmoniaArp,
  harmoniaPatternId: pattern.harmoniaPatternId,
  harmoniaBorrowedLabel: pattern.harmoniaBorrowedLabel,
  harmoniaStepDegrees: cloneOptionalArray(pattern.harmoniaStepDegrees),
  velocityFactor: pattern.velocityFactor,
  pitchOffset: pattern.pitchOffset,
  swing: pattern.swing,
  humanize: pattern.humanize,
});

export const performanceSettingsToChunk = (
  instrument: TrackInstrument,
  settings: PerformanceTrackSettings | undefined,
  options?: {
    id?: string;
    name?: string;
    characterId?: string | null;
  }
): Chunk | undefined => {
  if (!instrument) {
    return undefined;
  }
  const chunk: Chunk = {
    id:
      options?.id ??
      `performance-${instrument}-${Math.random().toString(36).slice(2, 8)}`,
    name: options?.name ?? `${instrument}-performance`,
    instrument,
    steps: [],
  };
  if (options?.characterId !== undefined && options.characterId !== null) {
    chunk.characterId = options.characterId;
  }
  if (!settings) {
    return chunk;
  }
  if (settings.note !== undefined) chunk.note = settings.note;
  if (settings.sustain !== undefined) chunk.sustain = settings.sustain;
  if (settings.attack !== undefined) chunk.attack = settings.attack;
  if (settings.glide !== undefined) chunk.glide = settings.glide;
  if (settings.pan !== undefined) chunk.pan = settings.pan;
  if (settings.reverb !== undefined) chunk.reverb = settings.reverb;
  if (settings.delay !== undefined) chunk.delay = settings.delay;
  if (settings.distortion !== undefined)
    chunk.distortion = settings.distortion;
  if (settings.bitcrusher !== undefined)
    chunk.bitcrusher = settings.bitcrusher;
  if (settings.filter !== undefined) chunk.filter = settings.filter;
  if (settings.chorus !== undefined) chunk.chorus = settings.chorus;
  if (settings.pulseRate !== undefined) chunk.pulseRate = settings.pulseRate;
  if (settings.pulseDepth !== undefined) chunk.pulseDepth = settings.pulseDepth;
  if (settings.pulseShape !== undefined) chunk.pulseShape = settings.pulseShape;
  if (settings.pulseMode !== undefined) chunk.pulseMode = settings.pulseMode;
  if (settings.pitchBend !== undefined) chunk.pitchBend = settings.pitchBend;
  if (settings.style !== undefined) chunk.style = settings.style;
  if (settings.mode !== undefined) chunk.mode = settings.mode;
  if (settings.arpRate !== undefined) chunk.arpRate = settings.arpRate;
  if (settings.arpGate !== undefined) chunk.arpGate = settings.arpGate;
  if (settings.arpLatch !== undefined) chunk.arpLatch = settings.arpLatch;
  if (settings.arpOctaves !== undefined)
    chunk.arpOctaves = settings.arpOctaves;
  if (settings.arpFreeRate !== undefined)
    chunk.arpFreeRate = settings.arpFreeRate;
  if (settings.tonalCenter !== undefined)
    chunk.tonalCenter = settings.tonalCenter;
  if (settings.scale !== undefined) chunk.scale = settings.scale;
  if (settings.degree !== undefined) chunk.degree = settings.degree;
  if (settings.useExtensions !== undefined)
    chunk.useExtensions = settings.useExtensions;
  if (settings.autopilot !== undefined) chunk.autopilot = settings.autopilot;
  if (settings.notes) chunk.notes = cloneOptionalArray(settings.notes);
  if (settings.degrees) chunk.degrees = cloneOptionalArray(settings.degrees);
  if (settings.harmoniaComplexity !== undefined)
    chunk.harmoniaComplexity = settings.harmoniaComplexity;
  if (settings.harmoniaTone !== undefined)
    chunk.harmoniaTone = settings.harmoniaTone;
  if (settings.harmoniaDynamics !== undefined)
    chunk.harmoniaDynamics = settings.harmoniaDynamics;
  if (settings.harmoniaBass !== undefined)
    chunk.harmoniaBass = settings.harmoniaBass;
  if (settings.harmoniaArp !== undefined)
    chunk.harmoniaArp = settings.harmoniaArp;
  if (settings.harmoniaPatternId !== undefined)
    chunk.harmoniaPatternId = settings.harmoniaPatternId;
  if (settings.harmoniaBorrowedLabel !== undefined)
    chunk.harmoniaBorrowedLabel = settings.harmoniaBorrowedLabel;
  if (settings.harmoniaStepDegrees)
    chunk.harmoniaStepDegrees = cloneOptionalArray(
      settings.harmoniaStepDegrees
    );
  if (settings.velocityFactor !== undefined)
    chunk.velocityFactor = settings.velocityFactor;
  if (settings.pitchOffset !== undefined)
    chunk.pitchOffset = settings.pitchOffset;
  if (settings.swing !== undefined) chunk.swing = settings.swing;
  if (settings.humanize !== undefined) chunk.humanize = settings.humanize;
  return chunk;
};

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

export type PulseShape = "sine" | "square" | "triangle";

export const DEFAULT_PULSE_RATE = "8n";
export const DEFAULT_PULSE_DEPTH = 0.9;
export const DEFAULT_PULSE_SHAPE: PulseShape = "square";
export const DEFAULT_PULSE_FILTER = false;

export interface NoteEvent {
  time: number;
  duration: number;
  note: string;
  velocity: number;
}

export interface Chunk {
  id: string;
  name: string;
  instrument: string;
  characterId?: string;
  steps: number[];
  velocities?: number[];
  pitches?: number[];
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
  timingMode?: "sync" | "free";
  tonalCenter?: string;
  scale?: string;
  degree?: number;
  velocityFactor?: number;
  pitchOffset?: number;
  swing?: number;
  humanize?: number;
  notes?: string[];
  degrees?: number[];
  pitchBend?: number;
  style?: string;
  mode?: string;
  arpRate?: string;
  arpGate?: number;
  arpLatch?: boolean;
  arpOctaves?: number;
  arpFreeRate?: number;
  useExtensions?: boolean;
  autopilot?: boolean;
  noteEvents?: NoteEvent[];
  noteLoopLength?: number;
  pulseRate?: string;
  pulseDepth?: number;
  pulseShape?: PulseShape;
  pulseFilter?: boolean;
  harmoniaComplexity?: "simple" | "extended" | "lush";
  harmoniaTone?: number;
  harmoniaDynamics?: number;
  harmoniaBass?: boolean;
  harmoniaArp?: boolean;
  harmoniaPatternId?: string;
  harmoniaBorrowedLabel?: string;
  harmoniaStepDegrees?: (number | null)[];
}

export const ensurePulseDefaults = (chunk: Chunk): Chunk => {
  if (chunk.instrument !== "pulse") {
    return chunk;
  }

  let changed = false;
  const next: Partial<Chunk> = {};

  if (chunk.pulseRate === undefined) {
    next.pulseRate = DEFAULT_PULSE_RATE;
    changed = true;
  }
  if (chunk.pulseDepth === undefined) {
    next.pulseDepth = DEFAULT_PULSE_DEPTH;
    changed = true;
  }
  if (chunk.pulseShape === undefined) {
    next.pulseShape = DEFAULT_PULSE_SHAPE;
    changed = true;
  }
  if (chunk.pulseFilter === undefined) {
    next.pulseFilter = DEFAULT_PULSE_FILTER;
    changed = true;
  }

  return changed ? { ...chunk, ...next } : chunk;
};


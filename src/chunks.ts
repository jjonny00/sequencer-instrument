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
  kickPitchDecay?: number;
  kickOctaves?: number;
  kickDecay?: number;
  kickRelease?: number;
  kickNoiseDb?: number;
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
  harmoniaComplexity?: "simple" | "extended" | "lush";
  harmoniaTone?: number;
  harmoniaDynamics?: number;
  harmoniaBass?: boolean;
  harmoniaArp?: boolean;
  harmoniaPatternId?: string;
  harmoniaBorrowedLabel?: string;
  harmoniaStepDegrees?: (number | null)[];
}


export interface Chunk {
  id: string;
  name: string;
  instrument: string;
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
  useExtensions?: boolean;
  autopilot?: boolean;
}


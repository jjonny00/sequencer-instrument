export interface Chunk {
  id: string;
  name: string;
  instrument: string;
  steps: number[];
  velocities?: number[];
  pitches?: number[];
  note?: string;
  sustain?: number;
  notes?: string[];
  degrees?: number[];
  pitchBend?: number;
  style?: string;
  mode?: string;
}


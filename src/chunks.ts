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
  style?: string;
  mode?: string;
}


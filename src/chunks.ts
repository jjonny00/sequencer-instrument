export interface Chunk {
  id: string;
  name: string;
  instrument: string;
  steps: number[];
  note?: string;
  velocity?: number;
}


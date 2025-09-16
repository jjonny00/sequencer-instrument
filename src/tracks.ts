import type { Chunk } from "./chunks";

export type TriggerMap = Record<
  string,
  (
    time: number,
    velocity?: number,
    pitch?: number,
    note?: string,
    sustain?: number,
    chunk?: Chunk
  ) => void
>;

export interface Track {
  id: number;
  name: string;
  instrument: keyof TriggerMap;
  pattern: Chunk | null;
  muted: boolean;
}

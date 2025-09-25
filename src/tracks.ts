import type { Chunk } from "./chunks";

export type TriggerMap = Record<
  string,
  (
    time: number,
    velocity?: number,
    pitch?: number,
    note?: string,
    sustain?: number,
    chunk?: Chunk,
    characterId?: string
  ) => void
>;

export type TrackInstrument = keyof TriggerMap | "";

export interface TrackSource {
  packId: string;
  instrumentId: string;
  characterId: string;
  presetId?: string | null;
}

export interface Track {
  id: number;
  name: string;
  instrument: TrackInstrument;
  pattern: Chunk | null;
  muted: boolean;
  source?: TrackSource;
  style?: string | null;
}

export const createTriggerKey = (packId: string, instrumentId: string) =>
  `${packId}::${instrumentId}`;

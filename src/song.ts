import type { Track } from "./tracks";

export interface PerformanceNote {
  time: string;
  note: string;
  duration: string;
  velocity: number;
}

export interface PerformanceTrack {
  id: string;
  instrument: string;
  channel?: number;
  notes: PerformanceNote[];
}

export interface PatternGroup {
  id: string;
  name: string;
  tracks: Track[];
}

export interface SongRow {
  slots: (string | null)[];
  muted: boolean;
  velocity: number;
}

export const createPatternGroupId = () =>
  `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createSongRow = (length = 0): SongRow => ({
  slots: Array.from({ length }, () => null),
  muted: false,
  velocity: 1,
});

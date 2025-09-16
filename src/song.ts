import type { Track } from "./tracks";

export interface PatternGroup {
  id: string;
  name: string;
  trackIds: number[];
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

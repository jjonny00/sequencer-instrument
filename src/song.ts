import type { Track, TrackInstrument } from "./tracks";

export interface PatternGroup {
  id: string;
  name: string;
  tracks: Track[];
}

export interface PerformanceNote {
  time: number;
  note: string;
  duration: number;
  velocity: number;
}

export interface PerformanceTrack {
  id: string;
  instrument: TrackInstrument;
  color: string;
  notes: PerformanceNote[];
}

export interface SongRow {
  slots: (string | null)[];
  muted: boolean;
  velocity: number;
  performanceTrackId?: string | null;
}

export const createPatternGroupId = () =>
  `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const createSongRow = (length = 0): SongRow => ({
  slots: Array.from({ length }, () => null),
  muted: false,
  velocity: 1,
  performanceTrackId: null,
});

export const createPerformanceTrackId = () =>
  `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

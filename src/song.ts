import type { Track } from "./tracks";

export interface PatternGroup {
  id: string;
  name: string;
  trackIds: number[];
  tracks: Track[];
}

export const createPatternGroupId = () =>
  `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

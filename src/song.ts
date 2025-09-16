export interface PatternGroup {
  id: string;
  name: string;
  trackIds: number[];
  autoPopulate: boolean;
}

export const createPatternGroupId = () =>
  `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

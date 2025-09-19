export const SCALE_INTERVALS = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
  HarmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  MelodicMinor: [0, 2, 3, 5, 7, 9, 11],
} as const;

export type ScaleName = keyof typeof SCALE_INTERVALS;

export const SCALE_OPTIONS = Object.keys(SCALE_INTERVALS) as ScaleName[];

export const isScaleName = (
  value: string | undefined | null
): value is ScaleName =>
  value !== undefined && value !== null && SCALE_OPTIONS.includes(value as ScaleName);

export const getScaleDegreeOffset = (
  intervals: readonly number[],
  degreeIndex: number
) => {
  if (!intervals.length) return 0;
  const length = intervals.length;
  const normalizedIndex = ((degreeIndex % length) + length) % length;
  const base = intervals[normalizedIndex];
  const octaves = Math.floor((degreeIndex - normalizedIndex) / length);
  return base + octaves * 12;
};


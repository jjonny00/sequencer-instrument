import type { InstrumentCharacter } from "../../packs";
import type { ScaleName } from "../../music/scales";

export type HarmoniaComplexity = "simple" | "extended" | "lush";

export type HarmoniaCharacterId =
  | "simple"
  | "extended"
  | "lush"
  | "borrowed";

export type HarmoniaPatternId =
  | "basic-progression"
  | "descending-line"
  | "circle-of-fifths";

export type HarmoniaScaleDegree = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface HarmoniaControlState {
  complexity: HarmoniaComplexity;
  tone: number;
  dynamics: number;
  bassEnabled: boolean;
  arpEnabled: boolean;
  patternId?: HarmoniaPatternId;
}

export interface HarmoniaChordVoicing {
  label: string;
  intervals: readonly number[];
  description?: string;
  borrowed?: boolean;
  source?: string;
  rootOffset?: number;
}

export interface HarmoniaChordLibraryEntry {
  degree: HarmoniaScaleDegree;
  romanNumeral: string;
  diatonic: Record<HarmoniaComplexity, HarmoniaChordVoicing>;
  borrowed?: readonly HarmoniaChordVoicing[];
}

export interface HarmoniaCharacterPreset extends InstrumentCharacter {
  complexity: HarmoniaComplexity;
  allowBorrowed: boolean;
}

export interface HarmoniaPatternPreset {
  id: HarmoniaPatternId;
  name: string;
  description: string;
  degrees: readonly HarmoniaScaleDegree[];
}

export interface HarmoniaChordResolution {
  root: string;
  notes: string[];
  intervals: number[];
  romanNumeral: string;
  borrowed: boolean;
  voicingLabel: string;
}

export interface HarmoniaChordRequest {
  tonalCenter: string;
  scale: ScaleName;
  degree: HarmoniaScaleDegree;
  complexity: HarmoniaComplexity;
  allowBorrowed?: boolean;
  preferredVoicingLabel?: string;
}


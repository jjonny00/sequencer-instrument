import type {
  HarmoniaCharacterPreset,
  HarmoniaChordLibraryEntry,
  HarmoniaChordVoicing,
  HarmoniaComplexity,
  HarmoniaControlState,
  HarmoniaPatternPreset,
} from "./types";

const createVoicing = (
  label: string,
  intervals: number[],
  description?: string,
  borrowed = false,
  source?: string,
  rootOffset = 0
): HarmoniaChordVoicing => ({
  label,
  intervals,
  description,
  borrowed,
  source,
  rootOffset,
});

const lushStack = (base: number[]) => {
  const extended = base.slice();
  if (!extended.includes(11)) {
    extended.push(11);
  }
  extended.push(14, 17, 21);
  return extended.sort((a, b) => a - b);
};

const createDiatonicSet = (
  simpleIntervals: number[],
  extendedIntervals: number[],
  lushBase: number[],
  labels: { simple: string; extended: string; lush: string },
  descriptions?: { simple?: string; extended?: string; lush?: string }
): Record<HarmoniaComplexity, HarmoniaChordVoicing> => ({
  simple: createVoicing(labels.simple, simpleIntervals, descriptions?.simple),
  extended: createVoicing(
    labels.extended,
    extendedIntervals,
    descriptions?.extended
  ),
  lush: createVoicing(labels.lush, lushStack(lushBase), descriptions?.lush),
});

export const HARMONIA_CHARACTER_PRESETS: HarmoniaCharacterPreset[] = [
  {
    id: "simple",
    name: "Simple",
    description: "Triads only with warm pad tone.",
    type: "Harmonia",
    complexity: "simple",
    allowBorrowed: false,
  },
  {
    id: "extended",
    name: "Extended",
    description: "Adds seventh chords for richer harmony.",
    type: "Harmonia",
    complexity: "extended",
    allowBorrowed: false,
  },
  {
    id: "lush",
    name: "Lush",
    description: "Stacked extensions reaching 13ths for cinematic pads.",
    type: "Harmonia",
    complexity: "lush",
    allowBorrowed: false,
  },
  {
    id: "borrowed",
    name: "Borrowed",
    description: "Modal interchange options woven into lush voicings.",
    type: "Harmonia",
    complexity: "lush",
    allowBorrowed: true,
  },
];

export const HARMONIA_PATTERN_PRESETS: HarmoniaPatternPreset[] = [
  {
    id: "basic-progression",
    name: "Basic Progression",
    description: "Classic I–V–vi–IV pop sequence.",
    degrees: [0, 4, 5, 3],
  },
  {
    id: "descending-line",
    name: "Descending Line",
    description: "Falling bass line: vi–V–IV–iii.",
    degrees: [5, 4, 3, 2],
  },
  {
    id: "circle-of-fifths",
    name: "Circle of Fifths",
    description: "Full cycle through dominant motions.",
    degrees: [0, 3, 6, 2, 5, 1, 4, 0],
  },
];

export const HARMONIA_DEFAULT_CONTROLS: HarmoniaControlState = {
  complexity: "simple",
  tone: 0.7,
  dynamics: 0.8,
  bassEnabled: true,
  arpEnabled: false,
};

const borrowedFromParallelMinor = (
  label: string,
  intervals: number[],
  rootOffset = 0
) =>
  createVoicing(
    label,
    intervals,
    "Borrowed from parallel minor mode.",
    true,
    "parallel-minor",
    rootOffset
  );

const borrowedFromDorian = (label: string, intervals: number[], rootOffset = 0) =>
  createVoicing(label, intervals, "Borrowed from Dorian mode.", true, "dorian", rootOffset);

export const HARMONIA_CHORD_LIBRARY: HarmoniaChordLibraryEntry[] = [
  {
    degree: 0,
    romanNumeral: "I",
    diatonic: createDiatonicSet(
      [0, 4, 7],
      [0, 4, 7, 11],
      [0, 4, 7, 11],
      { simple: "I", extended: "IMaj7", lush: "IMaj13" },
      {
        simple: "Tonic major triad.",
        extended: "Major seventh tonic chord.",
        lush: "Rich major 13th voicing.",
      }
    ),
    borrowed: [
      borrowedFromParallelMinor("i", [0, 3, 7]),
      createVoicing(
        "Iadd9",
        [0, 4, 7, 14],
        "Adds ninth color for airy tonic.",
        true,
        "lydian"
      ),
    ],
  },
  {
    degree: 1,
    romanNumeral: "ii",
    diatonic: createDiatonicSet(
      [0, 3, 7],
      [0, 3, 7, 10],
      [0, 3, 7, 10],
      { simple: "ii", extended: "ii7", lush: "ii11" },
      {
        simple: "Supertonic minor triad.",
        extended: "Supertonic minor seventh.",
        lush: "Suspended ii chord with 11th.",
      }
    ),
    borrowed: [
      borrowedFromParallelMinor("ii°", [0, 3, 6]),
      borrowedFromDorian("II", [0, 4, 7]),
    ],
  },
  {
    degree: 2,
    romanNumeral: "iii",
    diatonic: createDiatonicSet(
      [0, 3, 7],
      [0, 3, 7, 10],
      [0, 3, 7, 10],
      { simple: "iii", extended: "iii7", lush: "iii9" },
      {
        simple: "Mediant minor triad.",
        extended: "Mediant minor seventh chord.",
        lush: "Mediant with added 9th color.",
      }
    ),
    borrowed: [
      borrowedFromParallelMinor("♭III", [0, 4, 7], -1),
    ],
  },
  {
    degree: 3,
    romanNumeral: "IV",
    diatonic: createDiatonicSet(
      [0, 4, 7],
      [0, 4, 7, 11],
      [0, 4, 7, 11],
      { simple: "IV", extended: "IVMaj7", lush: "IV13" },
      {
        simple: "Subdominant major triad.",
        extended: "Subdominant major seventh.",
        lush: "Expansive subdominant with 13th.",
      }
    ),
    borrowed: [
      borrowedFromParallelMinor("iv", [0, 3, 7]),
      borrowedFromParallelMinor("iv7", [0, 3, 7, 10]),
    ],
  },
  {
    degree: 4,
    romanNumeral: "V",
    diatonic: createDiatonicSet(
      [0, 4, 7],
      [0, 4, 7, 10],
      [0, 4, 7, 10],
      { simple: "V", extended: "V7", lush: "V13" },
      {
        simple: "Dominant major triad.",
        extended: "Dominant seventh chord.",
        lush: "Dominant with full extensions.",
      }
    ),
    borrowed: [
      createVoicing(
        "Vsus4",
        [0, 5, 7, 10],
        "Suspended dominant for tension.",
        true,
        "mixolydian"
      ),
      borrowedFromParallelMinor("♭VII", [0, 4, 7], 3),
    ],
  },
  {
    degree: 5,
    romanNumeral: "vi",
    diatonic: createDiatonicSet(
      [0, 3, 7],
      [0, 3, 7, 10],
      [0, 3, 7, 10],
      { simple: "vi", extended: "vi7", lush: "vi9" },
      {
        simple: "Submediant minor triad.",
        extended: "Submediant minor seventh.",
        lush: "Submediant with ninth.",
      }
    ),
    borrowed: [
      borrowedFromParallelMinor("♭VI", [0, 4, 7], -1),
    ],
  },
  {
    degree: 6,
    romanNumeral: "vii°",
    diatonic: createDiatonicSet(
      [0, 3, 6],
      [0, 3, 6, 10],
      [0, 3, 6, 10],
      { simple: "vii°", extended: "viiø7", lush: "viiø11" },
      {
        simple: "Leading-tone diminished triad.",
        extended: "Half-diminished seventh.",
        lush: "Half-diminished with 11th.",
      }
    ),
    borrowed: [
      borrowedFromParallelMinor("vii°7", [0, 3, 6, 9]),
      createVoicing(
        "♭VIIadd6",
        [0, 4, 7, 9],
        "Major flat-seven sonority for lift.",
        true,
        "mixolydian",
        -1
      ),
    ],
  },
];

export const HARMONIA_SCALE_DEGREE_LABELS = HARMONIA_CHORD_LIBRARY.map(
  (entry) => entry.romanNumeral
);


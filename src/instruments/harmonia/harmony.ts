import * as Tone from "tone";

import { getScaleDegreeOffset, SCALE_INTERVALS } from "../../music/scales";
import {
  HARMONIA_CHORD_LIBRARY,
  HARMONIA_DEFAULT_CONTROLS,
  HARMONIA_SCALE_DEGREE_LABELS,
} from "./constants";
import type {
  HarmoniaChordLibraryEntry,
  HarmoniaChordRequest,
  HarmoniaChordResolution,
  HarmoniaChordVoicing,
  HarmoniaComplexity,
  HarmoniaControlState,
  HarmoniaScaleDegree,
} from "./types";

export const HARMONIA_COMPLEXITY_ORDER: HarmoniaComplexity[] = [
  "simple",
  "extended",
  "lush",
];

export const clampControlValue = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

export const normalizeControlState = (
  state?: Partial<HarmoniaControlState>
): HarmoniaControlState => ({
  complexity: state?.complexity ?? HARMONIA_DEFAULT_CONTROLS.complexity,
  tone: clampControlValue(state?.tone ?? HARMONIA_DEFAULT_CONTROLS.tone),
  dynamics: clampControlValue(
    state?.dynamics ?? HARMONIA_DEFAULT_CONTROLS.dynamics
  ),
  bassEnabled: state?.bassEnabled ?? HARMONIA_DEFAULT_CONTROLS.bassEnabled,
  arpEnabled: state?.arpEnabled ?? HARMONIA_DEFAULT_CONTROLS.arpEnabled,
  patternId: state?.patternId,
});

const findLibraryEntry = (degree: HarmoniaScaleDegree): HarmoniaChordLibraryEntry => {
  const entry = HARMONIA_CHORD_LIBRARY.find((candidate) => candidate.degree === degree);
  if (entry) return entry;
  return HARMONIA_CHORD_LIBRARY[0];
};

const selectVoicing = (
  entry: HarmoniaChordLibraryEntry,
  complexity: HarmoniaComplexity,
  allowBorrowed?: boolean,
  preferredLabel?: string
): HarmoniaChordVoicing => {
  const diatonic = entry.diatonic[complexity] ?? entry.diatonic.simple;
  if (!allowBorrowed || !entry.borrowed?.length) {
    return diatonic;
  }
  if (preferredLabel) {
    const preferred = entry.borrowed.find(
      (candidate) => candidate.label.toLowerCase() === preferredLabel.toLowerCase()
    );
    if (preferred) {
      return preferred;
    }
  }
  return entry.borrowed[0];
};

export const resolveHarmoniaChord = (
  request: HarmoniaChordRequest
): HarmoniaChordResolution => {
  const entry = findLibraryEntry(request.degree);
  const voicing = selectVoicing(
    entry,
    request.complexity,
    request.allowBorrowed,
    request.preferredVoicingLabel
  );
  const intervals = SCALE_INTERVALS[request.scale] ?? SCALE_INTERVALS.Major;
  const rootOffset = getScaleDegreeOffset(intervals, entry.degree) + (voicing.rootOffset ?? 0);
  const tonalCenterMidi = Tone.Frequency(request.tonalCenter).toMidi();
  const chordRootMidi = tonalCenterMidi + rootOffset;
  const chordMidiNotes = voicing.intervals.map((interval) => chordRootMidi + interval);
  const chordNotes = chordMidiNotes.map((value) => Tone.Frequency(value, "midi").toNote());
  return {
    root: Tone.Frequency(chordRootMidi, "midi").toNote(),
    notes: chordNotes,
    intervals: voicing.intervals.slice(),
    romanNumeral: entry.romanNumeral,
    borrowed: Boolean(voicing.borrowed),
    voicingLabel: voicing.label,
  };
};

export const listHarmoniaDegreeLabels = () => HARMONIA_SCALE_DEGREE_LABELS.slice();

export const listBorrowedOptions = (degree: HarmoniaScaleDegree) => {
  const entry = findLibraryEntry(degree);
  if (!entry.borrowed) return [];
  return entry.borrowed.map((voicing) => ({
    label: voicing.label,
    description: voicing.description,
    source: voicing.source,
  }));
};

export const describeHarmoniaChord = (resolution: HarmoniaChordResolution) =>
  `${resolution.romanNumeral} (${resolution.voicingLabel}) → ${resolution.notes.join(
    " • "
  )}`;


import * as Tone from "tone";

import type { Chunk } from "../../chunks";
import { filterValueToFrequency } from "../../utils/audio";
import { isScaleName, type ScaleName } from "../../music/scales";
import {
  HARMONIA_CHARACTER_PRESETS,
  HARMONIA_DEFAULT_CONTROLS,
  HARMONIA_PATTERN_IDS,
} from "./constants";
import {
  clampControlValue,
  normalizeControlState,
  resolveHarmoniaChord,
} from "./harmony";
import type {
  HarmoniaCharacterId,
  HarmoniaComplexity,
  HarmoniaControlState,
  HarmoniaPatternId,
  HarmoniaScaleDegree,
} from "./types";

type ToneLike = Pick<
  typeof Tone,
  "PolySynth" | "Filter" | "Volume" | "Frequency" | "Time"
>;

const isHarmoniaPatternId = (
  value: unknown
): value is HarmoniaPatternId =>
  typeof value === "string" &&
  (HARMONIA_PATTERN_IDS as readonly string[]).includes(
    value as HarmoniaPatternId
  );

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export interface HarmoniaNodes {
  synth: Tone.PolySynth;
  filter: Tone.Filter;
  volume: Tone.Volume;
}

const resolveCharacterPreset = (characterId?: HarmoniaCharacterId | null) => {
  if (!characterId) return undefined;
  return HARMONIA_CHARACTER_PRESETS.find((preset) => preset.id === characterId);
};

const deriveControlState = (
  chunk?: Chunk,
  characterId?: HarmoniaCharacterId | null
): HarmoniaControlState => {
  const preset = resolveCharacterPreset(characterId);
  const complexity =
    (chunk?.harmoniaComplexity as HarmoniaComplexity | undefined) ??
    preset?.complexity ??
    HARMONIA_DEFAULT_CONTROLS.complexity;
  return normalizeControlState({
    complexity,
    tone: chunk?.harmoniaTone ?? undefined,
    dynamics: chunk?.harmoniaDynamics ?? undefined,
    bassEnabled: chunk?.harmoniaBass ?? undefined,
    arpEnabled: chunk?.harmoniaArp ?? undefined,
    patternId: isHarmoniaPatternId(chunk?.harmoniaPatternId)
      ? chunk?.harmoniaPatternId
      : undefined,
  });
};

const deriveScaleName = (candidate?: string | null): ScaleName => {
  if (candidate && isScaleName(candidate)) {
    return candidate as ScaleName;
  }
  return "Major";
};

const deriveDegree = (value?: number | null): HarmoniaScaleDegree => {
  const clamped = clamp(Math.round(value ?? 0), 0, 6);
  return clamped as HarmoniaScaleDegree;
};

const deriveResolution = (
  chunk?: Chunk,
  controls?: HarmoniaControlState,
  characterId?: HarmoniaCharacterId | null
) => {
  const tonalCenter = chunk?.tonalCenter ?? chunk?.note ?? "C4";
  const scale = deriveScaleName(chunk?.scale);
  const degree = deriveDegree(chunk?.degree);
  const complexity = controls?.complexity ?? HARMONIA_DEFAULT_CONTROLS.complexity;
  const preset = resolveCharacterPreset(characterId);
  const allowBorrowed =
    preset?.allowBorrowed ?? Boolean(chunk?.harmoniaBorrowedLabel);
  const preferredVoicingLabel = chunk?.harmoniaBorrowedLabel ?? undefined;
  return resolveHarmoniaChord({
    tonalCenter,
    scale,
    degree,
    complexity,
    allowBorrowed,
    preferredVoicingLabel,
  });
};

export const createHarmoniaNodes = (
  tone: ToneLike = Tone as ToneLike
): HarmoniaNodes => {
  const synth = new tone.PolySynth();
  const settable = synth as unknown as {
    set?: (values: Record<string, unknown>) => void;
  };
  settable.set?.({
    maxPolyphony: 16,
    oscillator: { type: "triangle" },
    envelope: { attack: 0.15, decay: 0.4, sustain: 0.75, release: 1.8 },
  });
  const filter = new tone.Filter({
    type: "lowpass",
    frequency: filterValueToFrequency(HARMONIA_DEFAULT_CONTROLS.tone),
    Q: 0.8,
  });
  const volume = new tone.Volume(-8);
  synth.connect(filter);
  filter.connect(volume);
  return { synth, filter, volume };
};

export interface HarmoniaTriggerOptions {
  nodes: HarmoniaNodes;
  time: number;
  velocity?: number;
  sustain?: number;
  chunk?: Chunk;
  characterId?: string | null;
}

export const triggerHarmoniaChord = ({
  nodes,
  time,
  velocity = 1,
  sustain,
  chunk,
  characterId,
}: HarmoniaTriggerOptions) => {
  const controls = deriveControlState(chunk, characterId as HarmoniaCharacterId);
  const resolution = deriveResolution(chunk, controls, characterId as HarmoniaCharacterId);

  const chordNotes = chunk?.notes?.length
    ? chunk.notes.slice()
    : resolution.notes.slice();

  if (chordNotes.length === 0 && resolution.root) {
    chordNotes.push(resolution.root);
  }

  if (controls.bassEnabled && resolution.root) {
    const bassNote = Tone.Frequency(resolution.root).transpose(-12).toNote();
    chordNotes.unshift(bassNote);
  }

  const filterValue = clampControlValue(
    chunk?.harmoniaTone ?? chunk?.filter ?? controls.tone
  );
  const targetFrequency = filterValueToFrequency(filterValue);
  nodes.filter.frequency.rampTo(targetFrequency, 0.05);

  const level = clamp(velocity, 0, 1);
  const hold = Math.max(sustain ?? chunk?.sustain ?? 1.6, 0.1);

  if (!controls.arpEnabled || chordNotes.length <= 1) {
    nodes.synth.triggerAttackRelease(chordNotes, hold, time, level);
    return;
  }

  const stepDuration = Math.min(
    hold / Math.max(chordNotes.length, 1),
    Tone.Time("16n").toSeconds()
  );
  const noteDuration = Math.max(stepDuration * 0.9, hold * 0.4);

  chordNotes.forEach((note, index) => {
    const start = time + index * stepDuration;
    nodes.synth.triggerAttackRelease(note, noteDuration, start, level);
  });
};

export const disposeHarmoniaNodes = (nodes: HarmoniaNodes) => {
  nodes.synth.dispose();
  nodes.filter.dispose();
  nodes.volume.dispose();
};

import * as Tone from "tone";

import type { Chunk } from "../../chunks";
import type { EffectSpec, InstrumentCharacter } from "../../packs";
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
> &
  Record<string, unknown>;

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
  effects: Tone.ToneAudioNode[];
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

export const HARMONIA_BASE_VOLUME_DB = -8;

const resolveHarmoniaOptions = (
  character?: InstrumentCharacter
): {
  synth: Record<string, unknown>;
  filter: Record<string, unknown>;
  volume: number;
  effects: EffectSpec[];
} => {
  const rawOptions = (character?.options ?? {}) as Record<string, unknown>;
  const synthOptions =
    (rawOptions.synth as Record<string, unknown> | undefined) ?? rawOptions;
  const filterOptions =
    (rawOptions.filter as Record<string, unknown> | undefined) ?? {};
  const volumeOption =
    typeof rawOptions.volume === "number" ? rawOptions.volume : undefined;
  const effectSpecs = Array.isArray(character?.effects)
    ? (character?.effects as EffectSpec[])
    : [];
  return {
    synth: synthOptions,
    filter: filterOptions,
    volume: volumeOption ?? HARMONIA_BASE_VOLUME_DB,
    effects: effectSpecs,
  };
};

const buildEffectChain = (
  tone: ToneLike,
  source: Tone.ToneAudioNode,
  effects: EffectSpec[]
): { tail: Tone.ToneAudioNode; nodes: Tone.ToneAudioNode[] } => {
  if (!effects.length) {
    return { tail: source, nodes: [] };
  }
  const nodes: Tone.ToneAudioNode[] = [];
  let current: Tone.ToneAudioNode = source;
  effects.forEach((effect) => {
    const EffectCtor = (
      tone as unknown as Record<
        string,
        new (opts?: Record<string, unknown>) => Tone.ToneAudioNode
      >
    )[effect.type];
    if (!EffectCtor) {
      return;
    }
    const effectNode = new EffectCtor(effect.options ?? {});
    const maybeStart = effectNode as unknown as { start?: () => void };
    maybeStart.start?.();
    current.connect(effectNode);
    nodes.push(effectNode);
    current = effectNode;
  });
  return { tail: current, nodes };
};

export const createHarmoniaNodes = (
  tone: ToneLike = Tone as ToneLike,
  character?: InstrumentCharacter
): HarmoniaNodes => {
  const synth = new tone.PolySynth();
  const settable = synth as unknown as {
    set?: (values: Record<string, unknown>) => void;
  };

  const options = resolveHarmoniaOptions(character);

  settable.set?.({
    maxPolyphony: 16,
    oscillator: { type: "triangle" },
    envelope: { attack: 0.15, decay: 0.4, sustain: 0.75, release: 1.8 },
    ...options.synth,
  });

  const filter = new tone.Filter({
    type: "lowpass",
    frequency: filterValueToFrequency(HARMONIA_DEFAULT_CONTROLS.tone),
    Q: 0.8,
    ...options.filter,
  });
  const volume = new tone.Volume(options.volume);
  synth.connect(filter);

  const { tail, nodes } = buildEffectChain(tone, filter, options.effects);
  tail.connect(volume);

  return { synth, filter, volume, effects: nodes };
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
  nodes.effects.forEach((effect) => effect.dispose());
  nodes.volume.dispose();
};

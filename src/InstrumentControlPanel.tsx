import type {
  Dispatch,
  FC,
  PointerEvent as ReactPointerEvent,
  PropsWithChildren,
  ReactNode,
  SetStateAction,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";

import type { Chunk, NoteEvent } from "./chunks";
import type { Track } from "./tracks";
import { formatInstrumentLabel } from "./utils/instrument";
import { initAudioContext, filterValueToFrequency } from "./utils/audio";
import { ARP_PRESETS } from "./arpPresets";
import {
  getScaleDegreeOffset,
  isScaleName,
  SCALE_INTERVALS,
  SCALE_OPTIONS,
  type ScaleName,
} from "./music/scales";
import {
  describeHarmoniaChord,
  distributeHarmoniaPatternDegrees,
  HARMONIA_CHARACTER_PRESETS,
  HARMONIA_COMPLEXITY_ORDER,
  HARMONIA_DEFAULT_CONTROLS,
  HARMONIA_PATTERN_PRESETS,
  listHarmoniaDegreeLabels,
  normalizeControlState as normalizeHarmoniaControlState,
  resolveHarmoniaChord,
} from "./instruments/harmonia";
import {
  DEFAULT_KICK_STATE,
  mergeKickDesignerState,
  normalizeKickDesignerState,
} from "./instruments/kickState";
import type {
  HarmoniaComplexity,
  HarmoniaPatternId,
  HarmoniaScaleDegree,
} from "./instruments/harmonia";
import {
  deleteInstrumentPreset,
  listInstrumentPresets,
  loadInstrumentPreset,
  PRESETS_UPDATED_EVENT,
  USER_PRESET_PREFIX,
} from "./presets";
import { packs } from "./packs";

interface InstrumentControlPanelProps {
  track: Track;
  allTracks: Track[];
  onUpdatePattern?: (updater: (pattern: Chunk) => Chunk) => void;
  trigger?: (
    time: number,
    velocity?: number,
    pitch?: number,
    note?: string,
    sustain?: number,
    chunk?: Chunk,
    characterId?: string
  ) => void;
  isRecording?: boolean;
  onRecordingChange?: Dispatch<SetStateAction<boolean>>;
  onPresetApplied?: (
    trackId: number,
    payload: { presetId: string | null; characterId?: string | null; name?: string }
  ) => void;
  onHarmoniaRealtimeChange?: (payload: {
    tone: number;
    dynamics: number;
    characterId?: string | null;
    packId?: string | null;
  }) => void;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue?: (value: number) => string;
  onChange?: (value: number) => void;
}

interface HarmoniaRecordingMeta {
  note: string;
  notes: string[];
  degrees: number[];
  tonalCenter: string;
  scale: string;
  degree: number;
  useExtensions: boolean;
  harmoniaComplexity?: HarmoniaComplexity;
  harmoniaBorrowedLabel?: string;
  harmoniaTone?: number;
  harmoniaDynamics?: number;
  harmoniaBass?: boolean;
  harmoniaArp?: boolean;
  harmoniaPatternId?: string;
  velocityFactor?: number;
  filter?: number;
}

const Slider: FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}) => {
  const display = formatValue
    ? formatValue(value)
    : value % 1 === 0
      ? value.toFixed(0)
      : value.toFixed(2);

  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
        color: onChange ? "#e6f2ff" : "#475569",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 600,
        }}
      >
        <span>{label}</span>
        <span style={{ color: "#94a3b8" }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange?.(Number(event.target.value))}
        disabled={!onChange}
        style={{
          width: "100%",
          accentColor: "#27E0B0",
          opacity: onChange ? 1 : 0.4,
          cursor: onChange ? "pointer" : "not-allowed",
        }}
      />
    </label>
  );
};

const Section: FC<PropsWithChildren<{ padding?: number }>> = ({
  padding = 12,
  children,
}) => (
  <div
    style={{
      borderRadius: 10,
      border: "1px solid #1d2636",
      background: "#10192c",
      padding,
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}
  >
    {children}
  </div>
);

const CollapsibleSection: FC<
  PropsWithChildren<{ title: string; defaultOpen?: boolean }>
> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid #1d2636",
        background: "#10192c",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          background: "rgba(15, 23, 42, 0.6)",
          border: "none",
          color: "#e2e8f0",
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 16, lineHeight: 1 }}>{open ? "–" : "+"}</span>
      </button>
      {open ? (
        <div
          style={{
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};

const isPercussiveInstrument = (instrument: string) =>
  ["kick", "snare", "hihat"].includes(instrument);

const createChordNotes = (rootNote: string, degrees: number[]) => {
  const rootMidi = Tone.Frequency(rootNote).toMidi();
  return degrees.map((degree) =>
    Tone.Frequency(rootMidi + degree, "midi").toNote()
  );
};

const DEGREE_LABELS = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

const SYNC_RATE_OPTIONS = [
  { value: "4n", label: "1/4" },
  { value: "8n", label: "1/8" },
  { value: "16n", label: "1/16" },
  { value: "8t", label: "Triplet" },
] as const;

const DEFAULT_FREE_RATE = 240;

const normalizeArpRate = (value: string | undefined | null): string => {
  if (!value) return "8n";
  const normalized = value.toLowerCase();
  if (normalized.endsWith("n") || normalized.endsWith("t")) {
    return normalized;
  }
  switch (normalized) {
    case "1/4":
      return "4n";
    case "1/8":
      return "8n";
    case "1/16":
      return "16n";
    case "triplet":
    case "1/8t":
      return "8t";
    default:
      return normalized;
  }
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const arraysEqual = <T,>(a?: T[] | null, b?: T[] | null) => {
  if (!a || !b) return Boolean(!a && !b);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const buildChordForDegree = (
  tonalCenter: string,
  scale: ScaleName,
  degreeIndex: number,
  includeExtensions: boolean
) => {
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.Major;
  const centerMidi = Tone.Frequency(tonalCenter).toMidi();
  const rootOffset = getScaleDegreeOffset(intervals, degreeIndex);
  const chordRootMidi = centerMidi + rootOffset;
  const chordRoot = Tone.Frequency(chordRootMidi, "midi").toNote();
  const noteCount = includeExtensions ? 7 : 3;
  const midiNotes: number[] = [];
  const degrees: number[] = [];
  for (let i = 0; i < noteCount; i += 1) {
    const offset = getScaleDegreeOffset(intervals, degreeIndex + i * 2) - rootOffset;
    midiNotes.push(chordRootMidi + offset);
    degrees.push(offset);
  }
  const notes = midiNotes.map((value) => Tone.Frequency(value, "midi").toNote());
  return { root: chordRoot, midiNotes, degrees, notes };
};

export const InstrumentControlPanel: FC<InstrumentControlPanelProps> = ({
  track,
  allTracks,
  onUpdatePattern,
  trigger,
  isRecording = false,
  onRecordingChange,
  onPresetApplied,
  onHarmoniaRealtimeChange,
}) => {
  const pattern = track.pattern;
  const patternCharacterId = pattern?.characterId ?? null;
  const instrumentLabel = formatInstrumentLabel(track.instrument ?? "");
  const isPercussive = isPercussiveInstrument(track.instrument ?? "");
  const isKick = track.instrument === "kick";
  const isBass = track.instrument === "bass";
  const isArp = track.instrument === "arp";
  const isKeyboard = track.instrument === "keyboard";
  const isHarmonia = track.instrument === "harmonia";
  const sourceCharacterId = track.source?.characterId ?? null;
  const [activeDegree, setActiveDegree] = useState<number | null>(null);
  const [pressedKeyboardNotes, setPressedKeyboardNotes] = useState<
    Set<string>
  >(() => new Set());
  const arpScheduleIdRef = useRef<number | null>(null);
  const latchedDegreeRef = useRef<number | null>(null);
  const unfoldProgressRef = useRef(0);
  const autopMaskRef = useRef<boolean[]>(Array(16).fill(false));
  const previousAutopilotRef = useRef(pattern?.autopilot ?? false);
  const recordingAnchorRef = useRef<number | null>(null);
  const freeNoteBufferRef = useRef<
    Map<
      string,
      { start: number; baseNote: string; velocity: number; renderedNote: string }
    >
  >(new Map());

  const updatePattern = useMemo(() => {
    if (!onUpdatePattern || !pattern) {
      return undefined;
    }
    return (partial: Partial<Chunk>) => {
      onUpdatePattern((chunk) => ({
        ...chunk,
        ...partial,
      }));
    };
  }, [onUpdatePattern, pattern]);

  const harmoniaCharacterPreset = useMemo(() => {
    if (!isHarmonia) return null;
    const characterId = patternCharacterId ?? sourceCharacterId;
    if (!characterId) return null;
    return (
      HARMONIA_CHARACTER_PRESETS.find((preset) => preset.id === characterId) ?? null
    );
  }, [isHarmonia, patternCharacterId, sourceCharacterId]);

  const harmoniaControls = useMemo(
    () =>
      normalizeHarmoniaControlState({
        complexity:
          (pattern?.harmoniaComplexity as HarmoniaComplexity | undefined) ??
          harmoniaCharacterPreset?.complexity,
        tone: pattern?.harmoniaTone,
        dynamics: pattern?.harmoniaDynamics,
        bassEnabled: pattern?.harmoniaBass,
        arpEnabled: pattern?.harmoniaArp,
        patternId: pattern?.harmoniaPatternId as HarmoniaPatternId | undefined,
      }),
    [pattern, harmoniaCharacterPreset]
  );

  const packId = track.source?.packId ?? "";

  const kickDefaults = useMemo(() => {
    if (!isKick) return DEFAULT_KICK_STATE;
    if (!packId) return DEFAULT_KICK_STATE;
    const pack = packs.find((candidate) => candidate.id === packId);
    const instrument = pack?.instruments?.kick;
    if (!instrument) return DEFAULT_KICK_STATE;
    const activeCharacterId =
      patternCharacterId ??
      sourceCharacterId ??
      instrument.defaultCharacterId ??
      instrument.characters[0]?.id ??
      null;
    const character = activeCharacterId
      ? instrument.characters.find((candidate) => candidate.id === activeCharacterId) ?? null
      : instrument.characters[0] ?? null;
    return character
      ? normalizeKickDesignerState(character.defaults)
      : DEFAULT_KICK_STATE;
  }, [
    isKick,
    packId,
    patternCharacterId,
    sourceCharacterId,
  ]);

  useEffect(() => {
    if (!isKick || !pattern || !updatePattern) return;
    const merged = mergeKickDesignerState(kickDefaults, {
      punch: pattern.punch,
      clean: pattern.clean,
      tight: pattern.tight,
    });
    const needsUpdate =
      pattern.punch !== merged.punch ||
      pattern.clean !== merged.clean ||
      pattern.tight !== merged.tight;
    if (needsUpdate) {
      updatePattern({
        punch: merged.punch,
        clean: merged.clean,
        tight: merged.tight,
      });
    }
  }, [isKick, pattern, updatePattern, kickDefaults]);

  const kickState = useMemo(
    () =>
      mergeKickDesignerState(kickDefaults, {
        punch: pattern?.punch,
        clean: pattern?.clean,
        tight: pattern?.tight,
      }),
    [kickDefaults, pattern?.punch, pattern?.clean, pattern?.tight]
  );

  const harmoniaPatternPresets = useMemo(() => {
    if (!packId) {
      return HARMONIA_PATTERN_PRESETS;
    }
    const pack = packs.find((candidate) => candidate.id === packId);
    const patternDefinitions = pack?.instruments?.harmonia?.patterns;
    if (!patternDefinitions?.length) {
      return HARMONIA_PATTERN_PRESETS;
    }
    return patternDefinitions.map((preset) => ({
      id: preset.id as HarmoniaPatternId,
      name: preset.name,
      description: preset.description ?? "",
      degrees: (preset.degrees ?? []).map((value) =>
        Math.min(6, Math.max(0, Math.round(value)))
      ) as HarmoniaScaleDegree[],
    }));
  }, [packId]);

  const harmoniaDegreeLabels = useMemo(() => listHarmoniaDegreeLabels(), []);
  const harmoniaSelectedDegree = Math.min(6, Math.max(0, pattern?.degree ?? 0)) as HarmoniaScaleDegree;
  const harmoniaBorrowedLabel = pattern?.harmoniaBorrowedLabel ?? undefined;
  const harmoniaAllowBorrowed =
    harmoniaCharacterPreset?.allowBorrowed ?? Boolean(harmoniaBorrowedLabel);
  const harmoniaTonalCenter = pattern?.tonalCenter ?? pattern?.note ?? "C4";
  const harmoniaScaleName = isScaleName(pattern?.scale)
    ? (pattern?.scale as ScaleName)
    : "Major";
  const harmoniaBassEnabled = harmoniaControls.bassEnabled;
  const harmoniaArpEnabled = harmoniaControls.arpEnabled;
  const harmoniaPatternId = harmoniaControls.patternId;
  const harmoniaActivePattern = useMemo(
    () =>
      harmoniaPatternId
        ? harmoniaPatternPresets.find((preset) => preset.id === harmoniaPatternId) ?? null
        : null,
    [harmoniaPatternId, harmoniaPatternPresets]
  );

  useEffect(() => {
    if (!isHarmonia || !pattern || !updatePattern) return;
    const defaults: Partial<Chunk> = {};
    const defaultComplexity =
      harmoniaCharacterPreset?.complexity ?? HARMONIA_DEFAULT_CONTROLS.complexity;
    if (pattern.harmoniaComplexity === undefined) {
      defaults.harmoniaComplexity = defaultComplexity;
      defaults.useExtensions = defaultComplexity !== "simple";
    }
    if (pattern.harmoniaTone === undefined) {
      defaults.harmoniaTone = HARMONIA_DEFAULT_CONTROLS.tone;
    }
    if (pattern.harmoniaDynamics === undefined) {
      defaults.harmoniaDynamics = HARMONIA_DEFAULT_CONTROLS.dynamics;
      if (pattern.velocityFactor === undefined) {
        defaults.velocityFactor = HARMONIA_DEFAULT_CONTROLS.dynamics;
      }
    }
    if (pattern.harmoniaBass === undefined) {
      defaults.harmoniaBass = HARMONIA_DEFAULT_CONTROLS.bassEnabled;
    }
    if (pattern.harmoniaArp === undefined) {
      defaults.harmoniaArp = HARMONIA_DEFAULT_CONTROLS.arpEnabled;
    }
    const scaleValue = isScaleName(pattern.scale)
      ? (pattern.scale as ScaleName)
      : "Major";
    if (!isScaleName(pattern.scale)) {
      defaults.scale = scaleValue;
    }
    const tonalCenter = pattern.tonalCenter ?? pattern.note ?? "C4";
    if (pattern.tonalCenter === undefined) {
      defaults.tonalCenter = tonalCenter;
    }
    const degree = Math.min(6, Math.max(0, pattern.degree ?? 0)) as HarmoniaScaleDegree;
    if (pattern.degree === undefined) {
      defaults.degree = degree;
    }
    if (!pattern.notes?.length) {
      const resolution = resolveHarmoniaChord({
        tonalCenter,
        scale: scaleValue,
        degree,
        complexity: defaults.harmoniaComplexity ?? defaultComplexity,
        allowBorrowed:
          harmoniaCharacterPreset?.allowBorrowed ?? Boolean(pattern.harmoniaBorrowedLabel),
        preferredVoicingLabel: pattern.harmoniaBorrowedLabel ?? undefined,
      });
      defaults.note = resolution.root;
      defaults.notes = resolution.notes.slice();
      defaults.degrees = resolution.intervals.slice();
      if (resolution.borrowed) {
        defaults.harmoniaBorrowedLabel = resolution.voicingLabel;
      } else if (pattern.harmoniaBorrowedLabel && !harmoniaCharacterPreset?.allowBorrowed) {
        defaults.harmoniaBorrowedLabel = undefined;
      }
    }
    if (Object.keys(defaults).length > 0) {
      updatePattern(defaults);
    }
  }, [
    isHarmonia,
    pattern,
    updatePattern,
    harmoniaCharacterPreset,
  ]);

  useEffect(() => {
    if (!pattern || !updatePattern) return;
    if (!isKeyboard && !isArp) return;
    const defaults: Partial<Chunk> = {};
    if (pattern.note === undefined) {
      defaults.note = "C4";
    }
    if (pattern.attack === undefined) {
      defaults.attack = 0.05;
    }
    if (pattern.sustain === undefined) {
      defaults.sustain = 0.8;
    }
    if (pattern.glide === undefined) {
      defaults.glide = 0;
    }
    if (pattern.pan === undefined) {
      defaults.pan = 0;
    }
    if (pattern.reverb === undefined) {
      defaults.reverb = 0;
    }
    if (pattern.delay === undefined) {
      defaults.delay = 0;
    }
    if (pattern.distortion === undefined) {
      defaults.distortion = 0;
    }
    if (pattern.bitcrusher === undefined) {
      defaults.bitcrusher = 0;
    }
    if (pattern.chorus === undefined) {
      defaults.chorus = 0;
    }
    if (pattern.filter === undefined) {
      defaults.filter = 1;
    }
    if (Object.keys(defaults).length > 0) {
      updatePattern(defaults);
    }
  }, [isArp, isKeyboard, pattern, updatePattern]);

  const activeVelocity = pattern?.velocityFactor ?? 1;
  const manualVelocity = Math.max(0, Math.min(1, activeVelocity));
  const canTrigger = Boolean(trigger && pattern);
  const updateRecording = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      onRecordingChange?.(next);
    },
    [onRecordingChange]
  );

  const arpRoot = pattern?.note ?? "C4";
  const arpRateOptions = ["1/32", "1/16", "1/8", "1/4"] as const;

  const availableNotes = useMemo(() => {
    const octaves = [2, 3, 4, 5];
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return octaves.flatMap((octave) =>
      noteNames.map((note) => `${note}${octave}`)
    );
  }, []);

  const harmoniaPadRef = useRef<HTMLDivElement | null>(null);
  const harmoniaPadActiveRef = useRef(false);
  const harmoniaPadStateRef = useRef({
    tone: 0,
    dynamics: 0,
  });
  const harmoniaPadPointerIdRef = useRef<number | null>(null);
  const harmoniaLastChordRef = useRef<HarmoniaRecordingMeta | null>(null);

  useEffect(() => {
    harmoniaPadStateRef.current = {
      tone: harmoniaControls.tone,
      dynamics: harmoniaControls.dynamics,
    };
  }, [harmoniaControls.tone, harmoniaControls.dynamics]);

  const updateHarmoniaPadPosition = useCallback(
    (clientX: number, clientY: number) => {
      if (!isHarmonia) return;
      const rect = harmoniaPadRef.current?.getBoundingClientRect();
      if (!rect) return;
      const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
      const normalizedY = clamp((clientY - rect.top) / rect.height, 0, 1);
      const tone = normalizedX;
      const dynamics = 1 - normalizedY;
      harmoniaPadStateRef.current = { tone, dynamics };
      if (harmoniaLastChordRef.current) {
        harmoniaLastChordRef.current = {
          ...harmoniaLastChordRef.current,
          harmoniaTone: tone,
          harmoniaDynamics: dynamics,
          velocityFactor: dynamics,
          filter: tone,
        };
      }
      updatePattern?.({
        harmoniaTone: tone,
        harmoniaDynamics: dynamics,
        filter: tone,
        velocityFactor: dynamics,
      });
      onHarmoniaRealtimeChange?.({
        tone,
        dynamics,
        characterId: sourceCharacterId ?? patternCharacterId,
        packId,
      });
    },
    [
      isHarmonia,
      updatePattern,
      onHarmoniaRealtimeChange,
      sourceCharacterId,
      patternCharacterId,
      harmoniaLastChordRef,
      packId,
    ]
  );

  const handleHarmoniaPadPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isHarmonia) return;
      harmoniaPadActiveRef.current = true;
      harmoniaPadPointerIdRef.current = event.pointerId;
      updateHarmoniaPadPosition(event.clientX, event.clientY);
    },
    [isHarmonia, updateHarmoniaPadPosition]
  );

  const handleHarmoniaPadPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!harmoniaPadActiveRef.current) return;
      if (
        harmoniaPadPointerIdRef.current !== null &&
        event.pointerId !== harmoniaPadPointerIdRef.current
      ) {
        return;
      }
      updateHarmoniaPadPosition(event.clientX, event.clientY);
    },
    [updateHarmoniaPadPosition]
  );

  const handleHarmoniaPadPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!harmoniaPadActiveRef.current) return;
      if (
        harmoniaPadPointerIdRef.current !== null &&
        event.pointerId !== harmoniaPadPointerIdRef.current
      ) {
        return;
      }
      harmoniaPadActiveRef.current = false;
      harmoniaPadPointerIdRef.current = null;
      updateHarmoniaPadPosition(event.clientX, event.clientY);
    },
    [updateHarmoniaPadPosition]
  );

  const handleHarmoniaPadPointerCancel = useCallback(() => {
    harmoniaPadActiveRef.current = false;
    harmoniaPadPointerIdRef.current = null;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!harmoniaPadActiveRef.current) return;
      if (
        harmoniaPadPointerIdRef.current !== null &&
        event.pointerId !== harmoniaPadPointerIdRef.current
      ) {
        return;
      }
      updateHarmoniaPadPosition(event.clientX, event.clientY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!harmoniaPadActiveRef.current) return;
      if (
        harmoniaPadPointerIdRef.current !== null &&
        event.pointerId !== harmoniaPadPointerIdRef.current
      ) {
        return;
      }
      harmoniaPadActiveRef.current = false;
      harmoniaPadPointerIdRef.current = null;
      updateHarmoniaPadPosition(event.clientX, event.clientY);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (
        harmoniaPadPointerIdRef.current !== null &&
        event.pointerId !== harmoniaPadPointerIdRef.current
      ) {
        return;
      }
      harmoniaPadActiveRef.current = false;
      harmoniaPadPointerIdRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [updateHarmoniaPadPosition]);

  useEffect(() => {
    if (!isHarmonia) {
      harmoniaPadActiveRef.current = false;
      harmoniaPadPointerIdRef.current = null;
    }
  }, [isHarmonia]);

  const computeHarmoniaResolution = useCallback(
    (
      degree: HarmoniaScaleDegree,
      overrides?: {
        tonalCenter?: string;
        scale?: ScaleName;
        complexity?: HarmoniaComplexity;
        allowBorrowed?: boolean;
        preferredVoicingLabel?: string | null;
      }
    ) => {
      const tonalCenter = overrides?.tonalCenter ?? harmoniaTonalCenter;
      const scale = overrides?.scale ?? harmoniaScaleName;
      const complexity = overrides?.complexity ?? harmoniaControls.complexity;
      const allowBorrowed = overrides?.allowBorrowed ?? harmoniaAllowBorrowed;
      const preferredVoicingLabel = overrides?.preferredVoicingLabel ??
        (degree === harmoniaSelectedDegree ? harmoniaBorrowedLabel ?? undefined : undefined);
      return resolveHarmoniaChord({
        tonalCenter,
        scale,
        degree,
        complexity,
        allowBorrowed,
        preferredVoicingLabel,
      });
    },
    [
      harmoniaTonalCenter,
      harmoniaScaleName,
      harmoniaControls.complexity,
      harmoniaAllowBorrowed,
      harmoniaSelectedDegree,
      harmoniaBorrowedLabel,
    ]
  );

  const applyHarmoniaResolution = useCallback(
    (
      degree: HarmoniaScaleDegree,
      overrides?: {
        tonalCenter?: string;
        scale?: ScaleName;
        complexity?: HarmoniaComplexity;
        allowBorrowed?: boolean;
        preferredVoicingLabel?: string | null;
      }
    ) => {
      const tonalCenter = overrides?.tonalCenter ?? harmoniaTonalCenter;
      const scale = overrides?.scale ?? harmoniaScaleName;
      const complexity = overrides?.complexity ?? harmoniaControls.complexity;
      const allowBorrowed = overrides?.allowBorrowed ?? harmoniaAllowBorrowed;
      const preferredVoicingLabel = overrides?.preferredVoicingLabel ??
        (degree === harmoniaSelectedDegree ? harmoniaBorrowedLabel ?? undefined : undefined);
      const resolution = resolveHarmoniaChord({
        tonalCenter,
        scale,
        degree,
        complexity,
        allowBorrowed,
        preferredVoicingLabel,
      });
      const notes = resolution.notes.slice();
      const degrees = resolution.intervals.slice();
      harmoniaLastChordRef.current = {
        note: resolution.root,
        notes,
        degrees,
        tonalCenter,
        scale,
        degree,
        useExtensions: complexity !== "simple",
        harmoniaComplexity: complexity,
        harmoniaBorrowedLabel: resolution.borrowed
          ? resolution.voicingLabel
          : undefined,
        harmoniaTone: harmoniaPadStateRef.current.tone,
        harmoniaDynamics: harmoniaPadStateRef.current.dynamics,
        harmoniaBass: harmoniaControls.bassEnabled,
        harmoniaArp: harmoniaControls.arpEnabled,
        harmoniaPatternId: harmoniaControls.patternId ?? undefined,
        velocityFactor: harmoniaPadStateRef.current.dynamics,
        filter: harmoniaPadStateRef.current.tone,
      };
      if (updatePattern) {
        const payload: Partial<Chunk> = {
          tonalCenter,
          scale,
          degree,
          note: resolution.root,
          notes,
          degrees,
          harmoniaComplexity: complexity,
          harmoniaBorrowedLabel: resolution.borrowed
            ? resolution.voicingLabel
            : undefined,
        };
        payload.useExtensions = complexity !== "simple";
        updatePattern(payload);
      }
      return { resolution, tonalCenter, scale, complexity };
    },
    [
      updatePattern,
      harmoniaTonalCenter,
      harmoniaScaleName,
      harmoniaControls.complexity,
      harmoniaControls.bassEnabled,
      harmoniaControls.arpEnabled,
      harmoniaControls.patternId,
      harmoniaAllowBorrowed,
      harmoniaSelectedDegree,
      harmoniaBorrowedLabel,
    ]
  );

  const tonalCenter = pattern?.tonalCenter ?? pattern?.note ?? "C4";
  const scaleName = isScaleName(pattern?.scale)
    ? (pattern?.scale as ScaleName)
    : "Major";
  const selectedDegree = Math.min(6, Math.max(0, pattern?.degree ?? 0));
  const extensionsEnabled = pattern?.useExtensions ?? false;

  useEffect(() => {
    if (!pattern || !pattern.note || !pattern.notes || !pattern.degrees) {
      return;
    }
    if (!pattern.notes.length || !pattern.degrees.length) {
      return;
    }
    harmoniaLastChordRef.current = {
      note: pattern.note,
      notes: pattern.notes.slice(),
      degrees: pattern.degrees.slice(),
      tonalCenter: pattern.tonalCenter ?? tonalCenter,
      scale: isScaleName(pattern.scale) ? (pattern.scale as string) : scaleName,
      degree: Math.min(6, Math.max(0, pattern.degree ?? selectedDegree)),
      useExtensions: pattern.useExtensions ?? extensionsEnabled,
      harmoniaComplexity: pattern.harmoniaComplexity,
      harmoniaBorrowedLabel: pattern.harmoniaBorrowedLabel,
      harmoniaTone: pattern.harmoniaTone ?? pattern.filter,
      harmoniaDynamics: pattern.harmoniaDynamics ?? pattern.velocityFactor,
      harmoniaBass: pattern.harmoniaBass,
      harmoniaArp: pattern.harmoniaArp,
      harmoniaPatternId: pattern.harmoniaPatternId ?? undefined,
      velocityFactor: pattern.velocityFactor,
      filter: pattern.filter,
    };
  }, [pattern, tonalCenter, scaleName, selectedDegree, extensionsEnabled]);

  const timingMode = pattern?.timingMode === "free" ? "free" : "sync";
  const autopilotEnabled = pattern?.autopilot ?? false;
  const arpStyle = pattern?.style ?? "up";
  const arpRate = normalizeArpRate(pattern?.arpRate);
  const arpFreeRate = pattern?.arpFreeRate ?? DEFAULT_FREE_RATE;
  const arpGate = pattern?.arpGate ?? 0.6;
  const arpOctaves = pattern?.arpOctaves ?? 1;
  const latchEnabled = pattern?.arpLatch ?? false;
  const reverbAmount = pattern?.reverb ?? 0;
  const distortionAmount = pattern?.distortion ?? 0;
  const bitcrusherAmount = pattern?.bitcrusher ?? 0;

  const chordDefinition = useMemo(
    () =>
      buildChordForDegree(
        tonalCenter,
        scaleName,
        selectedDegree,
        extensionsEnabled
      ),
    [tonalCenter, scaleName, selectedDegree, extensionsEnabled]
  );

  const recordNoteToPattern = useCallback(
    ({
      noteName,
      eventTime,
      baseNote,
      velocity,
      duration,
      includeChordMeta,
      mode,
      chunkOverrides,
      chordMeta,
    }: {
      noteName: string;
      eventTime: number;
      baseNote: string;
      velocity: number;
      duration?: number;
      includeChordMeta?: boolean;
      mode: "sync" | "free";
      chunkOverrides?: Partial<Chunk>;
      chordMeta?: HarmoniaRecordingMeta;
    }) => {
      if (!onUpdatePattern) return;

      const fallbackMeta: HarmoniaRecordingMeta = {
        note: chordDefinition.root,
        notes: chordDefinition.notes.slice(),
        degrees: chordDefinition.degrees.slice(),
        tonalCenter,
        scale: scaleName,
        degree: selectedDegree,
        useExtensions: extensionsEnabled,
        harmoniaComplexity: pattern?.harmoniaComplexity,
        harmoniaBorrowedLabel: pattern?.harmoniaBorrowedLabel,
        harmoniaTone: pattern?.harmoniaTone ?? harmoniaPadStateRef.current.tone,
        harmoniaDynamics:
          pattern?.harmoniaDynamics ?? harmoniaPadStateRef.current.dynamics,
        harmoniaBass: pattern?.harmoniaBass,
        harmoniaArp: pattern?.harmoniaArp,
        harmoniaPatternId: pattern?.harmoniaPatternId,
        velocityFactor:
          pattern?.velocityFactor ??
          pattern?.harmoniaDynamics ??
          harmoniaPadStateRef.current.dynamics,
        filter: pattern?.filter ?? harmoniaPadStateRef.current.tone,
      };

      const activeChordMeta = chordMeta ?? harmoniaLastChordRef.current ?? fallbackMeta;

      if (includeChordMeta) {
        harmoniaLastChordRef.current = {
          ...activeChordMeta,
          notes: activeChordMeta.notes.slice(),
          degrees: activeChordMeta.degrees.slice(),
        };
      }

      if (mode === "sync") {
        recordingAnchorRef.current = null;
        const ticksPerStep = Tone.Transport.PPQ / 4;
        const ticks = Tone.Transport.getTicksAtTime(eventTime);
        onUpdatePattern((chunk) => {
          const length = chunk.steps.length || 16;
          const stepIndex = length
            ? Math.floor(ticks / ticksPerStep) % length
            : 0;
          const steps = chunk.steps.length
            ? chunk.steps.slice()
            : Array(16).fill(0);
          const velocities = ensureArrayLength(
            chunk.velocities,
            steps.length,
            1
          );
          const pitches = ensureArrayLength(chunk.pitches, steps.length, 0);
          const harmoniaStepDegrees = ensureArrayLength<(number | null)>(
            chunk.harmoniaStepDegrees,
            steps.length,
            null
          );
          const referenceNote =
            chunkOverrides?.note ??
            activeChordMeta.note ??
            chunk.note ??
            baseNote;
          const baseMidi = Tone.Frequency(referenceNote).toMidi();
          const midi = Tone.Frequency(noteName).toMidi();
          steps[stepIndex] = 1;
          velocities[stepIndex] = clamp(velocity, 0, 1);
          pitches[stepIndex] = midi - baseMidi;
          if (includeChordMeta && chordMeta) {
            harmoniaStepDegrees[stepIndex] = chordMeta.degree;
          }

          const nextChunk: Chunk = {
            ...chunk,
            note: pattern?.note ?? baseNote,
            sustain: pattern?.sustain ?? chunk.sustain,
            attack: pattern?.attack ?? chunk.attack,
            glide: pattern?.glide ?? chunk.glide,
            pan: pattern?.pan ?? chunk.pan,
            reverb: pattern?.reverb ?? chunk.reverb,
            delay: pattern?.delay ?? chunk.delay,
            distortion: pattern?.distortion ?? chunk.distortion,
            bitcrusher: pattern?.bitcrusher ?? chunk.bitcrusher,
            filter: pattern?.filter ?? chunk.filter,
            chorus: pattern?.chorus ?? chunk.chorus,
            pitchBend: pattern?.pitchBend ?? chunk.pitchBend,
            style: pattern?.style ?? chunk.style,
            mode: pattern?.mode ?? chunk.mode,
            arpRate: normalizeArpRate(pattern?.arpRate ?? chunk.arpRate),
            arpGate: pattern?.arpGate ?? chunk.arpGate,
            arpLatch: pattern?.arpLatch ?? chunk.arpLatch,
            arpOctaves: pattern?.arpOctaves ?? chunk.arpOctaves,
            arpFreeRate: pattern?.arpFreeRate ?? chunk.arpFreeRate,
            timingMode: "sync",
            tonalCenter,
            scale: scaleName,
            degree: selectedDegree,
            useExtensions: extensionsEnabled,
            autopilot: autopilotEnabled,
            steps,
            velocities,
            pitches,
            noteEvents: undefined,
            noteLoopLength: undefined,
            harmoniaStepDegrees,
          };

          if (includeChordMeta) {
            nextChunk.note = activeChordMeta.note;
            nextChunk.notes = activeChordMeta.notes.slice();
            nextChunk.degrees = activeChordMeta.degrees.slice();
            nextChunk.tonalCenter = activeChordMeta.tonalCenter;
            nextChunk.scale = activeChordMeta.scale;
            nextChunk.degree = activeChordMeta.degree;
            nextChunk.useExtensions = activeChordMeta.useExtensions;
            nextChunk.harmoniaComplexity = activeChordMeta.harmoniaComplexity;
            nextChunk.harmoniaBorrowedLabel =
              activeChordMeta.harmoniaBorrowedLabel;
            nextChunk.harmoniaTone = activeChordMeta.harmoniaTone;
            nextChunk.harmoniaDynamics = activeChordMeta.harmoniaDynamics;
            nextChunk.harmoniaBass = activeChordMeta.harmoniaBass;
            nextChunk.harmoniaArp = activeChordMeta.harmoniaArp;
            nextChunk.harmoniaPatternId = activeChordMeta.harmoniaPatternId;
            nextChunk.velocityFactor = activeChordMeta.velocityFactor;
            nextChunk.filter = activeChordMeta.filter;
          }

          if (chunkOverrides) {
            Object.assign(nextChunk, chunkOverrides);
          }

          return nextChunk;
        });
        return;
      }

      const anchor = recordingAnchorRef.current ?? eventTime;
      recordingAnchorRef.current = anchor;
      const relativeTime = Math.max(0, eventTime - anchor);
      const durationSeconds = Math.max(0.02, duration ?? 0.02);
      const event: NoteEvent = {
        time: relativeTime,
        duration: durationSeconds,
        note: noteName,
        velocity: clamp(velocity, 0, 1),
      };

      onUpdatePattern((chunk) => {
        const length = chunk.steps.length || 16;
        const steps = chunk.steps.length
          ? chunk.steps.slice()
          : Array(length).fill(0);
        steps.fill(0);
        const velocities = ensureArrayLength(chunk.velocities, steps.length, 0);
        velocities.fill(0);
        const pitches = ensureArrayLength(chunk.pitches, steps.length, 0);
        pitches.fill(0);

        const events = chunk.noteEvents ? chunk.noteEvents.slice() : [];
        events.push(event);
        events.sort((a, b) => a.time - b.time);
        const loopLength = Math.max(
          chunk.noteLoopLength ?? 0,
          event.time + event.duration
        );

        const nextChunk: Chunk = {
          ...chunk,
          note: pattern?.note ?? baseNote,
          sustain: pattern?.sustain ?? chunk.sustain,
          attack: pattern?.attack ?? chunk.attack,
          glide: pattern?.glide ?? chunk.glide,
          pan: pattern?.pan ?? chunk.pan,
          reverb: pattern?.reverb ?? chunk.reverb,
          delay: pattern?.delay ?? chunk.delay,
          distortion: pattern?.distortion ?? chunk.distortion,
          bitcrusher: pattern?.bitcrusher ?? chunk.bitcrusher,
          filter: pattern?.filter ?? chunk.filter,
          chorus: pattern?.chorus ?? chunk.chorus,
          pitchBend: pattern?.pitchBend ?? chunk.pitchBend,
          style: pattern?.style ?? chunk.style,
          mode: pattern?.mode ?? chunk.mode,
          arpRate: normalizeArpRate(pattern?.arpRate ?? chunk.arpRate),
          arpGate: pattern?.arpGate ?? chunk.arpGate,
          arpLatch: pattern?.arpLatch ?? chunk.arpLatch,
          arpOctaves: pattern?.arpOctaves ?? chunk.arpOctaves,
          arpFreeRate: pattern?.arpFreeRate ?? chunk.arpFreeRate,
          timingMode: "free",
          tonalCenter,
          scale: scaleName,
          degree: selectedDegree,
          useExtensions: extensionsEnabled,
          autopilot: autopilotEnabled,
          steps,
          velocities,
          pitches,
          noteEvents: events,
          noteLoopLength: loopLength,
          harmoniaStepDegrees: undefined,
        };

        if (includeChordMeta) {
          nextChunk.note = activeChordMeta.note;
          nextChunk.notes = activeChordMeta.notes.slice();
          nextChunk.degrees = activeChordMeta.degrees.slice();
          nextChunk.tonalCenter = activeChordMeta.tonalCenter;
          nextChunk.scale = activeChordMeta.scale;
          nextChunk.degree = activeChordMeta.degree;
          nextChunk.useExtensions = activeChordMeta.useExtensions;
          nextChunk.harmoniaComplexity = activeChordMeta.harmoniaComplexity;
          nextChunk.harmoniaBorrowedLabel =
            activeChordMeta.harmoniaBorrowedLabel;
          nextChunk.harmoniaTone = activeChordMeta.harmoniaTone;
          nextChunk.harmoniaDynamics = activeChordMeta.harmoniaDynamics;
          nextChunk.harmoniaBass = activeChordMeta.harmoniaBass;
          nextChunk.harmoniaArp = activeChordMeta.harmoniaArp;
          nextChunk.harmoniaPatternId = activeChordMeta.harmoniaPatternId;
          nextChunk.velocityFactor = activeChordMeta.velocityFactor;
          nextChunk.filter = activeChordMeta.filter;
        }

        if (chunkOverrides) {
          Object.assign(nextChunk, chunkOverrides);
        }

        return nextChunk;
      });
    },
    [
      onUpdatePattern,
      pattern,
      tonalCenter,
      scaleName,
      selectedDegree,
      extensionsEnabled,
      autopilotEnabled,
      chordDefinition,
      harmoniaLastChordRef,
      harmoniaPadStateRef,
    ]
  );

  const handleHarmoniaPadPress = useCallback(
    (degree: HarmoniaScaleDegree) => {
      const { tone, dynamics } = harmoniaPadStateRef.current;
      const { resolution, tonalCenter: center, scale, complexity } =
        applyHarmoniaResolution(degree);
      if (!resolution) return;
      if (trigger) {
        void initAudioContext();
        const now = Tone.now();
        const notes = resolution.notes.slice();
        const degrees = resolution.intervals.slice();
        const useExtensions = complexity !== "simple";
        const chunkPayload = pattern
          ? {
              ...pattern,
              tonalCenter: center,
              scale,
              degree,
              note: resolution.root,
              notes: notes.slice(),
              degrees: degrees.slice(),
              harmoniaComplexity: complexity,
              harmoniaTone: tone,
              harmoniaDynamics: dynamics,
              harmoniaBass: harmoniaBassEnabled,
              harmoniaArp: harmoniaArpEnabled,
              harmoniaPatternId,
              harmoniaBorrowedLabel: resolution.borrowed
                ? resolution.voicingLabel
                : undefined,
              filter: tone,
            }
          : undefined;
        const chordMeta: HarmoniaRecordingMeta = {
          note: resolution.root,
          notes,
          degrees,
          tonalCenter: center,
          scale,
          degree,
          useExtensions,
          harmoniaComplexity: complexity,
          harmoniaBorrowedLabel: resolution.borrowed
            ? resolution.voicingLabel
            : undefined,
          harmoniaTone: tone,
          harmoniaDynamics: dynamics,
          harmoniaBass: harmoniaBassEnabled,
          harmoniaArp: harmoniaArpEnabled,
          harmoniaPatternId: harmoniaPatternId ?? undefined,
          velocityFactor: dynamics,
          filter: tone,
        };
        trigger(
          now,
          dynamics,
          0,
          resolution.root,
          pattern?.sustain ?? undefined,
          chunkPayload,
          sourceCharacterId ?? patternCharacterId ?? undefined
        );

        if (isRecording && onUpdatePattern) {
          const baseNote = pattern?.note ?? resolution.root;
          const overrides: Partial<Chunk> = {
            tonalCenter: center,
            scale,
            degree,
            note: resolution.root,
            notes: notes.slice(),
            degrees: degrees.slice(),
            harmoniaComplexity: complexity,
            harmoniaBorrowedLabel: resolution.borrowed
              ? resolution.voicingLabel
              : undefined,
            harmoniaTone: tone,
            harmoniaDynamics: dynamics,
            harmoniaBass: harmoniaBassEnabled,
            harmoniaArp: harmoniaArpEnabled,
            harmoniaPatternId: harmoniaPatternId ?? undefined,
            velocityFactor: dynamics,
            filter: tone,
            useExtensions,
          };
          Tone.Draw.schedule(() => {
            recordNoteToPattern({
              noteName: resolution.root,
              eventTime: now,
              baseNote,
              velocity: dynamics,
              duration: pattern?.sustain ?? undefined,
              includeChordMeta: true,
              mode: timingMode,
              chunkOverrides: overrides,
              chordMeta,
            });
          }, now);
        }
      }
    },
    [
      applyHarmoniaResolution,
      trigger,
      pattern,
      harmoniaBassEnabled,
      harmoniaArpEnabled,
      harmoniaPatternId,
      sourceCharacterId,
      patternCharacterId,
      isRecording,
      onUpdatePattern,
      recordNoteToPattern,
      timingMode,
    ]
  );

  const harmoniaComplexityIndex = Math.max(
    0,
    HARMONIA_COMPLEXITY_ORDER.indexOf(harmoniaControls.complexity)
  );

  const handleHarmoniaComplexityChange = useCallback(
    (value: number) => {
      const index = clamp(
        Math.round(value),
        0,
        HARMONIA_COMPLEXITY_ORDER.length - 1
      );
      const nextComplexity = HARMONIA_COMPLEXITY_ORDER[index];
      applyHarmoniaResolution(harmoniaSelectedDegree, {
        complexity: nextComplexity,
      });
    },
    [applyHarmoniaResolution, harmoniaSelectedDegree]
  );

  const toggleHarmoniaBass = useCallback(() => {
    if (!updatePattern) return;
    updatePattern({ harmoniaBass: !harmoniaControls.bassEnabled });
  }, [updatePattern, harmoniaControls.bassEnabled]);

  const toggleHarmoniaArp = useCallback(() => {
    if (!updatePattern) return;
    updatePattern({ harmoniaArp: !harmoniaControls.arpEnabled });
  }, [updatePattern, harmoniaControls.arpEnabled]);

  const handleHarmoniaKeyChange = useCallback(
    (value: string) => {
      applyHarmoniaResolution(harmoniaSelectedDegree, { tonalCenter: value });
    },
    [applyHarmoniaResolution, harmoniaSelectedDegree]
  );

  const handleHarmoniaScaleChange = useCallback(
    (value: string) => {
      const nextScale = isScaleName(value) ? (value as ScaleName) : "Major";
      applyHarmoniaResolution(harmoniaSelectedDegree, { scale: nextScale });
    },
    [applyHarmoniaResolution, harmoniaSelectedDegree]
  );

  const applyHarmoniaPatternPreset = useCallback(
    (presetId: HarmoniaPatternId | null) => {
      if (!isHarmonia || !updatePattern) return;
      if (!presetId) {
        updatePattern({
          harmoniaPatternId: undefined,
          harmoniaStepDegrees: undefined,
        });
        if (harmoniaLastChordRef.current) {
          harmoniaLastChordRef.current = {
            ...harmoniaLastChordRef.current,
            harmoniaPatternId: undefined,
          };
        }
        return;
      }

      const preset = harmoniaPatternPresets.find(
        (candidate) => candidate.id === presetId
      );
      if (!preset) return;

      const stepCount = pattern?.steps?.length ?? 16;
      const { steps, stepDegrees } = distributeHarmoniaPatternDegrees(
        preset.degrees,
        stepCount
      );
      const velocities = Array(stepCount)
        .fill(0)
        .map((_, index) => (steps[index] ? 1 : 0));

      const firstDegreeIndex = stepDegrees.findIndex((value) => value !== null);
      const fallbackDegree = Math.min(6, Math.max(0, pattern?.degree ?? 0)) as HarmoniaScaleDegree;
      const firstDegree =
        firstDegreeIndex >= 0
          ? (stepDegrees[firstDegreeIndex] as HarmoniaScaleDegree)
          : fallbackDegree;

      const resolution = resolveHarmoniaChord({
        tonalCenter: harmoniaTonalCenter,
        scale: harmoniaScaleName,
        degree: firstDegree,
        complexity: harmoniaControls.complexity,
        allowBorrowed: harmoniaAllowBorrowed,
      });

      const payload: Partial<Chunk> = {
        steps,
        velocities,
        harmoniaStepDegrees: stepDegrees.map((value) => value as number | null),
        harmoniaPatternId: presetId,
        tonalCenter: harmoniaTonalCenter,
        scale: harmoniaScaleName,
        degree: firstDegree,
        note: resolution.root,
        notes: resolution.notes.slice(),
        degrees: resolution.intervals.slice(),
        harmoniaComplexity: harmoniaControls.complexity,
        harmoniaBorrowedLabel: resolution.borrowed ? resolution.voicingLabel : undefined,
        useExtensions: harmoniaControls.complexity !== "simple",
        timingMode: "sync",
        noteEvents: undefined,
        noteLoopLength: undefined,
      };

      if (pattern?.harmoniaDynamics === undefined) {
        payload.harmoniaDynamics = harmoniaControls.dynamics;
      }
      if (pattern?.harmoniaTone === undefined) {
        payload.harmoniaTone = harmoniaControls.tone;
      }
      if (pattern?.velocityFactor === undefined) {
        payload.velocityFactor = harmoniaControls.dynamics;
      }

      updatePattern(payload);

      harmoniaLastChordRef.current = {
        note: resolution.root,
        notes: resolution.notes.slice(),
        degrees: resolution.intervals.slice(),
        tonalCenter: harmoniaTonalCenter,
        scale: harmoniaScaleName,
        degree: firstDegree,
        useExtensions: harmoniaControls.complexity !== "simple",
        harmoniaComplexity: harmoniaControls.complexity,
        harmoniaBorrowedLabel: resolution.borrowed ? resolution.voicingLabel : undefined,
        harmoniaTone: harmoniaControls.tone,
        harmoniaDynamics: harmoniaControls.dynamics,
        harmoniaBass: harmoniaControls.bassEnabled,
        harmoniaArp: harmoniaControls.arpEnabled,
        harmoniaPatternId: presetId,
        velocityFactor: harmoniaControls.dynamics,
        filter: harmoniaControls.tone,
      };
    },
    [
      isHarmonia,
      updatePattern,
      pattern?.steps?.length,
      pattern?.harmoniaDynamics,
      pattern?.harmoniaTone,
      pattern?.velocityFactor,
      pattern?.degree,
      harmoniaTonalCenter,
      harmoniaScaleName,
      harmoniaControls.complexity,
      harmoniaControls.dynamics,
      harmoniaControls.tone,
      harmoniaControls.bassEnabled,
      harmoniaControls.arpEnabled,
      harmoniaAllowBorrowed,
      harmoniaPatternPresets,
      harmoniaLastChordRef,
    ]
  );

  const degreeLabel = DEGREE_LABELS[selectedDegree] ?? "I";
  const chordSummary = chordDefinition.notes.join(" • ");

  const autopMask = useMemo(() => {
    const mask = Array(16).fill(false);
    allTracks.forEach((candidate) => {
      if (
        !candidate.pattern ||
        (candidate.instrument !== "kick" && candidate.instrument !== "snare")
      ) {
        return;
      }
      candidate.pattern.steps.forEach((step, index) => {
        if (step) mask[index % 16] = true;
      });
    });
    return mask;
  }, [allTracks]);

  const autopHasHits = autopMask.some(Boolean);

  const degreePositions = useMemo(() => {
    const total = DEGREE_LABELS.length;
    return DEGREE_LABELS.map((_, index) => {
      const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
      const radius = 36;
      return {
        left: 50 + Math.cos(angle) * radius,
        top: 50 + Math.sin(angle) * radius,
      };
    });
  }, []);

  const applyChordSettings = useCallback(
    (center: string, scale: ScaleName, degree: number, includeExtensions: boolean) => {
      if (!updatePattern) return;
      const chord = buildChordForDegree(center, scale, degree, includeExtensions);
      updatePattern({
        tonalCenter: center,
        scale,
        degree,
        note: chord.root,
        notes: chord.notes.slice(),
        degrees: chord.degrees.slice(),
        useExtensions: includeExtensions,
      });
    },
    [updatePattern]
  );

  const keyboardLayout = useMemo(() => {
    const baseNote = pattern?.note ?? "C4";
    const baseMidi = Tone.Frequency(baseNote).toMidi();
    let startMidi = Math.max(0, baseMidi - 12);
    while (startMidi > 0) {
      const candidate = Tone.Frequency(startMidi, "midi").toNote();
      if (!candidate.includes("#")) {
        break;
      }
      startMidi -= 1;
    }
    const notes = Array.from({ length: 24 }, (_, index) =>
      Tone.Frequency(startMidi + index, "midi").toNote()
    );
    let whiteIndex = -1;
    const white: { note: string; index: number }[] = [];
    const black: { note: string; leftIndex: number }[] = [];
    notes.forEach((note) => {
      if (note.includes("#")) {
        black.push({ note, leftIndex: Math.max(whiteIndex, 0) });
      } else {
        whiteIndex += 1;
        white.push({ note, index: whiteIndex });
      }
    });
    return { notes, white, black, whiteCount: white.length };
  }, [pattern?.note]);

  const arpPadPresets = useMemo(
    () => [
      { id: "triad", label: "Triad", degrees: [0, 4, 7] },
      { id: "minor", label: "Minor", degrees: [0, 3, 7] },
      { id: "sus2", label: "Sus2", degrees: [0, 2, 7] },
      { id: "sus4", label: "Sus4", degrees: [0, 5, 7] },
      { id: "seventh", label: "7th", degrees: [0, 4, 7, 10] },
      { id: "ninth", label: "9th", degrees: [0, 4, 7, 10, 14] },
      { id: "six", label: "6th", degrees: [0, 4, 7, 9] },
      { id: "dim", label: "Dim", degrees: [0, 3, 6] },
    ],
    []
  );

  const whiteKeyWidth = keyboardLayout.whiteCount
    ? 100 / keyboardLayout.whiteCount
    : 0;
  const blackKeyWidth = whiteKeyWidth * 0.6;

  const chordMatchesDegrees = (degrees: number[]) => {
    if (!pattern?.degrees || pattern.degrees.length !== degrees.length) return false;
    return pattern.degrees.every((value, index) => value === degrees[index]);
  };

  const ensureArrayLength = <T,>(values: T[] | undefined, length: number, fill: T) => {
    const next = values ? values.slice(0, length) : Array(length).fill(fill);
    if (next.length < length) {
      next.push(...Array(length - next.length).fill(fill));
    }
    return next;
  };

  const sourceInstrumentId = track.source?.instrumentId ?? track.instrument ?? "";
  const [userPresetId, setUserPresetId] = useState<string>("");
  const [userPresets, setUserPresets] = useState<
    { id: string; name: string; characterId: string | null }[]
  >([]);

  const refreshUserPresets = useCallback(() => {
    if (!packId || !sourceInstrumentId) {
      setUserPresets([]);
      return;
    }
    const presets = listInstrumentPresets(packId, sourceInstrumentId).map((preset) => ({
      id: preset.id,
      name: preset.name,
      characterId: preset.characterId,
    }));
    setUserPresets(presets);
  }, [packId, sourceInstrumentId]);

  useEffect(() => {
    refreshUserPresets();
  }, [refreshUserPresets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => refreshUserPresets();
    window.addEventListener(PRESETS_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(PRESETS_UPDATED_EVENT, handler);
    };
  }, [refreshUserPresets]);

  useEffect(() => {
    setUserPresetId("");
  }, [packId, sourceInstrumentId]);

  useEffect(() => {
    if (!userPresetId) return;
    const exists = userPresets.some((preset) => preset.id === userPresetId);
    if (!exists) {
      setUserPresetId("");
    }
  }, [userPresetId, userPresets]);

  const handleLoadUserPreset = useCallback(() => {
    if (!onUpdatePattern || !pattern) return;
    if (!packId || !sourceInstrumentId || !userPresetId) return;
    const preset = loadInstrumentPreset(packId, sourceInstrumentId, userPresetId);
    if (!preset) return;
    onUpdatePattern((current) => {
      const next: Chunk = {
        ...current,
        ...preset.pattern,
        id: current.id,
        instrument: current.instrument,
        name: preset.name || current.name,
        characterId: preset.characterId ?? preset.pattern.characterId ?? current.characterId,
      };
      return next;
    });
    onPresetApplied?.(track.id, {
      presetId: `${USER_PRESET_PREFIX}${preset.id}`,
      characterId: preset.characterId ?? null,
      name: preset.name,
    });
  }, [
    onUpdatePattern,
    pattern,
    packId,
    sourceInstrumentId,
    userPresetId,
    onPresetApplied,
    track.id,
  ]);

  const handleDeleteUserPreset = useCallback(() => {
    if (!packId || !sourceInstrumentId || !userPresetId) return;
    const confirmed = window.confirm("Delete this saved loop?");
    if (!confirmed) return;
    const removed = deleteInstrumentPreset(packId, sourceInstrumentId, userPresetId);
    if (removed) {
      setUserPresetId("");
      refreshUserPresets();
    }
  }, [packId, sourceInstrumentId, userPresetId, refreshUserPresets]);

  const presetControls = packId && sourceInstrumentId ? (
    <Section>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>
            Load Saved Loop
          </span>
          <select
            value={userPresetId}
            onChange={(event) => setUserPresetId(event.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #1d2636",
              background: "#0f172a",
              color: userPresets.length > 0 ? "#f1f5f9" : "#475569",
            }}
          >
            <option value="">
              {userPresets.length > 0
                ? "Select a saved loop"
                : "No saved loops for this instrument"}
            </option>
            {userPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={handleLoadUserPreset}
            disabled={!userPresetId}
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #1d2636",
              background: userPresetId ? "#27E0B0" : "#162032",
              color: userPresetId ? "#0f172a" : "#475569",
              fontSize: 11,
              fontWeight: 600,
              cursor: userPresetId ? "pointer" : "not-allowed",
            }}
          >
            Load Saved Loop
          </button>
          <button
            type="button"
            onClick={handleDeleteUserPreset}
            disabled={!userPresetId}
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #442127",
              background: userPresetId ? "#1f2532" : "#161b27",
              color: userPresetId ? "#fca5a5" : "#475569",
              fontSize: 11,
              fontWeight: 600,
              cursor: userPresetId ? "pointer" : "not-allowed",
            }}
          >
            Delete Saved Loop
          </button>
        </div>
      </div>
    </Section>
  ) : null;

  const stopArpPlayback = useCallback((options?: { preserveState?: boolean }) => {
    if (arpScheduleIdRef.current !== null) {
      Tone.Transport.clear(arpScheduleIdRef.current);
      arpScheduleIdRef.current = null;
    }
    unfoldProgressRef.current = 0;
    if (!options?.preserveState) {
      latchedDegreeRef.current = null;
      setActiveDegree(null);
    }
  }, []);

  const scheduleArpPlayback = useCallback(
    (degreeIndex: number) => {
      stopArpPlayback({ preserveState: true });
      if (!trigger || !pattern) return;
      void initAudioContext();
      const octaves = Math.max(1, pattern.arpOctaves ?? 1);
      const style = pattern.style ?? "up";
      const mode = pattern.timingMode === "free" ? "free" : "sync";
      const syncRate = normalizeArpRate(pattern.arpRate ?? arpRate);
      const freeRate = pattern.arpFreeRate ?? arpFreeRate;
      const gate = clamp(pattern.arpGate ?? arpGate, 0.1, 1);
      const intervalSeconds =
        mode === "free"
          ? Math.max(0.05, freeRate / 1000)
          : Tone.Time(syncRate).toSeconds();
      const sustain =
        pattern.sustain !== undefined
          ? pattern.sustain
          : intervalSeconds * gate;
    const bend = pattern.pitchBend ?? 0;
    const chord = buildChordForDegree(
      tonalCenter,
      scaleName,
      degreeIndex,
      extensionsEnabled
    );
    if (!chord.notes.length) {
      return;
    }
    const midiNotes = chord.midiNotes.slice().sort((a, b) => a - b);
    const expanded: number[] = [];
    for (let octave = 0; octave < octaves; octave += 1) {
      midiNotes.forEach((value) => {
        expanded.push(value + octave * 12);
      });
    }
    if (!expanded.length) return;

    const ticksPerStep = Tone.Transport.PPQ / 4;
    let currentIndex = style === "down" ? expanded.length - 1 : 0;
    let direction: 1 | -1 = style === "down" ? -1 : 1;
    unfoldProgressRef.current = 0;

    const scheduleId = Tone.Transport.scheduleRepeat(
      (time) => {
        if (!expanded.length) return;
        if (style === "unfold" && unfoldProgressRef.current >= expanded.length) {
          stopArpPlayback();
          return;
        }

        let midiValue: number;
        if (style === "random") {
          const idx = Math.floor(Math.random() * expanded.length);
          midiValue = expanded[idx];
        } else if (style === "unfold") {
          const position = unfoldProgressRef.current;
          midiValue = expanded[position];
          unfoldProgressRef.current += 1;
        } else {
          midiValue = expanded[currentIndex];
          if (expanded.length > 1) {
            if (style === "up") {
              currentIndex = (currentIndex + 1) % expanded.length;
            } else if (style === "down") {
              currentIndex =
                (currentIndex - 1 + expanded.length) % expanded.length;
            } else {
              if (currentIndex === expanded.length - 1) {
                direction = -1;
              } else if (currentIndex === 0) {
                direction = 1;
              }
              currentIndex += direction;
            }
          }
        }

        const mask = autopMaskRef.current;
        if (mode === "sync" && autopilotEnabled && mask.some(Boolean)) {
          const ticksAtTime = Tone.Transport.getTicksAtTime(time);
          const stepIndex = Math.floor(ticksAtTime / ticksPerStep) % 16;
          if (!mask[stepIndex]) {
            return;
          }
        }

        const noteName = Tone.Frequency(midiValue, "midi").toNote();
        const bentNote = bend
          ? Tone.Frequency(noteName).transpose(bend).toNote()
          : noteName;
        trigger(time, manualVelocity, 0, bentNote, sustain, pattern);

        if (isRecording && onUpdatePattern) {
          const baseNote = chord.root;
          Tone.Draw.schedule(() => {
            recordNoteToPattern({
              noteName: bentNote,
              eventTime: time,
              baseNote,
              velocity: manualVelocity,
              duration: intervalSeconds * gate,
              includeChordMeta: true,
              mode,
            });
          }, time);
        }
      },
      mode === "free" ? intervalSeconds : syncRate,
      Tone.Transport.seconds
    );

    if (onUpdatePattern) {
      const degrees = chord.degrees.slice();
      const notes = chord.notes.slice();
      onUpdatePattern((chunk) => ({
        ...chunk,
        note: chord.root,
        notes,
        degrees,
        tonalCenter,
        scale: scaleName,
        degree: degreeIndex,
        useExtensions: extensionsEnabled,
      }));
    }

      setActiveDegree(degreeIndex);
      arpScheduleIdRef.current = scheduleId;
    },
    [
      autopilotEnabled,
      manualVelocity,
      onUpdatePattern,
      pattern,
      recordNoteToPattern,
      scaleName,
      stopArpPlayback,
      tonalCenter,
      trigger,
      isRecording,
      extensionsEnabled,
      arpRate,
      arpGate,
      arpFreeRate,
    ]
  );

  const triggerKeyboardNote = (note: string) => {
    if (!trigger || !pattern) return;
    void initAudioContext();
    const bend = pattern.pitchBend ?? 0;
    const sustain = pattern.sustain ?? 0.8;
    const noteName = bend ? Tone.Frequency(note).transpose(bend).toNote() : note;
    const time = Tone.now();
    trigger(time, manualVelocity, 0, noteName, sustain, pattern);

    if (isRecording && onUpdatePattern) {
      const baseNote = pattern.note ?? note;
      Tone.Draw.schedule(() => {
        if (timingMode === "free") {
          freeNoteBufferRef.current.set(note, {
            start: time,
            baseNote,
            velocity: manualVelocity,
            renderedNote: noteName,
          });
        } else {
          recordNoteToPattern({
            noteName,
            eventTime: time,
            baseNote,
            velocity: manualVelocity,
            mode: "sync",
          });
        }
      }, time);
    }
  };

  const finalizeFreeKeyboardNote = (note: string) => {
    if (!isRecording || timingMode !== "free") return;
    const buffer = freeNoteBufferRef.current.get(note);
    if (!buffer) return;
    const releaseTime = Tone.now();
    const duration = Math.max(0.02, releaseTime - buffer.start);
    Tone.Draw.schedule(() => {
      recordNoteToPattern({
        noteName: buffer.renderedNote,
        eventTime: buffer.start,
        baseNote: buffer.baseNote,
        velocity: buffer.velocity,
        duration,
        mode: "free",
      });
    }, releaseTime);
    freeNoteBufferRef.current.delete(note);
  };

  useEffect(() => {
    autopMaskRef.current = autopMask;
  }, [autopMask]);

  useEffect(() => {
    if (!isRecording) {
      recordingAnchorRef.current = null;
      freeNoteBufferRef.current.clear();
    }
  }, [isRecording]);

  useEffect(() => {
    recordingAnchorRef.current = null;
    freeNoteBufferRef.current.clear();
  }, [timingMode]);

  useEffect(() => () => stopArpPlayback(), [stopArpPlayback]);

  useEffect(() => {
    onRecordingChange?.(false);
    stopArpPlayback();
    setActiveDegree(null);
    setPressedKeyboardNotes(new Set());
  }, [track.id, track.instrument, stopArpPlayback, onRecordingChange]);

  useEffect(() => {
    if (!pattern || !updatePattern) return;
    const needsRoot = pattern.note !== chordDefinition.root;
    const needsNotes = !arraysEqual(pattern.notes, chordDefinition.notes);
    const needsDegrees = !arraysEqual(pattern.degrees, chordDefinition.degrees);
    const needsCenter = pattern.tonalCenter !== tonalCenter;
    const needsScale = pattern.scale !== scaleName;
    const needsDegree = (pattern.degree ?? selectedDegree) !== selectedDegree;
    const needsExtensions = (pattern.useExtensions ?? false) !== extensionsEnabled;
    if (
      needsRoot ||
      needsNotes ||
      needsDegrees ||
      needsCenter ||
      needsScale ||
      needsDegree ||
      needsExtensions
    ) {
      applyChordSettings(tonalCenter, scaleName, selectedDegree, extensionsEnabled);
    }
  }, [
    pattern,
    updatePattern,
    chordDefinition,
    tonalCenter,
    scaleName,
    selectedDegree,
    extensionsEnabled,
    applyChordSettings,
  ]);

  useEffect(() => {
    if (!isArp && !isKeyboard) {
      updateRecording(false);
    }
  }, [isArp, isKeyboard, updateRecording]);

  useEffect(() => {
    if (!canTrigger) {
      stopArpPlayback();
    }
  }, [canTrigger, stopArpPlayback]);

  useEffect(() => {
    if (!isArp || !canTrigger) return;
    const wasAutopilot = previousAutopilotRef.current;
    if (!autopilotEnabled) {
      if (wasAutopilot && !pattern?.arpLatch) {
        stopArpPlayback();
      }
      previousAutopilotRef.current = autopilotEnabled;
      return;
    }
    previousAutopilotRef.current = autopilotEnabled;
    latchedDegreeRef.current = selectedDegree;
    scheduleArpPlayback(selectedDegree);
  }, [
    isArp,
    canTrigger,
    autopilotEnabled,
    selectedDegree,
    tonalCenter,
    scaleName,
    extensionsEnabled,
    pattern?.style,
    pattern?.arpRate,
    pattern?.arpGate,
    pattern?.arpOctaves,
    pattern?.sustain,
    pattern?.pitchBend,
    pattern?.arpLatch,
    pattern?.arpFreeRate,
    pattern?.timingMode,
    scheduleArpPlayback,
    stopArpPlayback,
  ]);

  const presetSelection = useMemo(() => {
    const matched = ARP_PRESETS.find((preset) => {
      const settings = preset.settings;
      if (settings.timingMode && settings.timingMode !== timingMode) return false;
      if (settings.style && settings.style !== arpStyle) return false;
      if (settings.arpRate && normalizeArpRate(settings.arpRate) !== arpRate)
        return false;
      if (
        settings.arpFreeRate !== undefined &&
        Math.round(settings.arpFreeRate) !== Math.round(arpFreeRate)
      )
        return false;
      if (
        settings.arpGate !== undefined &&
        Math.abs(settings.arpGate - arpGate) > 0.02
      )
        return false;
      if (
        settings.arpOctaves !== undefined &&
        settings.arpOctaves !== arpOctaves
      )
        return false;
      if (
        settings.useExtensions !== undefined &&
        settings.useExtensions !== extensionsEnabled
      )
        return false;
      if (
        settings.autopilot !== undefined &&
        settings.autopilot !== autopilotEnabled
      )
        return false;
      if (
        settings.reverb !== undefined &&
        Math.abs(settings.reverb - reverbAmount) > 0.02
      )
        return false;
      if (
        settings.distortion !== undefined &&
        Math.abs(settings.distortion - distortionAmount) > 0.02
      )
        return false;
      if (
        settings.bitcrusher !== undefined &&
        Math.abs(settings.bitcrusher - bitcrusherAmount) > 0.02
      )
        return false;
      if (
        settings.arpFreeRate === undefined &&
        settings.arpRate === undefined &&
        timingMode === "free"
      )
        return false;
      return true;
    });
    return matched?.id ?? "custom";
  }, [
    timingMode,
    arpStyle,
    arpRate,
    arpFreeRate,
    arpGate,
    arpOctaves,
    extensionsEnabled,
    autopilotEnabled,
    reverbAmount,
    distortionAmount,
    bitcrusherAmount,
  ]);

  const activePreset = useMemo(
    () => ARP_PRESETS.find((preset) => preset.id === presetSelection) ?? null,
    [presetSelection]
  );

  const updatePatternAndReschedule = useCallback(
    (partial: Partial<Chunk>) => {
      if (!updatePattern) return;
      updatePattern(partial);
      if (autopilotEnabled || latchEnabled || activeDegree !== null) {
        scheduleArpPlayback(selectedDegree);
      }
    },
    [
      updatePattern,
      autopilotEnabled,
      latchEnabled,
      activeDegree,
      scheduleArpPlayback,
      selectedDegree,
    ]
  );

  const applyPresetSettings = useCallback(
    (presetId: string) => {
      if (!updatePattern) return;
      const preset = ARP_PRESETS.find((candidate) => candidate.id === presetId);
      if (!preset) return;
      const settings = preset.settings;
      const payload: Partial<Chunk> = {};
      if (settings.timingMode) {
        payload.timingMode = settings.timingMode;
      }
      if (settings.style) payload.style = settings.style;
      if (settings.arpRate) payload.arpRate = normalizeArpRate(settings.arpRate);
      if (settings.arpGate !== undefined) payload.arpGate = settings.arpGate;
      if (settings.arpOctaves !== undefined) payload.arpOctaves = settings.arpOctaves;
      if (settings.arpFreeRate !== undefined) payload.arpFreeRate = settings.arpFreeRate;
      if (settings.useExtensions !== undefined)
        payload.useExtensions = settings.useExtensions;
      if (settings.autopilot !== undefined) payload.autopilot = settings.autopilot;
      if (settings.reverb !== undefined) payload.reverb = settings.reverb;
      if (settings.distortion !== undefined)
        payload.distortion = settings.distortion;
      if (settings.bitcrusher !== undefined)
        payload.bitcrusher = settings.bitcrusher;
      updatePatternAndReschedule(payload);
    },
    [updatePattern, updatePatternAndReschedule]
  );

  if (!pattern) {
    return (
      <div
        style={{
          borderRadius: 12,
          border: "1px solid #2a3344",
          padding: 24,
          textAlign: "center",
          color: "#94a3b8",
          fontSize: 13,
        }}
      >
        This track doesn't have a pattern yet. Add some steps to unlock
        instrument controls.
      </div>
    );
  }

  if (isArp) {
    const canAutopilot = timingMode === "sync" && autopHasHits;
    const autopilotMessage = !autopHasHits
      ? "Add kick/snare hits to drive autopilot."
      : timingMode === "free"
        ? "Autopilot is available in BPM Sync mode."
        : "";

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
        }}
      >
        {presetControls ? (
          <div style={{ marginBottom: 12 }}>{presetControls}</div>
        ) : null}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            paddingTop: presetControls ? 12 : 0,
            paddingBottom: 8,
            background:
              "linear-gradient(180deg, rgba(11, 18, 32, 0.96) 0%, rgba(11, 18, 32, 0.88) 65%, rgba(11, 18, 32, 0) 100%)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "0 6px 6px",
              fontSize: 11,
              color: "#94a3b8",
            }}
          >
            <span>
              Center
              <span style={{ color: "#e2e8f0", fontWeight: 600, marginLeft: 6 }}>
                {tonalCenter}
              </span>
            </span>
            <span>
              Scale
              <span style={{ color: "#e2e8f0", fontWeight: 600, marginLeft: 6 }}>
                {scaleName.replace(/([a-z])([A-Z])/g, "$1 $2")}
              </span>
            </span>
          </div>
          <div
            style={{
              position: "relative",
              height: 168,
              margin: "0 6px",
              borderRadius: 16,
              background: "radial-gradient(circle at center, #1e293b 0%, #101726 72%)",
              border: "1px solid #273144",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                textAlign: "center",
                color: "#e2e8f0",
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 700 }}>{degreeLabel}</div>
              <div style={{ fontSize: 13, letterSpacing: 0.4 }}>{chordDefinition.root}</div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                {chordSummary}
              </div>
            </div>
            {DEGREE_LABELS.map((label, index) => {
              const position = degreePositions[index];
              const isSelected = selectedDegree === index;
              const isActive = activeDegree === index;
              const highlighted = isSelected || isActive;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!canTrigger}
                  onPointerDown={(event) => {
                    if (!canTrigger) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    if (latchEnabled && !autopilotEnabled && latchedDegreeRef.current === index) {
                      latchedDegreeRef.current = null;
                      stopArpPlayback();
                      return;
                    }
                    if (latchEnabled) {
                      latchedDegreeRef.current = index;
                    }
                    scheduleArpPlayback(index);
                  }}
                  onPointerUp={(event) => {
                    if (!canTrigger) return;
                    event.preventDefault();
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    if (latchEnabled || autopilotEnabled) return;
                    stopArpPlayback();
                  }}
                  onPointerCancel={() => {
                    if (!canTrigger) return;
                    if (latchEnabled || autopilotEnabled) return;
                    stopArpPlayback();
                  }}
                  style={{
                    position: "absolute",
                    top: `${position.top}%`,
                    left: `${position.left}%`,
                    transform: "translate(-50%, -50%)",
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    border: "1px solid #273144",
                    background: highlighted ? "#27E0B0" : "#0f172a",
                    color: highlighted ? "#0e151f" : "#f8fafc",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 15,
                    cursor: canTrigger ? "pointer" : "not-allowed",
                    opacity: canTrigger ? 1 : 0.5,
                    boxShadow: highlighted ? "0 0 12px rgba(39,224,176,0.4)" : "none",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div
          style={{
            padding: "0 6px 12px 0",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <CollapsibleSection title="Main" defaultOpen>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <label style={{ flex: "1 1 140px", fontSize: 12 }}>
                    <span
                      style={{
                        display: "block",
                        marginBottom: 4,
                        color: "#94a3b8",
                        fontWeight: 600,
                      }}
                    >
                      Tonal Center
                    </span>
                    <select
                      value={tonalCenter}
                      onChange={(event) => {
                        const next = event.target.value;
                        applyChordSettings(next, scaleName, selectedDegree, extensionsEnabled);
                        if (autopilotEnabled || latchEnabled || activeDegree !== null) {
                          scheduleArpPlayback(selectedDegree);
                        }
                      }}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #273144",
                        background: "#111a2c",
                        color: "#f8fafc",
                      }}
                    >
                      {availableNotes.map((note) => (
                        <option key={note} value={note}>
                          {note}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ flex: "1 1 160px", fontSize: 12 }}>
                    <span
                      style={{
                        display: "block",
                        marginBottom: 4,
                        color: "#94a3b8",
                        fontWeight: 600,
                      }}
                    >
                      Scale / Mode
                    </span>
                    <select
                      value={scaleName}
                      onChange={(event) => {
                        const next = isScaleName(event.target.value)
                          ? (event.target.value as ScaleName)
                          : "Major";
                        applyChordSettings(tonalCenter, next, selectedDegree, extensionsEnabled);
                        if (autopilotEnabled || latchEnabled || activeDegree !== null) {
                          scheduleArpPlayback(selectedDegree);
                        }
                      }}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #273144",
                        background: "#111a2c",
                        color: "#f8fafc",
                      }}
                    >
                      {SCALE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option.replace(/([a-z])([A-Z])/g, "$1 $2")}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>
                    Timing
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[
                      { mode: "sync", label: "BPM Sync" },
                      { mode: "free", label: "Free" },
                    ].map(({ mode, label }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          if (timingMode === mode) return;
                          updatePatternAndReschedule({ timingMode: mode as "sync" | "free" });
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: "1px solid #273144",
                          background: timingMode === mode ? "#27E0B0" : "#111a2c",
                          color: timingMode === mode ? "#0e151f" : "#e2e8f0",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {timingMode === "sync" ? (
                  <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>
                      Rate
                    </span>
                    <select
                      value={arpRate}
                      onChange={(event) =>
                        updatePatternAndReschedule({
                          arpRate: event.target.value,
                          timingMode: "sync",
                        })
                      }
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #273144",
                        background: "#111a2c",
                        color: "#f8fafc",
                      }}
                    >
                      {SYNC_RATE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <Slider
                    label="Interval"
                    min={100}
                    max={800}
                    step={10}
                    value={arpFreeRate}
                    formatValue={(value) => `${Math.round(value)} ms`}
                    onChange={(value) =>
                      updatePatternAndReschedule({
                        arpFreeRate: value,
                        timingMode: "free",
                      })
                    }
                  />
                )}
                <Slider
                  label="Gate"
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={arpGate}
                  formatValue={(value) => `${Math.round(value * 100)}%`}
                  onChange={(value) => updatePatternAndReschedule({ arpGate: value })}
                />
                <Slider
                  label="Octave Range"
                  min={1}
                  max={4}
                  step={1}
                  value={arpOctaves}
                  formatValue={(value) => `${value}x`}
                  onChange={(value) => updatePatternAndReschedule({ arpOctaves: value })}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (latchEnabled) {
                        latchedDegreeRef.current = null;
                        if (!autopilotEnabled) stopArpPlayback();
                      }
                      updatePattern?.({ arpLatch: !latchEnabled });
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid #273144",
                      background: latchEnabled ? "#27E0B0" : "#111a2c",
                      color: latchEnabled ? "#0e151f" : "#e2e8f0",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Latch {latchEnabled ? "On" : "Off"}
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>
                    Style
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["up", "down", "up-down", "random", "unfold"].map((styleOption) => (
                      <button
                        key={styleOption}
                        type="button"
                        onClick={() => updatePatternAndReschedule({ style: styleOption })}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: "1px solid #273144",
                          background: arpStyle === styleOption ? "#27E0B0" : "#111a2c",
                          color: arpStyle === styleOption ? "#0e151f" : "#e2e8f0",
                          fontSize: 11,
                          fontWeight: 600,
                          textTransform: "capitalize",
                          cursor: "pointer",
                        }}
                      >
                        {styleOption.replace("-", " ")}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CollapsibleSection>
            <CollapsibleSection title="Advanced">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    applyChordSettings(
                      tonalCenter,
                      scaleName,
                      selectedDegree,
                      !extensionsEnabled
                    );
                    if (autopilotEnabled || latchEnabled || activeDegree !== null) {
                      scheduleArpPlayback(selectedDegree);
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid #273144",
                    background: extensionsEnabled ? "#27E0B0" : "#111a2c",
                    color: extensionsEnabled ? "#0e151f" : "#e2e8f0",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Extensions {extensionsEnabled ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  disabled={!canAutopilot}
                  onClick={() => updatePatternAndReschedule({ autopilot: !autopilotEnabled })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid #273144",
                    background: autopilotEnabled ? "#27E0B0" : "#111a2c",
                    color: autopilotEnabled ? "#0e151f" : "#e2e8f0",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: canAutopilot ? "pointer" : "not-allowed",
                    opacity: canAutopilot ? 1 : 0.5,
                  }}
                >
                  Autopilot {autopilotEnabled ? "On" : "Off"}
                </button>
                {autopilotMessage ? (
                  <span style={{ fontSize: 10, color: "#64748b" }}>{autopilotMessage}</span>
                ) : null}
              </div>
            </CollapsibleSection>
            <CollapsibleSection title="Saved Loops & FX" defaultOpen>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>
                    Saved Loop
                  </span>
                  <select
                    value={presetSelection}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next === "custom") return;
                      applyPresetSettings(next);
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #273144",
                      background: "#111a2c",
                      color: "#f8fafc",
                    }}
                  >
                    <option value="custom">Custom</option>
                    {ARP_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                {activePreset?.description ? (
                  <span style={{ fontSize: 10, color: "#64748b" }}>
                    {activePreset.description}
                  </span>
                ) : null}
                <Slider
                  label="Space"
                  min={0}
                  max={1}
                  step={0.01}
                  value={reverbAmount}
                  formatValue={(value) => `${Math.round(value * 100)}%`}
                  onChange={updatePattern ? (value) => updatePattern({ reverb: value }) : undefined}
                />
                <Slider
                  label="Grit"
                  min={0}
                  max={1}
                  step={0.01}
                  value={distortionAmount}
                  formatValue={(value) => `${Math.round(value * 100)}%`}
                  onChange={updatePattern ? (value) => updatePattern({ distortion: value }) : undefined}
                />
                <Slider
                  label="Lo-fi"
                  min={0}
                  max={1}
                  step={0.01}
                  value={bitcrusherAmount}
                  formatValue={(value) => `${Math.round(value * 100)}%`}
                  onChange={updatePattern ? (value) => updatePattern({ bitcrusher: value }) : undefined}
                />
              </div>
            </CollapsibleSection>
          </div>
        </div>
      </div>
    );
  }

  const stickySections: ReactNode[] = [];

  const HARMONIA_PAD_HEIGHT = 140;

  if (isHarmonia) {
    stickySections.push(
      <Section key="harmonia" padding={14}>
        <div
          style={{
            display: "flex",
            gap: 16,
            alignItems: "center",
          }}
        >
          <div
            style={{
              flex: "0 0 calc(50% - 8px)",
              maxWidth: "calc(50% - 8px)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 11,
                color: "#94a3b8",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              <span>XY Pad</span>
              <span>
                Tone {Math.round(harmoniaControls.tone * 100)}% · Dynamics {Math.round(harmoniaControls.dynamics * 100)}%
              </span>
            </div>
            <div
              ref={harmoniaPadRef}
              onPointerDown={handleHarmoniaPadPointerDown}
              onPointerMove={handleHarmoniaPadPointerMove}
              onPointerUp={handleHarmoniaPadPointerUp}
              onPointerCancel={handleHarmoniaPadPointerCancel}
              style={{
                position: "relative",
                width: "100%",
                height: HARMONIA_PAD_HEIGHT,
                borderRadius: 14,
                border: "1px solid #1f2a3d",
                background: "linear-gradient(135deg, #17253a 0%, #0c1524 100%)",
                cursor: updatePattern ? "pointer" : "default",
                touchAction: "none",
                overflow: "hidden",
                userSelect: "none",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: `${(1 - harmoniaControls.dynamics) * 100}%`,
                  left: 0,
                  right: 0,
                  height: 1,
                  background: "rgba(148, 163, 184, 0.25)",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: `${harmoniaControls.tone * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "rgba(148, 163, 184, 0.25)",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: `${harmoniaControls.tone * 100}%`,
                  top: `${(1 - harmoniaControls.dynamics) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: "2px solid #27E0B0",
                  background: "rgba(39, 224, 176, 0.25)",
                  boxShadow: "0 0 16px rgba(39, 224, 176, 0.4)",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>
          <div
            style={{
              flex: "0 0 calc(50% - 8px)",
              maxWidth: "calc(50% - 8px)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#94a3b8",
                display: "flex",
                alignItems: "center",
                minHeight: 18,
              }}
            >
              Chord Pads
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gridTemplateRows: "repeat(3, 1fr)",
                height: HARMONIA_PAD_HEIGHT,
                gap: 4,
              }}
            >
              {harmoniaDegreeLabels.map((label, index) => {
                const degree = index as HarmoniaScaleDegree;
                const preview = computeHarmoniaResolution(degree);
                const isActive = harmoniaSelectedDegree === degree;
                const summary = describeHarmoniaChord(preview);
                return (
                  <button
                    key={label}
                    type="button"
                    onPointerDown={(event) => {
                      if (event.pointerType !== "mouse") {
                        event.preventDefault();
                        handleHarmoniaPadPress(degree);
                      }
                    }}
                    onClick={() => handleHarmoniaPadPress(degree)}
                    aria-label={summary}
                    style={{
                      padding: 0,
                      borderRadius: 12,
                      border: `1px solid ${isActive ? "#27E0B0" : "#1f2a3d"}`,
                      background: isActive
                        ? "rgba(39, 224, 176, 0.16)"
                        : "#10192c",
                      color: "#e2e8f0",
                      textAlign: "left",
                      cursor: "pointer",
                      boxShadow: isActive
                        ? "0 0 16px rgba(39, 224, 176, 0.2)"
                        : "none",
                      transition: "background 0.15s ease",
                      height: "100%",
                      gridColumn: index === 0 ? "1 / -1" : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title={summary}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: isActive ? "#27E0B0" : "#1f2a3d",
                        boxShadow: isActive
                          ? "0 0 12px rgba(39, 224, 176, 0.45)"
                          : "none",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Section>
    );
  }

  if (isKeyboard) {
    stickySections.push(
      <Section key="keyboard" padding={10}>
        <div
          style={{
            position: "relative",
            height: 132,
            borderRadius: 10,
            background: "#0f172a",
            padding: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              height: "100%",
              borderRadius: 6,
              overflow: "hidden",
              background: "#0f172a",
              position: "relative",
              zIndex: 1,
            }}
          >
            {keyboardLayout.white.map(({ note }) => {
              const isPressed = pressedKeyboardNotes.has(note);
              return (
                <button
                  key={note}
                  type="button"
                  disabled={!canTrigger}
                  onPointerDown={(event) => {
                    if (!canTrigger) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setPressedKeyboardNotes((prev) => {
                      const next = new Set(prev);
                      next.add(note);
                      return next;
                    });
                    triggerKeyboardNote(note);
                  }}
                onPointerUp={(event) => {
                  if (!canTrigger) return;
                  event.preventDefault();
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  setPressedKeyboardNotes((prev) => {
                    const next = new Set(prev);
                    next.delete(note);
                    return next;
                  });
                  finalizeFreeKeyboardNote(note);
                }}
                onPointerCancel={() => {
                  setPressedKeyboardNotes((prev) => {
                    const next = new Set(prev);
                    next.delete(note);
                    return next;
                  });
                  finalizeFreeKeyboardNote(note);
                }}
                  style={{
                    flex: 1,
                    height: "100%",
                    border: "1px solid #1e293b",
                    borderTop: "none",
                    borderBottom: "none",
                    background: isPressed ? "#27E0B0" : "#f8fafc",
                    color: isPressed ? "#1F2532" : "#0f172a",
                    cursor: canTrigger ? "pointer" : "not-allowed",
                    opacity: canTrigger ? 1 : 0.5,
                    position: "relative",
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{note}</span>
                </button>
              );
            })}
          </div>
          {keyboardLayout.black.map(({ note, leftIndex }) => {
            const isPressed = pressedKeyboardNotes.has(note);
            const left = (leftIndex + 1) * whiteKeyWidth - blackKeyWidth / 2;
            return (
              <button
                key={note}
                type="button"
                disabled={!canTrigger}
                onPointerDown={(event) => {
                  if (!canTrigger) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setPressedKeyboardNotes((prev) => {
                    const next = new Set(prev);
                    next.add(note);
                    return next;
                  });
                  triggerKeyboardNote(note);
                }}
                onPointerUp={(event) => {
                  if (!canTrigger) return;
                  event.preventDefault();
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  setPressedKeyboardNotes((prev) => {
                    const next = new Set(prev);
                    next.delete(note);
                    return next;
                  });
                  finalizeFreeKeyboardNote(note);
                }}
                onPointerCancel={() => {
                  setPressedKeyboardNotes((prev) => {
                    const next = new Set(prev);
                    next.delete(note);
                    return next;
                  });
                  finalizeFreeKeyboardNote(note);
                }}
                style={{
                  position: "absolute",
                  top: 12,
                  left: `${Math.max(0, Math.min(100, left))}%`,
                  transform: "translateX(-50%)",
                  width: `${blackKeyWidth}%`,
                  height: "60%",
                  borderRadius: 6,
                  border: "1px solid #1e293b",
                  background: isPressed ? "#27E0B0" : "#1f2532",
                  color: isPressed ? "#1F2532" : "#e6f2ff",
                  cursor: canTrigger ? "pointer" : "not-allowed",
                  opacity: canTrigger ? 1 : 0.5,
                  zIndex: 2,
                }}
              >
                <span style={{ fontSize: 9, fontWeight: 600 }}>{note}</span>
              </button>
            );
          })}
        </div>
      </Section>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {presetControls}
      {stickySections.length ? (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingBottom: 8,
            background:
              "linear-gradient(180deg, rgba(11, 18, 32, 0.96) 0%, rgba(11, 18, 32, 0.88) 60%, rgba(11, 18, 32, 0) 100%)",
          }}
        >
          {stickySections}
        </div>
      ) : null}

      <Section>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 11,
            color: "#94a3b8",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Instrument</span>
            <span style={{ color: "#e6f2ff" }}>{instrumentLabel}</span>
          </div>
          {track.source?.characterId ? (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Style</span>
              <span style={{ color: "#e6f2ff" }}>
                {formatInstrumentLabel(track.source.characterId)}
              </span>
            </div>
          ) : null}
        </div>
      </Section>

      {isHarmonia ? (
        <Section>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <label style={{ flex: "1 1 180px", fontSize: 12 }}>
              <span
                style={{
                  display: "block",
                  marginBottom: 4,
                  color: "#94a3b8",
                  fontWeight: 600,
                }}
              >
                Key / Tonal Center
              </span>
              <select
                value={harmoniaTonalCenter}
                onChange={(event) => handleHarmoniaKeyChange(event.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #273144",
                  background: "#111a2c",
                  color: "#f8fafc",
                }}
              >
                {availableNotes.map((note) => (
                  <option key={note} value={note}>
                    {note}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ flex: "1 1 200px", fontSize: 12 }}>
              <span
                style={{
                  display: "block",
                  marginBottom: 4,
                  color: "#94a3b8",
                  fontWeight: 600,
                }}
              >
                Scale / Mode
              </span>
              <select
                value={harmoniaScaleName}
                onChange={(event) => handleHarmoniaScaleChange(event.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #273144",
                  background: "#111a2c",
                  color: "#f8fafc",
                }}
              >
                {SCALE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option.replace(/([a-z])([A-Z])/g, "$1 $2")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Slider
            label="Complexity"
            min={0}
            max={HARMONIA_COMPLEXITY_ORDER.length - 1}
            step={1}
            value={harmoniaComplexityIndex}
            formatValue={(value) => {
              const index = clamp(
                Math.round(value),
                0,
                HARMONIA_COMPLEXITY_ORDER.length - 1
              );
              const name = HARMONIA_COMPLEXITY_ORDER[index];
              return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
            }}
            onChange={handleHarmoniaComplexityChange}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={toggleHarmoniaBass}
              aria-pressed={harmoniaControls.bassEnabled}
              style={{
                flex: "1 1 140px",
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${harmoniaControls.bassEnabled ? "#27E0B0" : "#1f2a3d"}`,
                background: harmoniaControls.bassEnabled
                  ? "rgba(39, 224, 176, 0.16)"
                  : "#10192c",
                color: "#e2e8f0",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Bass {harmoniaControls.bassEnabled ? "On" : "Off"}
            </button>
            <button
              type="button"
              onClick={toggleHarmoniaArp}
              aria-pressed={harmoniaControls.arpEnabled}
              style={{
                flex: "1 1 140px",
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${harmoniaControls.arpEnabled ? "#27E0B0" : "#1f2a3d"}`,
                background: harmoniaControls.arpEnabled
                  ? "rgba(39, 224, 176, 0.16)"
                  : "#10192c",
                color: "#e2e8f0",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Arp {harmoniaControls.arpEnabled ? "On" : "Off"}
            </button>
          </div>
      </Section>
    ) : null}

      {isHarmonia ? (
        <Section>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#94a3b8",
              }}
            >
              Progression Patterns
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                onClick={() => applyHarmoniaPatternPreset(null)}
                style={{
                  flex: "1 1 140px",
                  minWidth: 120,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${harmoniaPatternId ? "#1f2a3d" : "#27E0B0"}`,
                  background: harmoniaPatternId
                    ? "#10192c"
                    : "rgba(39, 224, 176, 0.16)",
                  color: "#e2e8f0",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                }}
              >
                Custom
              </button>
              {harmoniaPatternPresets.map((preset) => {
                const isSelected = harmoniaPatternId === preset.id;
                const sequence = preset.degrees
                  .map((degree) => harmoniaDegreeLabels[degree] ?? "")
                  .join(" – ");
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyHarmoniaPatternPreset(preset.id)}
                    style={{
                      flex: "1 1 180px",
                      minWidth: 160,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1px solid ${isSelected ? "#27E0B0" : "#1f2a3d"}`,
                      background: isSelected
                        ? "rgba(39, 224, 176, 0.16)"
                        : "#10192c",
                      color: "#e2e8f0",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      fontSize: 11,
                      boxShadow: isSelected
                        ? "0 0 16px rgba(39, 224, 176, 0.18)"
                        : "none",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{preset.name}</span>
                    <span style={{ color: "#94a3b8", fontSize: 10 }}>{sequence}</span>
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {harmoniaActivePattern
                ? harmoniaActivePattern.description
                : "Record chords or edit steps to create your own progression."}
            </span>
          </div>
        </Section>
      ) : null}

      <Section>
        <Slider
          label={isHarmonia ? "Dynamics" : "Velocity"}
          min={0}
          max={isHarmonia ? 1 : 2}
          step={0.01}
          value={isHarmonia ? harmoniaControls.dynamics : activeVelocity}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          onChange={
            updatePattern
              ? (value) => {
                  const payload: Partial<Chunk> = { velocityFactor: value };
                  if (isHarmonia) {
                    payload.harmoniaDynamics = value;
                  }
                  updatePattern(payload);
                }
              : undefined
          }
        />
      </Section>

      {isKick ? (
        <Section>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Shape the transient, saturation, and tail of the Kick Designer layer blend.
          </span>
          <Slider
            label="Punch ↔ Sub"
            min={0}
            max={1}
            step={0.01}
            value={kickState.punch}
            formatValue={(value) =>
              `${Math.round((1 - value) * 100)}% Punch / ${Math.round(value * 100)}% Sub`
            }
            onChange={
              updatePattern ? (value) => updatePattern({ punch: value }) : undefined
            }
          />
          <Slider
            label="Clean ↔ Dirty"
            min={0}
            max={1}
            step={0.01}
            value={kickState.clean}
            formatValue={(value) =>
              `${Math.round((1 - value) * 100)}% Clean / ${Math.round(value * 100)}% Dirty`
            }
            onChange={
              updatePattern ? (value) => updatePattern({ clean: value }) : undefined
            }
          />
          <Slider
            label="Tight ↔ Long"
            min={0}
            max={1}
            step={0.01}
            value={kickState.tight}
            formatValue={(value) =>
              `${Math.round((1 - value) * 100)}% Tight / ${Math.round(value * 100)}% Long`
            }
            onChange={
              updatePattern ? (value) => updatePattern({ tight: value }) : undefined
            }
          />
        </Section>
      ) : null}

      {isPercussive ? (
        <Section>
          <Slider
            label="Pitch"
            min={-12}
            max={12}
            step={1}
            value={pattern.pitchOffset ?? 0}
            formatValue={(value) => `${value > 0 ? "+" : ""}${value} st`}
            onChange={updatePattern ? (value) => updatePattern({ pitchOffset: value }) : undefined}
          />
          <Slider
            label="Swing"
            min={0}
            max={1}
            step={0.01}
            value={pattern.swing ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ swing: value }) : undefined}
          />
          <Slider
            label="Humanize"
            min={0}
            max={1}
            step={0.01}
            value={pattern.humanize ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ humanize: value }) : undefined}
          />
        </Section>
      ) : null}

      {isBass ? (
        <Section>
          <Slider
            label="Attack"
            min={0}
            max={0.5}
            step={0.005}
            value={pattern.attack ?? 0.01}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ attack: value }) : undefined}
          />
          <Slider
            label="Release"
            min={0}
            max={1}
            step={0.01}
            value={pattern.sustain ?? 0.2}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ sustain: value }) : undefined}
          />
          <Slider
            label="Glide"
            min={0}
            max={0.5}
            step={0.01}
            value={pattern.glide ?? 0}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ glide: value }) : undefined}
          />
          <Slider
            label="Filter"
            min={0}
            max={1}
            step={0.01}
            value={pattern.filter ?? 1}
            formatValue={(value) =>
              `${Math.round(filterValueToFrequency(value))} Hz`
            }
            onChange={updatePattern ? (value) => updatePattern({ filter: value }) : undefined}
          />
        </Section>
      ) : null}

      {isArp ? (
        <Section>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 12,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Root</span>
              <select
                value={arpRoot}
                onChange={(event) => {
                  const nextNote = event.target.value;
                  if (!updatePattern) return;
                  const degrees = pattern.degrees ?? [];
                  const partial: Partial<Chunk> = { note: nextNote };
                  if (degrees.length) {
                    partial.notes = createChordNotes(nextNote, degrees);
                  }
                  updatePattern(partial);
                }}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #2a3344",
                  background: "#121827",
                  color: "#e6f2ff",
                  fontSize: 12,
                }}
              >
                {availableNotes.map((note) => (
                  <option key={note} value={note}>
                    {note}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Style</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["up", "down", "up-down", "random", "unfold"].map((style) => (
                  <button
                    key={style}
                    onClick={() => updatePattern?.({ style })}
                    style={{
                      flex: "1 1 48%",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #2a3344",
                      background:
                        pattern.style === style
                          ? "#27E0B0"
                          : "#1f2532",
                      color:
                        pattern.style === style ? "#1F2532" : "#e6f2ff",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {style.replace("-", " ")}
                  </button>
                ))}
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Mode</span>
              <div style={{ display: "flex", gap: 8 }}>
                {["manual", "continuous"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updatePattern?.({ mode })}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #2a3344",
                      background:
                        pattern.mode === mode ? "#27E0B0" : "#1f2532",
                      color:
                        pattern.mode === mode ? "#1F2532" : "#e6f2ff",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Rate</span>
              <select
                value={pattern.arpRate ?? "1/16"}
                onChange={(event) =>
                  updatePattern?.({ arpRate: event.target.value })
                }
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #2a3344",
                  background: "#121827",
                  color: "#e6f2ff",
                  fontSize: 12,
                }}
              >
                {arpRateOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 8,
              marginTop: 10,
            }}
          >
            {arpPadPresets.map((preset) => {
              const active = chordMatchesDegrees(preset.degrees);
              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    if (!updatePattern) return;
                    const notes = createChordNotes(arpRoot, preset.degrees);
                    updatePattern({ degrees: preset.degrees, notes });
                  }}
                  style={{
                    padding: "16px 12px",
                    borderRadius: 12,
                    border: "1px solid #2a3344",
                    background: active ? "#27E0B0" : "#1f2532",
                    color: active ? "#1F2532" : "#e6f2ff",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <Slider
              label="Gate"
              min={0.1}
              max={1}
              step={0.01}
              value={pattern.arpGate ?? 0.6}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onChange={updatePattern ? (value) => updatePattern({ arpGate: value }) : undefined}
            />
            <Slider
              label="Octaves"
              min={1}
              max={4}
              step={1}
              value={pattern.arpOctaves ?? 1}
              formatValue={(value) => `${value}x`}
              onChange={updatePattern ? (value) => updatePattern({ arpOctaves: value }) : undefined}
            />
            <Slider
              label="Pitch Bend"
              min={-5}
              max={5}
              step={0.5}
              value={pattern.pitchBend ?? 0}
              formatValue={(value) => `${value > 0 ? "+" : ""}${value} st`}
              onChange={updatePattern ? (value) => updatePattern({ pitchBend: value }) : undefined}
            />
            <Slider
              label="Sustain"
              min={0}
              max={1.5}
              step={0.01}
              value={pattern.sustain ?? 0.2}
              formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
              onChange={updatePattern ? (value) => updatePattern({ sustain: value }) : undefined}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#e6f2ff",
              }}
            >
              <span style={{ fontWeight: 600 }}>Latch</span>
              <button
                onClick={() =>
                  updatePattern?.({ arpLatch: !(pattern.arpLatch ?? false) })
                }
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid #2a3344",
                  background: pattern.arpLatch ? "#27E0B0" : "#1f2532",
                  color: pattern.arpLatch ? "#1F2532" : "#e6f2ff",
                  cursor: "pointer",
                }}
              >
                {pattern.arpLatch ? "On" : "Off"}
              </button>
            </div>
          </div>
        </Section>
      ) : null}
      {isKeyboard ? (
        <Section>
          <Slider
            label="Attack"
            min={0}
            max={2}
            step={0.01}
            value={pattern.attack ?? 0.05}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ attack: value }) : undefined}
          />
          <Slider
            label="Sustain"
            min={0}
            max={3}
            step={0.01}
            value={pattern.sustain ?? 0.8}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ sustain: value }) : undefined}
          />
          <Slider
            label="Glide"
            min={0}
            max={1}
            step={0.01}
            value={pattern.glide ?? 0}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ glide: value }) : undefined}
          />
          <Slider
            label="Pan"
            min={-1}
            max={1}
            step={0.01}
            value={pattern.pan ?? 0}
            formatValue={(value) => `${(value * 100).toFixed(0)}%`}
            onChange={updatePattern ? (value) => updatePattern({ pan: value }) : undefined}
          />
          <Slider
            label="Reverb"
            min={0}
            max={1}
            step={0.01}
            value={pattern.reverb ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ reverb: value }) : undefined}
          />
          <Slider
            label="Delay"
            min={0}
            max={1}
            step={0.01}
            value={pattern.delay ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ delay: value }) : undefined}
          />
          <Slider
            label="Distortion"
            min={0}
            max={1}
            step={0.01}
            value={pattern.distortion ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ distortion: value }) : undefined}
          />
          <Slider
            label="Bitcrusher"
            min={0}
            max={1}
            step={0.01}
            value={pattern.bitcrusher ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ bitcrusher: value }) : undefined}
          />
          <Slider
            label="Chorus"
            min={0}
            max={1}
            step={0.01}
            value={pattern.chorus ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ chorus: value }) : undefined}
          />
          <Slider
            label="Filter"
            min={0}
            max={1}
            step={0.01}
            value={pattern.filter ?? 1}
            formatValue={(value) =>
              `${Math.round(filterValueToFrequency(value))} Hz`
            }
            onChange={updatePattern ? (value) => updatePattern({ filter: value }) : undefined}
          />
        </Section>
      ) : null}

      {!isPercussive && !isBass && !isArp && !isKeyboard ? (
        <Section>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            This instrument does not have dedicated controls yet.
          </span>
        </Section>
      ) : null}
    </div>
  );
};

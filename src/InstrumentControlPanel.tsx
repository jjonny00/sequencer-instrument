import type { FC, PropsWithChildren, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";

import type { Chunk } from "./chunks";
import type { Track } from "./tracks";
import { formatInstrumentLabel } from "./utils/instrument";
import { filterValueToFrequency } from "./utils/audio";

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
    chunk?: Chunk
  ) => void;
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

const isPercussiveInstrument = (instrument: string) =>
  ["kick", "snare", "hat", "cowbell"].includes(instrument);

const createChordNotes = (rootNote: string, degrees: number[]) => {
  const rootMidi = Tone.Frequency(rootNote).toMidi();
  return degrees.map((degree) =>
    Tone.Frequency(rootMidi + degree, "midi").toNote()
  );
};

const DEGREE_LABELS = ["I", "II", "III", "IV", "V", "VI", "VII"] as const;

const SCALE_INTERVALS = {
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

type ScaleName = keyof typeof SCALE_INTERVALS;

const SCALE_OPTIONS = Object.keys(SCALE_INTERVALS) as ScaleName[];

const isScaleName = (value: string | undefined | null): value is ScaleName =>
  value !== undefined && value !== null && SCALE_OPTIONS.includes(value as ScaleName);

const arraysEqual = <T,>(a?: T[] | null, b?: T[] | null) => {
  if (!a || !b) return Boolean(!a && !b);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const getScaleDegreeOffset = (intervals: readonly number[], degreeIndex: number) => {
  if (!intervals.length) return 0;
  const length = intervals.length;
  const normalizedIndex = ((degreeIndex % length) + length) % length;
  const base = intervals[normalizedIndex];
  const octaves = Math.floor((degreeIndex - normalizedIndex) / length);
  return base + octaves * 12;
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
}) => {
  const pattern = track.pattern;
  const instrumentLabel = formatInstrumentLabel(track.instrument ?? "");
  const isPercussive = isPercussiveInstrument(track.instrument ?? "");
  const isBass = track.instrument === "bass";
  const isArp = track.instrument === "arpeggiator";
  const isKeyboard = track.instrument === "chord";
  const [activeDegree, setActiveDegree] = useState<number | null>(null);
  const [pressedKeyboardNotes, setPressedKeyboardNotes] = useState<
    Set<string>
  >(() => new Set());
  const [isRecording, setIsRecording] = useState(false);
  const arpScheduleIdRef = useRef<number | null>(null);
  const latchedDegreeRef = useRef<number | null>(null);
  const unfoldProgressRef = useRef(0);
  const autopMaskRef = useRef<boolean[]>(Array(16).fill(false));
  const previousAutopilotRef = useRef(pattern?.autopilot ?? false);

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

  const activeVelocity = pattern?.velocityFactor ?? 1;
  const manualVelocity = Math.max(0, Math.min(1, activeVelocity));
  const canTrigger = Boolean(trigger && pattern);
  const showRecordButton = (isArp || isKeyboard) && Boolean(onUpdatePattern);

  const arpRoot = pattern?.note ?? "C4";
  const arpRateOptions = ["1/32", "1/16", "1/8", "1/4"] as const;

  const availableNotes = useMemo(() => {
    const octaves = [2, 3, 4, 5];
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return octaves.flatMap((octave) =>
      noteNames.map((note) => `${note}${octave}`)
    );
  }, []);

  const tonalCenter = pattern?.tonalCenter ?? pattern?.note ?? "C4";
  const scaleName = isScaleName(pattern?.scale)
    ? (pattern?.scale as ScaleName)
    : "Major";
  const selectedDegree = Math.min(6, Math.max(0, pattern?.degree ?? 0));
  const extensionsEnabled = pattern?.useExtensions ?? false;
  const autopilotEnabled = pattern?.autopilot ?? false;
  const arpStyle = pattern?.style ?? "up";
  const arpRate = pattern?.arpRate ?? "1/16";
  const arpGate = pattern?.arpGate ?? 0.6;
  const arpOctaves = pattern?.arpOctaves ?? 1;
  const latchEnabled = pattern?.arpLatch ?? false;

  const chordDefinition = useMemo(
    () => buildChordForDegree(tonalCenter, scaleName, selectedDegree, extensionsEnabled),
    [tonalCenter, scaleName, selectedDegree, extensionsEnabled]
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

  const ensureArrayLength = (values: number[] | undefined, length: number, fill: number) => {
    const next = values ? values.slice(0, length) : Array(length).fill(fill);
    if (next.length < length) {
      next.push(...Array(length - next.length).fill(fill));
    }
    return next;
  };

  const recordNoteToPattern = useCallback(
    (
      noteName: string,
      eventTime: number,
      baseNote: string,
      velocity: number,
      options?: { includeChordMeta?: boolean }
    ) => {
      if (!onUpdatePattern) return;
      const ticksPerStep = Tone.Transport.PPQ / 4;
      const ticks = Tone.Transport.getTicksAtTime(eventTime);
      onUpdatePattern((chunk) => {
        const length = chunk.steps.length || 16;
        const stepIndex = length
          ? Math.floor(ticks / ticksPerStep) % length
          : 0;
        const steps = chunk.steps.slice();
        const velocities = ensureArrayLength(
          chunk.velocities,
          length,
          1
        );
        const pitches = ensureArrayLength(chunk.pitches, length, 0);
        const baseMidi = Tone.Frequency(chunk.note ?? baseNote).toMidi();
        const midi = Tone.Frequency(noteName).toMidi();
        steps[stepIndex] = 1;
        velocities[stepIndex] = Math.max(
          0,
          Math.min(1, velocity)
        );
        pitches[stepIndex] = midi - baseMidi;

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
          arpRate: pattern?.arpRate ?? chunk.arpRate,
          arpGate: pattern?.arpGate ?? chunk.arpGate,
          arpLatch: pattern?.arpLatch ?? chunk.arpLatch,
          arpOctaves: pattern?.arpOctaves ?? chunk.arpOctaves,
          tonalCenter,
          scale: scaleName,
          degree: selectedDegree,
          useExtensions: extensionsEnabled,
          autopilot: autopilotEnabled,
          steps,
          velocities,
          pitches,
        };

        if (options?.includeChordMeta) {
          nextChunk.note = chordDefinition.root;
          nextChunk.notes = chordDefinition.notes.slice();
          nextChunk.degrees = chordDefinition.degrees.slice();
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
    ]
  );

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
      const octaves = Math.max(1, pattern.arpOctaves ?? 1);
      const style = pattern.style ?? "up";
      const rate = pattern.arpRate ?? "1/16";
    const rateSeconds = Tone.Time(rate).toSeconds();
    const gate = Math.max(0.1, Math.min(1, pattern.arpGate ?? 0.6));
    const sustain =
      pattern.sustain !== undefined ? pattern.sustain : rateSeconds * gate;
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
        if (autopilotEnabled && mask.some(Boolean)) {
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
            recordNoteToPattern(bentNote, time, baseNote, manualVelocity, {
              includeChordMeta: true,
            });
          }, time);
        }
      },
      rate,
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
    ]
  );

  const triggerKeyboardNote = (note: string) => {
    if (!trigger || !pattern) return;
    const bend = pattern.pitchBend ?? 0;
    const sustain = pattern.sustain ?? 0.8;
    const noteName = bend ? Tone.Frequency(note).transpose(bend).toNote() : note;
    const time = Tone.now();
    trigger(time, manualVelocity, 0, noteName, sustain, pattern);

    if (isRecording && onUpdatePattern) {
      const baseNote = pattern.note ?? note;
      Tone.Draw.schedule(() => {
        recordNoteToPattern(noteName, time, baseNote, manualVelocity);
      }, time);
    }
  };

  useEffect(() => {
    autopMaskRef.current = autopMask;
  }, [autopMask]);

  useEffect(() => () => stopArpPlayback(), [stopArpPlayback]);

  useEffect(() => {
    setIsRecording(false);
    stopArpPlayback();
    setActiveDegree(null);
    setPressedKeyboardNotes(new Set());
  }, [track.id, track.instrument, stopArpPlayback]);

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
      setIsRecording(false);
    }
  }, [isArp, isKeyboard]);

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
    scheduleArpPlayback,
    stopArpPlayback,
  ]);

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

  const stickySections: ReactNode[] = [];

  const renderRecordToggle = () => {
    if (!showRecordButton) return null;
    return (
      <div
        style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}
      >
        <button
          type="button"
          onClick={() => setIsRecording((prev) => !prev)}
          disabled={!onUpdatePattern}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #2a3344",
            background: isRecording ? "#E02749" : "#27E0B0",
            color: isRecording ? "#ffe4e6" : "#1F2532",
            fontSize: 11,
            fontWeight: 600,
            cursor: onUpdatePattern ? "pointer" : "not-allowed",
            opacity: onUpdatePattern ? 1 : 0.5,
          }}
        >
          {isRecording ? "Recording" : "Record"}
        </button>
      </div>
    );
  };

  if (isArp) {
    stickySections.push(
      <Section key="arp-controls" padding={12}>
        {renderRecordToggle()}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <label style={{ flex: 1, minWidth: 140, fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>
              Tonal Center
            </div>
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
          <label style={{ flex: 1.2, minWidth: 160, fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>
              Scale / Mode
            </div>
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
          <label style={{ flex: 1, minWidth: 140, fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>
              Style
            </div>
            <select
              value={arpStyle}
              onChange={(event) => {
                updatePattern?.({ style: event.target.value });
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
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="up-down">Up / Down</option>
              <option value="random">Random</option>
              <option value="unfold">Unfold</option>
            </select>
          </label>
        </div>
        <div
          style={{
            position: "relative",
            height: 180,
            marginBottom: 16,
            borderRadius: "50%",
            background: "radial-gradient(circle at center, #1e293b 0%, #101726 70%)",
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
            <div style={{ fontSize: 28, fontWeight: 700 }}>{degreeLabel}</div>
            <div style={{ fontSize: 13, letterSpacing: 0.4 }}>{chordDefinition.root}</div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
              {chordSummary}
            </div>
          </div>
          {DEGREE_LABELS.map((label, index) => {
            const position = degreePositions[index];
            const isSelected = selectedDegree === index;
            const isActive = activeDegree === index;
            const highlighted = isActive || isSelected;
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
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  border: "1px solid #273144",
                  background: highlighted ? "#27E0B0" : "#0f172a",
                  color: highlighted ? "#0e151f" : "#f8fafc",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 16,
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
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 12,
          }}
        >
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
              borderRadius: 6,
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
          <button
            type="button"
            onClick={() => {
              applyChordSettings(tonalCenter, scaleName, selectedDegree, !extensionsEnabled);
              if (autopilotEnabled || latchEnabled || activeDegree !== null) {
                scheduleArpPlayback(selectedDegree);
              }
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
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
            onClick={() => {
              const next = !autopilotEnabled;
              updatePattern?.({ autopilot: next });
              if (!next) {
                latchedDegreeRef.current = null;
              }
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid #273144",
              background: autopilotEnabled ? "#27E0B0" : "#111a2c",
              color: autopilotEnabled ? "#0e151f" : "#e2e8f0",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Autopilot {autopilotEnabled ? "On" : "Off"}
          </button>
        </div>
        {autopilotEnabled ? (
          <div
            style={{
              fontSize: 11,
              marginBottom: 12,
              color: autopHasHits ? "#94a3b8" : "#fca5a5",
            }}
          >
            {autopHasHits
              ? "Follows kick and snare accents."
              : "No kick or snare hits detected in the current loop."}
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <label style={{ flex: 1, minWidth: 120, fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>
              Rate
            </div>
            <select
              value={arpRate}
              onChange={(event) => updatePattern?.({ arpRate: event.target.value })}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #273144",
                background: "#111a2c",
                color: "#f8fafc",
              }}
            >
              {arpRateOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Slider
              label="Gate"
              min={0.1}
              max={1}
              step={0.05}
              value={arpGate}
              onChange={updatePattern ? (value) => updatePattern({ arpGate: value }) : undefined}
              formatValue={(value) => `${Math.round(value * 100)}%`}
            />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Slider
              label="Octave Range"
              min={1}
              max={4}
              step={1}
              value={arpOctaves}
              onChange={updatePattern ? (value) => updatePattern({ arpOctaves: value }) : undefined}
            />
          </div>
        </div>
      </Section>
    );
  }

  if (isKeyboard) {
    stickySections.push(
      <Section key="keyboard" padding={10}>
        {renderRecordToggle()}
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
                  }}
                  onPointerCancel={() => {
                    setPressedKeyboardNotes((prev) => {
                      const next = new Set(prev);
                      next.delete(note);
                      return next;
                    });
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
                }}
                onPointerCancel={() => {
                  setPressedKeyboardNotes((prev) => {
                    const next = new Set(prev);
                    next.delete(note);
                    return next;
                  });
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
              <span>Character</span>
              <span style={{ color: "#e6f2ff" }}>
                {formatInstrumentLabel(track.source.characterId)}
              </span>
            </div>
          ) : null}
        </div>
      </Section>

      <Section>
        <Slider
          label="Velocity"
          min={0}
          max={2}
          step={0.01}
          value={activeVelocity}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          onChange={updatePattern ? (value) => updatePattern({ velocityFactor: value }) : undefined}
        />
      </Section>

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

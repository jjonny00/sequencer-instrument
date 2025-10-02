import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import type {
  CSSProperties,
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";

import type { Chunk } from "./chunks";
import type {
  PatternGroup,
  PerformanceNote,
  PerformanceTrack,
  SongRow,
} from "./song";
import {
  createPerformanceSettingsSnapshot,
  createSongRow,
  getPerformanceTracksSpanMeasures,
} from "./song";
import { getInstrumentColor, withAlpha } from "./utils/color";
import {
  createTriggerKey,
  type Track,
  type TrackInstrument,
  type TriggerMap,
} from "./tracks";
import { packs } from "./packs";
import { Modal } from "./components/Modal";
import { IconButton } from "./components/IconButton";
import { InstrumentControlPanel } from "./InstrumentControlPanel";
interface SongViewProps {
  patternGroups: PatternGroup[];
  songRows: SongRow[];
  setSongRows: Dispatch<SetStateAction<SongRow[]>>;
  currentSectionIndex: number;
  isPlaying: boolean;
  bpm: number;
  setBpm: Dispatch<SetStateAction<number>>;
  onToggleTransport: () => void;
  selectedGroupId: string | null;
  onSelectLoop: (groupId: string) => void;
  performanceTracks: PerformanceTrack[];
  triggers: TriggerMap;
  onEnsurePerformanceRow: (
    instrument: TrackInstrument,
    existingId?: string | null
  ) => string | null;
  activePerformanceTrackId: string | null;
  onAddPerformanceTrack?: () => void;
  onSelectPerformanceTrack?: (trackId: string | null) => void;
  onPlayInstrumentOpenChange?: (open: boolean) => void;
  onUpdatePerformanceTrack?: (
    trackId: string,
    updater: (track: PerformanceTrack) => PerformanceTrack
  ) => void;
  onRemovePerformanceTrack?: (trackId: string) => void;
  onSaveSong?: () => void;
  onOpenLoadSong?: () => void;
  onOpenExportSong?: () => void;
}

const SLOT_WIDTH = 150;
const SLOT_GAP = 8;
const ROW_LABEL_WIDTH = 60;
const MAX_PREVIEW_STEPS = 16;
const PREVIEW_GAP = 1;
const PREVIEW_HEIGHT = 10;
const PREVIEW_DOT_SIZE = 4;
const PERFORMANCE_DOT_SIZE = 5;
const SLOT_MIN_HEIGHT = 52;
const SLOT_CONTENT_GAP = 4;
const SLOT_PADDING = "4px 10px";
const APPROXIMATE_ROW_OFFSET = 28;
const TIMELINE_VISIBLE_ROWS_COLLAPSED = 1.5;
const TIMELINE_VISIBLE_ROWS_EXPANDED = 3;

const TICKS_PER_QUARTER = Tone.Transport.PPQ;
const TICKS_PER_SIXTEENTH = TICKS_PER_QUARTER / 4;
const TICKS_PER_MEASURE = TICKS_PER_SIXTEENTH * 16;

const toTicks = (value: string | number | undefined | null): number => {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "number") {
    return value * TICKS_PER_MEASURE;
  }
  try {
    return Tone.Time(value).toTicks();
  } catch (error) {
    console.warn("Failed to convert time to ticks", value, error);
    return 0;
  }
};

const ensurePositiveTicks = (ticks: number, fallback: number) =>
  Number.isFinite(ticks) && ticks > 0 ? ticks : fallback;

const getPerformanceNoteRangeTicks = (note: PerformanceNote) => {
  const startTicks = toTicks(note.time);
  const durationTicks = ensurePositiveTicks(
    toTicks(note.duration),
    TICKS_PER_QUARTER
  );
  return {
    startTicks,
    endTicks: startTicks + durationTicks,
    durationTicks,
  };
};

const sortPerformanceNotes = (a: PerformanceNote, b: PerformanceNote) => {
  const { startTicks: aStart } = getPerformanceNoteRangeTicks(a);
  const { startTicks: bStart } = getPerformanceNoteRangeTicks(b);
  return aStart - bStart;
};

const countPerformanceNotesInRange = (
  notes: PerformanceNote[],
  columnStartTicks: number,
  columnEndTicks: number
) =>
  notes.filter((note) => {
    const { startTicks, endTicks } = getPerformanceNoteRangeTicks(note);
    return endTicks > columnStartTicks && startTicks < columnEndTicks;
  }).length;

const ticksToTransportString = (ticks: number) =>
  Tone.Ticks(Math.max(0, ticks)).toBarsBeatsSixteenths();

const ticksToDurationString = (ticks: number) => {
  const safeTicks = Math.max(TICKS_PER_SIXTEENTH / 4, ticks);
  const notation = Tone.Ticks(safeTicks).toNotation();
  if (notation && notation !== "0") {
    return notation;
  }
  const seconds = Tone.Ticks(safeTicks).toSeconds();
  return `${seconds.toFixed(3)}s`;
};

const getColumnTickBounds = (columnIndex: number) => ({
  startTicks: columnIndex * TICKS_PER_MEASURE,
  endTicks: (columnIndex + 1) * TICKS_PER_MEASURE,
});

const createPerformancePattern = (
  instrument: TrackInstrument,
  timingMode: "sync" | "free" = "sync"
): Chunk => ({
  id: `live-${instrument}-${Math.random().toString(36).slice(2, 8)}`,
  name: `${instrument}-performance`,
  instrument,
  steps: Array(16).fill(0),
  velocities: Array(16).fill(0),
  note: "C4",
  sustain: 0.8,
  velocityFactor: 1,
  timingMode,
  noteEvents: [],
});

const resolveInstrumentSource = (instrument: TrackInstrument) => {
  if (!instrument) return null;
  for (const pack of packs) {
    const definition = pack.instruments?.[instrument];
    if (!definition) continue;
    const characterId =
      definition.defaultCharacterId ??
      (definition.characters.length > 0 ? definition.characters[0].id : "");
    return {
      packId: pack.id,
      characterId,
    };
  }
  return null;
};

const formatInstrumentLabel = (instrument: string | null | undefined) =>
  instrument ? instrument.charAt(0).toUpperCase() + instrument.slice(1) : "";

const formatNoteCount = (count: number) =>
  `${count} note${count === 1 ? "" : "s"}`;

interface LoopPreviewTrack {
  color: string;
  steps: number[];
  velocities?: number[];
}

const sampleArrayValue = (
  values: number[] | undefined,
  sourceIndex: number,
  sourceLength: number,
  targetLength: number
) => {
  if (!values || values.length === 0) {
    return 0;
  }
  if (values.length === targetLength) {
    return values[sourceIndex] ?? 0;
  }
  if (targetLength === 0) {
    return 0;
  }
  if (values.length === sourceLength) {
    return values[sourceIndex] ?? 0;
  }
  const ratio = values.length / targetLength;
  const sampledIndex = Math.floor(sourceIndex * ratio);
  return values[sampledIndex] ?? 0;
};

const createLoopPreviewData = (tracks: Track[]): LoopPreviewTrack[] =>
  tracks
    .filter((track) => track.pattern && track.pattern.steps.length > 0)
    .map((track) => ({
      color: getInstrumentColor(track.instrument),
      steps: track.pattern ? track.pattern.steps.slice() : [],
      velocities: track.pattern?.velocities
        ? track.pattern.velocities.slice()
        : undefined,
    }));

const renderLoopSlotPreview = (group: PatternGroup | undefined) => {
  if (!group) {
    return (
      <div
        style={{
          height: PREVIEW_HEIGHT,
          borderRadius: 6,
          border: "1px dashed #2d3748",
          background: "rgba(15, 23, 42, 0.35)",
        }}
      />
    );
  }

  const previewTracks = createLoopPreviewData(group.tracks);
  if (previewTracks.length === 0) {
    return (
      <div
        style={{
          height: PREVIEW_HEIGHT,
          borderRadius: 6,
          background: "rgba(30, 41, 59, 0.65)",
          border: "1px solid #1f2937",
        }}
      />
    );
  }

  const targetStepCount = Math.max(
    8,
    Math.min(
      MAX_PREVIEW_STEPS,
      previewTracks.reduce(
        (max, track) => Math.max(max, track.steps.length),
        0
      )
    )
  );

  const gap = PREVIEW_GAP;
  const dotSize = PREVIEW_DOT_SIZE;
  const containerHeight = PREVIEW_HEIGHT;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${targetStepCount}, minmax(0, 1fr))`,
        gap,
        width: "100%",
        height: containerHeight,
        background: "rgba(15, 23, 42, 0.65)",
        borderRadius: 6,
        padding: gap,
      }}
    >
      {Array.from({ length: targetStepCount }, (_, stepIndex) => (
        <div
          key={`preview-step-${stepIndex}`}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap,
          }}
        >
          {previewTracks.map((track, trackIndex) => {
            const stepLength = track.steps.length;
            if (stepLength === 0) {
              return null;
            }
            const ratio = stepLength / targetStepCount;
            const sampledIndex = Math.floor(stepIndex * ratio);
            const rawValue =
              track.steps[sampledIndex] ?? track.steps[stepIndex % stepLength];
            const velocity = sampleArrayValue(
              track.velocities,
              sampledIndex,
              stepLength,
              targetStepCount
            );
            const active = rawValue > 0;
            const opacity = active
              ? Math.max(0.35, Math.min(1, velocity || 0.85))
              : 0.12;

            return (
              <span
                key={`preview-track-${trackIndex}`}
                style={{
                  width: dotSize,
                  height: dotSize,
                  borderRadius: dotSize / 2,
                  background: track.color,
                  opacity,
                  transition: "opacity 0.2s ease",
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};

const renderPerformanceSlotPreview = (
  performanceTrack: PerformanceTrack | undefined,
  columnStart: number,
  columnEnd: number,
  accent: string | null,
  ghostNotes?: PerformanceNote[],
  ghostNoteRefs?: Set<PerformanceNote>,
  highlightRange?: { start: number; end: number; color?: string }
) => {
  const height = PREVIEW_HEIGHT;
  const columnStartTicks = columnStart * TICKS_PER_MEASURE;
  const columnEndTicks = columnEnd * TICKS_PER_MEASURE;
  const trackNotes = performanceTrack?.notes ?? [];
  const combinedNotes = trackNotes.slice();
  if (ghostNotes && ghostNotes.length) {
    const trackNoteSet = new Set(trackNotes);
    ghostNotes.forEach((note) => {
      if (!trackNoteSet.has(note)) {
        combinedNotes.push(note);
      }
    });
  }

  if (combinedNotes.length === 0) {
    return (
      <div
        style={{
          height,
          borderRadius: 6,
          background: "rgba(15, 23, 42, 0.75)",
          border: "1px solid #1f2937",
        }}
      />
    );
  }

  const trackNotesInColumn = combinedNotes.filter((note) => {
    const { startTicks, endTicks } = getPerformanceNoteRangeTicks(note);
    return endTicks > columnStartTicks && startTicks < columnEndTicks;
  });

  if (trackNotesInColumn.length === 0) {
    return (
      <div
        style={{
          height,
          borderRadius: 6,
          background: "rgba(15, 23, 42, 0.75)",
          border: "1px solid #1f2937",
        }}
      />
    );
  }

  const range = columnEndTicks - columnStartTicks;
  const baseAccent =
    accent ||
    performanceTrack?.color ||
    (performanceTrack
      ? getInstrumentColor(performanceTrack.instrument)
      : "#27E0B0");
  const dotSize = PERFORMANCE_DOT_SIZE;

  const seenNotes = new Set<PerformanceNote>();
  const sortedNotes = trackNotesInColumn
    .filter((note) => {
      if (seenNotes.has(note)) {
        return false;
      }
      seenNotes.add(note);
      return true;
    })
    .sort((a, b) => {
      const { startTicks: aStart } = getPerformanceNoteRangeTicks(a);
      const { startTicks: bStart } = getPerformanceNoteRangeTicks(b);
      return aStart - bStart;
    });

  let highlightStyle: CSSProperties | null = null;
  if (highlightRange) {
    const highlightStartTicks = highlightRange.start * TICKS_PER_MEASURE;
    const highlightEndTicks = highlightRange.end * TICKS_PER_MEASURE;
    const effectiveStart = Math.max(columnStartTicks, highlightStartTicks);
    const effectiveEnd = Math.min(columnEndTicks, highlightEndTicks);
    if (effectiveEnd > effectiveStart && range > 0) {
      const highlightLeft = ((effectiveStart - columnStartTicks) / range) * 100;
      const highlightWidth = ((effectiveEnd - effectiveStart) / range) * 100;
      const highlightColor = highlightRange.color ?? baseAccent;
      highlightStyle = {
        position: "absolute",
        top: 2,
        bottom: 2,
        left: `${highlightLeft}%`,
        width: `${highlightWidth}%`,
        background: withAlpha(highlightColor, 0.15),
        border: `1px solid ${highlightColor}`,
        borderRadius: 6,
        pointerEvents: "none",
        boxShadow: `0 0 12px ${withAlpha(highlightColor, 0.2)}`,
        transition: "left 0.2s ease, width 0.2s ease",
      };
    }
  }

  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: 6,
        background: "rgba(15, 23, 42, 0.75)",
        border: "1px solid #1f2937",
        overflow: "hidden",
      }}
    >
      {highlightStyle ? <div style={highlightStyle} /> : null}
      {sortedNotes.map((note, index) => {
        const { startTicks } = getPerformanceNoteRangeTicks(note);
        const clampedStart = Math.max(startTicks, columnStartTicks);
        const startRatio = range > 0 ? (clampedStart - columnStartTicks) / range : 0;
        const isGhost = ghostNoteRefs?.has(note) ?? false;
        const backgroundColor = isGhost
          ? withAlpha(baseAccent, 0.35)
          : baseAccent;
        const shadow = isGhost
          ? `0 0 6px ${withAlpha(baseAccent, 0.2)}`
          : `0 0 6px ${withAlpha(baseAccent, 0.35)}`;
        const border = isGhost
          ? `1px dashed ${withAlpha(baseAccent, 0.8)}`
          : "none";
        return (
          <span
            key={`perf-note-${index}`}
            style={{
              position: "absolute",
              left: `${startRatio * 100}%`,
              top: "50%",
              width: dotSize,
              height: dotSize,
              marginLeft: -(dotSize / 2),
              marginTop: -(dotSize / 2),
              borderRadius: dotSize,
              background: backgroundColor,
              boxShadow: shadow,
              border,
            }}
          />
        );
      })}
    </div>
  );
};

export function SongView({
  patternGroups,
  songRows,
  setSongRows,
  currentSectionIndex,
  isPlaying,
  bpm,
  setBpm,
  onToggleTransport,
  selectedGroupId,
  onSelectLoop,
  performanceTracks,
  triggers,
  onEnsurePerformanceRow,
  activePerformanceTrackId,
  onAddPerformanceTrack,
  onSelectPerformanceTrack,
  onPlayInstrumentOpenChange,
  onUpdatePerformanceTrack,
  onRemovePerformanceTrack,
  onSaveSong,
  onOpenLoadSong,
  onOpenExportSong,
}: SongViewProps) {
  const [editingSlot, setEditingSlot] = useState<
    { rowIndex: number; columnIndex: number } | null
  >(null);
  const [rowSettingsIndex, setRowSettingsIndex] = useState<number | null>(null);
  const [isTimelineExpanded, setTimelineExpanded] = useState(false);
  const [isPlayInstrumentOpen, setPlayInstrumentOpen] = useState(false);
  const [isOverflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [playInstrument, setPlayInstrument] =
    useState<TrackInstrument>("keyboard");
  const [playInstrumentPattern, setPlayInstrumentPattern] = useState<Chunk>(() =>
    createPerformancePattern("keyboard")
  );
  const latestPlayPatternRef = useRef(playInstrumentPattern);
  const [playInstrumentRowTrackId, setPlayInstrumentRowTrackId] = useState<
    string | null
  >(activePerformanceTrackId);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const isQuantizedRecording = true;
  const [isRecordEnabled, setIsRecordEnabled] = useState(false);
  const [liveGhostNotes, setLiveGhostNotes] = useState<PerformanceNote[]>([]);
  const wasRecordingRef = useRef(false);
  const hasPerformanceTarget = Boolean(playInstrumentRowTrackId);
  const recordingActive = Boolean(
    isRecordEnabled && isPlayInstrumentOpen && hasPerformanceTarget
  );
  const isRecordArmed = Boolean(
    isRecordEnabled && !isPlayInstrumentOpen && hasPerformanceTarget
  );

  const patternGroupMap = useMemo(
    () => new Map(patternGroups.map((group) => [group.id, group])),
    [patternGroups]
  );
  const performanceTrackMap = useMemo(
    () =>
      new Map(
        performanceTracks.map((track) => [track.id, track] as const)
      ),
    [performanceTracks]
  );

  useEffect(() => {
    onPlayInstrumentOpenChange?.(isPlayInstrumentOpen);
  }, [isPlayInstrumentOpen, onPlayInstrumentOpenChange]);

  useEffect(() => {
    if (!isOverflowMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!overflowMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && overflowMenuRef.current.contains(target)) {
        return;
      }
      setOverflowMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOverflowMenuOpen]);

  const applyPerformanceSettings = useCallback(
    (pattern: Chunk) => {
      if (!onUpdatePerformanceTrack) {
        return;
      }
      if (!playInstrumentRowTrackId) {
        return;
      }
      const snapshot = createPerformanceSettingsSnapshot(pattern);
      onUpdatePerformanceTrack(playInstrumentRowTrackId, (track) => ({
        ...track,
        settings: snapshot,
      }));
    },
    [onUpdatePerformanceTrack, playInstrumentRowTrackId]
  );

  const handlePlayInstrumentPatternUpdate = useCallback(
    (updater: (chunk: Chunk) => Chunk) => {
      setPlayInstrumentPattern((prev) => {
        const draft: Chunk = {
          ...prev,
          steps: prev.steps.slice(),
          velocities: prev.velocities ? prev.velocities.slice() : undefined,
          pitches: prev.pitches ? prev.pitches.slice() : undefined,
          notes: prev.notes ? prev.notes.slice() : undefined,
          degrees: prev.degrees ? prev.degrees.slice() : undefined,
          noteEvents: prev.noteEvents
            ? prev.noteEvents.map((event) => ({ ...event }))
            : undefined,
          harmoniaStepDegrees: prev.harmoniaStepDegrees
            ? prev.harmoniaStepDegrees.slice()
            : undefined,
        };
        const next = updater(draft);
        const nextPattern = { ...next, instrument: playInstrument };
        applyPerformanceSettings(nextPattern);
        return nextPattern;
      });
    },
    [playInstrument, applyPerformanceSettings]
  );

  const clearLiveRecording = useCallback(() => {
    setLiveGhostNotes([]);
  }, []);

  const handleCloseInstrumentPanel = useCallback(() => {
    setPlayInstrumentOpen(false);
    setPlayInstrumentRowTrackId(null);
    setIsRecordEnabled(false);
    clearLiveRecording();
    onSelectPerformanceTrack?.(null);
  }, [clearLiveRecording, onSelectPerformanceTrack]);

  const handleSelectPerformanceTrackRow = useCallback(
    (trackId: string | null) => {
      if (!trackId) {
        handleCloseInstrumentPanel();
        return;
      }
      const track = performanceTrackMap.get(trackId);
      if (track?.instrument) {
        setPlayInstrument(track.instrument);
      }
      setPlayInstrumentRowTrackId(trackId);
      setPlayInstrumentOpen(true);
      setIsRecordEnabled(false);
      clearLiveRecording();
      onSelectPerformanceTrack?.(trackId);
    },
    [
      clearLiveRecording,
      handleCloseInstrumentPanel,
      onSelectPerformanceTrack,
      performanceTrackMap,
    ]
  );

  const handleClearRecording = useCallback(() => {
    if (!playInstrumentRowTrackId) return;
    clearLiveRecording();
    onUpdatePerformanceTrack?.(playInstrumentRowTrackId, (track) => ({
      ...track,
      notes: [],
    }));
  }, [clearLiveRecording, onUpdatePerformanceTrack, playInstrumentRowTrackId]);

  const handlePerformanceNoteRecorded = useCallback(
    ({
      eventTime,
      noteName,
      velocity,
      durationSeconds,
      mode,
    }: {
      eventTime: number;
      noteName: string;
      velocity: number;
      durationSeconds?: number;
      mode: "sync" | "free";
    }) => {
      if (!recordingActive || !playInstrumentRowTrackId) {
        return;
      }

      const resolvedVelocity = Math.max(0, Math.min(1, velocity));
      const fallbackNote = playInstrumentPattern.note ?? "C4";
      const resolvedNote = noteName || fallbackNote;

      let startTicks = Tone.Transport.getTicksAtTime(eventTime);
      if (!Number.isFinite(startTicks) || startTicks < 0) {
        startTicks = Math.max(0, Tone.Transport.ticks);
      }

      const shouldQuantize = mode === "sync" || isQuantizedRecording;
      if (shouldQuantize) {
        startTicks =
          Math.round(startTicks / TICKS_PER_SIXTEENTH) * TICKS_PER_SIXTEENTH;
      }

      let durationTicks =
        durationSeconds !== undefined
          ? Tone.Time(Math.max(0.02, durationSeconds)).toTicks()
          : Tone.Time(playInstrumentPattern.sustain ?? 0.5).toTicks();

      if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
        durationTicks = TICKS_PER_QUARTER;
      }

      if (shouldQuantize) {
        durationTicks = Math.max(
          TICKS_PER_SIXTEENTH,
          Math.round(durationTicks / TICKS_PER_SIXTEENTH) *
            TICKS_PER_SIXTEENTH
        );
      }

      const noteEntry: PerformanceNote = {
        time: ticksToTransportString(startTicks),
        note: resolvedNote,
        duration: ticksToDurationString(durationTicks),
        velocity: resolvedVelocity,
      };

      setLiveGhostNotes((prev) => [...prev, noteEntry]);
      if (onUpdatePerformanceTrack) {
        const settingsSnapshot = createPerformanceSettingsSnapshot(
          playInstrumentPattern
        );
        onUpdatePerformanceTrack(
          playInstrumentRowTrackId,
          (track: PerformanceTrack) => {
            const nextNotes = [...track.notes, noteEntry];
            nextNotes.sort(sortPerformanceNotes);
            return {
              ...track,
              notes: nextNotes,
              settings: settingsSnapshot,
            };
          }
        );
      }
    },
    [
      recordingActive,
      playInstrumentRowTrackId,
      playInstrumentPattern.note,
      playInstrumentPattern.sustain,
      playInstrumentPattern,
      onUpdatePerformanceTrack,
      isQuantizedRecording,
    ]
  );

  useEffect(() => {
    if (!isPlayInstrumentOpen) return;
    setPlayInstrumentRowTrackId((currentId) => {
      const ensuredId = onEnsurePerformanceRow(playInstrument, currentId);
      if (ensuredId) {
        return ensuredId;
      }
      if (currentId && !performanceTrackMap.has(currentId)) {
        return null;
      }
      return currentId;
    });
  }, [
    isPlayInstrumentOpen,
    playInstrument,
    onEnsurePerformanceRow,
    performanceTrackMap,
  ]);

  useEffect(() => {
    if (!activePerformanceTrackId) {
      setPlayInstrumentRowTrackId(null);
      setPlayInstrumentOpen(false);
      return;
    }
    setPlayInstrumentRowTrackId(activePerformanceTrackId);
    const track = performanceTrackMap.get(activePerformanceTrackId);
    if (track?.instrument) {
      setPlayInstrument((prev) =>
        prev === track.instrument ? prev : track.instrument
      );
    }
    setPlayInstrumentOpen(true);
  }, [activePerformanceTrackId, performanceTrackMap]);

  useEffect(() => {
    const pattern = createPerformancePattern(playInstrument);
    setPlayInstrumentPattern(pattern);
    applyPerformanceSettings(pattern);
  }, [playInstrument, applyPerformanceSettings]);

  useEffect(() => {
    latestPlayPatternRef.current = playInstrumentPattern;
  }, [playInstrumentPattern]);

  useEffect(() => {
    if (!playInstrumentRowTrackId) return;
    applyPerformanceSettings(latestPlayPatternRef.current);
  }, [playInstrumentRowTrackId, applyPerformanceSettings]);

  useEffect(() => {
    setPlayInstrumentPattern((prev) => {
      if (prev.timingMode === "sync") {
        return prev;
      }
      return { ...prev, timingMode: "sync" };
    });
  }, []);

  useEffect(() => {
    if (recordingActive && !wasRecordingRef.current) {
      wasRecordingRef.current = true;
      setLiveGhostNotes([]);
    } else if (!recordingActive && wasRecordingRef.current) {
      wasRecordingRef.current = false;
      clearLiveRecording();
    }
  }, [recordingActive, clearLiveRecording]);

  useEffect(() => {
    return () => {
      clearLiveRecording();
    };
  }, [clearLiveRecording]);

  useEffect(() => {
    if (wasRecordingRef.current) return;
    setLiveGhostNotes([]);
  }, [playInstrument, playInstrumentRowTrackId]);

  const activePerformanceTrack = useMemo(() => {
    if (playInstrumentRowTrackId) {
      return performanceTrackMap.get(playInstrumentRowTrackId) ?? null;
    }
    if (activePerformanceTrackId) {
      return performanceTrackMap.get(activePerformanceTrackId) ?? null;
    }
    return null;
  }, [
    performanceTrackMap,
    playInstrumentRowTrackId,
    activePerformanceTrackId,
  ]);

  const sectionCount = useMemo(
    () => songRows.reduce((max, row) => Math.max(max, row.slots.length), 0),
    [songRows]
  );

  const performanceColumnCount = useMemo(
    () => getPerformanceTracksSpanMeasures(performanceTracks),
    [performanceTracks]
  );

  const ghostColumnCount = useMemo(() => {
    if (liveGhostNotes.length === 0) {
      return 0;
    }
    let maxEndTicks = 0;
    liveGhostNotes.forEach((note) => {
      const { endTicks } = getPerformanceNoteRangeTicks(note);
      if (endTicks > maxEndTicks) {
        maxEndTicks = endTicks;
      }
    });
    if (maxEndTicks <= 0) {
      return 0;
    }
    return Math.ceil(maxEndTicks / TICKS_PER_MEASURE);
  }, [liveGhostNotes]);

  const effectiveColumnCount = Math.max(
    sectionCount,
    performanceColumnCount,
    ghostColumnCount
  );

  const timelineContentWidth = useMemo(() => {
    const columns = Math.max(1, effectiveColumnCount);
    const totalSlotWidth = columns * SLOT_WIDTH;
    const totalGapWidth = Math.max(0, columns - 1) * SLOT_GAP;
    return totalSlotWidth + totalGapWidth;
  }, [effectiveColumnCount]);

  const timelineWidthStyle = useMemo(() => {
    if (timelineContentWidth <= 0) {
      return "100%";
    }
    return `max(100%, ${timelineContentWidth}px)`;
  }, [timelineContentWidth]);

  useEffect(() => {
    if (!editingSlot) return;
    if (patternGroups.length === 0) {
      setEditingSlot(null);
      return;
    }
    const { rowIndex, columnIndex } = editingSlot;
    if (rowIndex >= songRows.length) {
      setEditingSlot(null);
      return;
    }
    if (columnIndex >= songRows[rowIndex].slots.length) {
      setEditingSlot(null);
    }
  }, [editingSlot, songRows, patternGroups.length]);

  useEffect(() => {
    if (rowSettingsIndex === null) return;
    if (rowSettingsIndex >= songRows.length) {
      setRowSettingsIndex(null);
    }
  }, [rowSettingsIndex, songRows.length]);

  const handleAddLoopColumn = () => {
    setSongRows((rows) => {
      if (rows.length === 0) {
        return [createSongRow(1)];
      }
      return rows.map((row) => ({
        ...row,
        slots: [...row.slots, null],
      }));
    });
  };

  const handleAddPerformanceTrack = useCallback(() => {
    if (!onAddPerformanceTrack) return;
    setRowSettingsIndex(null);
    setEditingSlot(null);
    onAddPerformanceTrack();
  }, [onAddPerformanceTrack, setEditingSlot, setRowSettingsIndex]);

  const handleDeleteColumn = useCallback(
    (columnIndex: number) => {
      if (columnIndex < 0) return;
      setSongRows((rows) =>
        rows.map((row) => {
          if (columnIndex >= row.slots.length) {
            return row;
          }
          const nextSlots = row.slots.slice();
          nextSlots.splice(columnIndex, 1);
          return { ...row, slots: nextSlots };
        })
      );
      setEditingSlot((current) => {
        if (!current) return current;
        if (current.columnIndex === columnIndex) {
          return null;
        }
        if (current.columnIndex > columnIndex) {
          return {
            rowIndex: current.rowIndex,
            columnIndex: current.columnIndex - 1,
          };
        }
        return current;
      });
    },
    [setSongRows, setEditingSlot]
  );

  const handleAddRow = () => {
    setSongRows((rows) => {
      const maxColumns = rows.reduce(
        (max, row) => Math.max(max, row.slots.length),
        0
      );
      const newRow = createSongRow(maxColumns);
      if (rows.length === 0) {
        return [maxColumns > 0 ? newRow : createSongRow(1)];
      }
      return [...rows, newRow];
    });
  };

  const handleAssignSlot = (
    rowIndex: number,
    columnIndex: number,
    groupId: string | null
  ) => {
    setSongRows((rows) =>
      rows.map((row, idx) => {
        if (idx !== rowIndex) return row;
        const nextSlots = row.slots.slice();
        while (nextSlots.length <= columnIndex) {
          nextSlots.push(null);
        }
        nextSlots[columnIndex] = groupId;
        return { ...row, slots: nextSlots };
      })
    );
  };

  const handleToggleRowMute = (rowIndex: number) => {
    setSongRows((rows) =>
      rows.map((row, idx) =>
        idx === rowIndex ? { ...row, muted: !row.muted } : row
      )
    );
  };

  const handleToggleRowSolo = (rowIndex: number) => {
    setSongRows((rows) =>
      rows.map((row, idx) =>
        idx === rowIndex ? { ...row, solo: !(row.solo ?? false) } : row
      )
    );
  };

  const handleRowVelocityChange = (rowIndex: number, value: number) => {
    setSongRows((rows) =>
      rows.map((row, idx) =>
        idx === rowIndex ? { ...row, velocity: value } : row
      )
    );
  };

  const handleDuplicateRow = useCallback(
    (rowIndex: number) => {
      setSongRows((rows) => {
        if (rowIndex < 0 || rowIndex >= rows.length) {
          return rows;
        }
        const targetRow = rows[rowIndex];
        const duplicatedRow: SongRow = {
          ...targetRow,
          slots: targetRow.slots.slice(),
        };
        return [
          ...rows.slice(0, rowIndex + 1),
          duplicatedRow,
          ...rows.slice(rowIndex + 1),
        ];
      });
      setRowSettingsIndex((current) => {
        if (current === null) return current;
        if (current < rowIndex) return current;
        if (current === rowIndex) return rowIndex + 1;
        return current + 1;
      });
    },
    [setSongRows]
  );

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      const targetRow = songRows[rowIndex];
      if (targetRow?.performanceTrackId) {
        onRemovePerformanceTrack?.(targetRow.performanceTrackId);
      }
      setSongRows((rows) => {
        if (rowIndex < 0 || rowIndex >= rows.length) {
          return rows;
        }
        return rows.filter((_, idx) => idx !== rowIndex);
      });
      setRowSettingsIndex((current) => {
        if (current === null) return current;
        if (current === rowIndex) return null;
        if (current > rowIndex) return current - 1;
        return current;
      });
    },
    [songRows, onRemovePerformanceTrack, setSongRows]
  );

  const liveGhostNoteSet = useMemo(
    () => new Set(liveGhostNotes),
    [liveGhostNotes]
  );

  const hasPerformanceRow = songRows.some((row) => Boolean(row.performanceTrackId));
  const showEmptyTimeline = sectionCount === 0 && !hasPerformanceRow;
  const slotMinHeight = SLOT_MIN_HEIGHT;
  const slotPadding = SLOT_PADDING;
  const slotGap = SLOT_CONTENT_GAP;
  const visibleRowTarget = isTimelineExpanded
    ? TIMELINE_VISIBLE_ROWS_EXPANDED
    : TIMELINE_VISIBLE_ROWS_COLLAPSED;
  const timelineViewportHeight = Math.round(
    visibleRowTarget * (slotMinHeight + APPROXIMATE_ROW_OFFSET)
  );
  const shouldEnableVerticalScroll = songRows.length > visibleRowTarget;
  const panelInstrument = activePerformanceTrack?.instrument ?? playInstrument;
  const playInstrumentColor = useMemo(
    () => getInstrumentColor(panelInstrument),
    [panelInstrument]
  );
  const playInstrumentSource = useMemo(() => {
    if (activePerformanceTrack?.packId) {
      const pack = packs.find(
        (candidate) => candidate.id === activePerformanceTrack.packId
      );
      if (pack && activePerformanceTrack.instrument) {
        const definition = pack.instruments?.[activePerformanceTrack.instrument];
        if (definition) {
          const preferredCharacterId = activePerformanceTrack.characterId;
          const validCharacter = preferredCharacterId
            ? definition.characters.find(
                (character) => character.id === preferredCharacterId
              )
            : null;
          const resolvedCharacterId = validCharacter
            ? validCharacter.id
            : definition.defaultCharacterId
            ? definition.characters.find(
                (character) => character.id === definition.defaultCharacterId
              )?.id ?? definition.characters[0]?.id ?? ""
            : definition.characters[0]?.id ?? "";
          return {
            packId: pack.id,
            characterId: resolvedCharacterId,
          };
        }
      }
    }
    return resolveInstrumentSource(playInstrument);
  }, [activePerformanceTrack, playInstrument]);
  const playInstrumentPackId = playInstrumentSource?.packId ?? "";
  const playInstrumentCharacterId = playInstrumentSource?.characterId ?? "";
  const playInstrumentTrackForPanel = useMemo<Track>(
    () => ({
      id: -1,
      name: `${formatInstrumentLabel(panelInstrument)} Live`,
      instrument: panelInstrument,
      pattern: playInstrumentPattern,
      muted: false,
      source: playInstrumentPackId
        ? {
            packId: playInstrumentPackId,
            instrumentId: panelInstrument,
            characterId: playInstrumentCharacterId || "",
          }
        : undefined,
    }),
    [
      panelInstrument,
      playInstrumentPattern,
      playInstrumentPackId,
      playInstrumentCharacterId,
    ]
  );
  const playInstrumentTrigger = useMemo(() => {
    if (!playInstrumentPackId) return undefined;
    const triggerKey = createTriggerKey(playInstrumentPackId, panelInstrument);
    const trigger = triggers[triggerKey];
    if (!trigger) return undefined;
    return (
      time: number,
      velocity?: number,
      pitch?: number,
      note?: string,
      sustain?: number,
      chunk?: Chunk
    ) => {
      trigger(
        time,
        velocity,
        pitch,
        note,
        sustain,
        chunk,
        playInstrumentCharacterId || undefined
      );
    };
  }, [
    playInstrumentPackId,
    panelInstrument,
    triggers,
    playInstrumentCharacterId,
  ]);

  useEffect(() => {
    const targetInstrument = activePerformanceTrack?.instrument;
    if (!targetInstrument) {
      return;
    }
    setPlayInstrument((prev) => (prev === targetInstrument ? prev : targetInstrument));
  }, [activePerformanceTrack?.instrument]);
  const liveRowIndex = useMemo(() => {
    if (!playInstrumentRowTrackId) return -1;
    return songRows.findIndex(
      (row) => row.performanceTrackId === playInstrumentRowTrackId
    );
  }, [songRows, playInstrumentRowTrackId]);
  const liveRowLabel = liveRowIndex >= 0
    ? `Row ${String(liveRowIndex + 1).padStart(2, "0")}`
    : null;
  const liveRowMessage = recordingActive
    ? `${liveRowLabel ?? "Live row"} is recording now`
    : isRecordArmed
    ? `${liveRowLabel ?? "Live row"} armed — open the instrument panel to capture`
    : isRecordEnabled
    ? `${liveRowLabel ?? "Live row"} ready to record`
    : liveRowLabel
    ? `${liveRowLabel} ready for performance playback`
    : "Live row added to your timeline";
  const recordIndicatorLabel = recordingActive
    ? "Recording"
    : isRecordArmed
    ? "Armed"
    : "Record On";
  const canClearRecording = Boolean(
    playInstrumentRowTrackId &&
      ((activePerformanceTrack?.notes.length ?? 0) > 0 ||
        liveGhostNotes.length > 0)
  );
  const selectedPerformanceToolbarTrack = playInstrumentRowTrackId
    ? performanceTrackMap.get(playInstrumentRowTrackId) ?? null
    : null;
  const showPerformanceToolbar = Boolean(selectedPerformanceToolbarTrack);
  const hasRowSettings =
    rowSettingsIndex !== null && rowSettingsIndex < songRows.length;
  const rowSettingsRow =
    rowSettingsIndex !== null && rowSettingsIndex < songRows.length
      ? songRows[rowSettingsIndex]
      : null;
  const rowSettingsLabel =
    rowSettingsIndex !== null && rowSettingsIndex < songRows.length
      ? `Row ${String(rowSettingsIndex + 1).padStart(2, "0")}`
      : null;
  const timelineToggleLabel = isTimelineExpanded
    ? "Collapse timeline height"
    : "Expand timeline height";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        gap: 16,
        minHeight: 0,
      }}
    >
      <div
        style={{
          border: "1px solid #333",
          borderRadius: 12,
          background: "#1b2130",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <IconButton
              icon="add"
              label="Add loop column"
              onClick={handleAddLoopColumn}
              title="Add loop column"
              style={{
                minWidth: 40,
                minHeight: 40,
                borderRadius: 999,
                background: "#1f2532",
              }}
            />
            <button
              aria-label={isPlaying ? "Stop" : "Play"}
              onPointerDown={onToggleTransport}
              onPointerUp={(event) => event.currentTarget.blur()}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: "1px solid #333",
                background: isPlaying ? "#E02749" : "#27E0B0",
                color: isPlaying ? "#ffe4e6" : "#1F2532",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
              }}
            >
              <span className="material-symbols-outlined">
                {isPlaying ? "stop" : "play_arrow"}
              </span>
            </button>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 96,
              }}
            >
              <label
                style={{
                  fontSize: 12,
                  letterSpacing: 0.2,
                  color: "#cbd5f5",
                  whiteSpace: "nowrap",
                }}
              >
                BPM
              </label>
              <select
                value={bpm}
                onChange={(event) =>
                  setBpm(parseInt(event.target.value, 10))
                }
                style={{
                  padding: 8,
                  borderRadius: 8,
                  background: "#121827",
                  color: "#e6f2ff",
                  border: "1px solid #2a3344",
                  minWidth: 0,
                }}
              >
                {[90, 100, 110, 120, 130].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <select
            aria-label="Current loop"
            value={selectedGroupId ?? patternGroups[0]?.id ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              onSelectLoop(value);
              setRowSettingsIndex(null);
              setEditingSlot(null);
            }}
            style={{
              flex: "1 1 160px",
              minWidth: 0,
              padding: 10,
              borderRadius: 12,
              border: "1px solid #2f384a",
              background: "#111827",
              color: "#e6f2ff",
            }}
          >
            {patternGroups.map((group) => (
              <option key={group.id} value={group.id}>
                📼 {group.name}
              </option>
            ))}
          </select>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginLeft: "auto",
            }}
          >
            <IconButton
              icon="save"
              label="Save song"
              title="Save song"
              tone="accent"
              onClick={() => {
                setOverflowMenuOpen(false);
                onSaveSong?.();
              }}
              disabled={!onSaveSong}
            />
            <div
              ref={overflowMenuRef}
              style={{
                position: "relative",
                display: "flex",
              }}
            >
              <IconButton
                icon="more_horiz"
                label="Song options"
                title="Song options"
                onClick={() => setOverflowMenuOpen((previous) => !previous)}
                style={{ minWidth: 44 }}
              />
              {isOverflowMenuOpen ? (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    background: "#0f172a",
                    border: "1px solid #1f2937",
                    borderRadius: 12,
                    padding: 8,
                    boxShadow: "0 18px 40px rgba(8,15,28,0.6)",
                    minWidth: 180,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    zIndex: 50,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOverflowMenuOpen(false);
                      onOpenLoadSong?.();
                    }}
                    disabled={!onOpenLoadSong}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid transparent",
                      background: "transparent",
                      color: "#e2e8f0",
                      textAlign: "left",
                      fontSize: 13,
                      cursor: onOpenLoadSong ? "pointer" : "not-allowed",
                    }}
                  >
                    Load song
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOverflowMenuOpen(false);
                      onOpenExportSong?.();
                    }}
                    disabled={!onOpenExportSong}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid transparent",
                      background: "transparent",
                      color: "#e2e8f0",
                      textAlign: "left",
                      fontSize: 13,
                      cursor: onOpenExportSong ? "pointer" : "not-allowed",
                    }}
                  >
                    Export audio
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          {showPerformanceToolbar ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <IconButton
                icon={isPlaying ? "stop" : "play_arrow"}
                label={isPlaying ? "Stop playback" : "Play song"}
                onClick={onToggleTransport}
                style={{ minWidth: 44 }}
              />
              <IconButton
                icon="cleaning_services"
                label="Clear performance row"
                onClick={handleClearRecording}
                disabled={!canClearRecording}
                style={{ minWidth: 44 }}
              />
              <IconButton
                icon="tune"
                label="Open row settings"
                onClick={() => {
                  if (liveRowIndex >= 0) {
                    setRowSettingsIndex(liveRowIndex);
                  }
                }}
                disabled={liveRowIndex < 0}
                style={{ minWidth: 44 }}
              />
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                flex: 1,
              }}
            >
              {showEmptyTimeline ? (
                <span style={{ fontSize: 13, color: "#94a3b8" }}>
                  Add loops and tracks to build your song timeline.
                </span>
              ) : null}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={handleAddLoopColumn}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 999,
                    border: "1px solid #2f384a",
                    background: "#111827",
                    color: "#e6f2ff",
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    cursor: "pointer",
                  }}
                >
                  + Loop
                </button>
                <button
                  onClick={handleAddRow}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 999,
                    border: "1px solid #2f384a",
                    background: "#111827",
                    color: "#e6f2ff",
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    cursor: "pointer",
                  }}
                >
                  + Row
                </button>
                <button
                  onClick={handleAddPerformanceTrack}
                  disabled={!onAddPerformanceTrack}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 999,
                    border: "1px solid #27E0B0",
                    background: onAddPerformanceTrack ? "#27E0B0" : "#1f2532",
                    color: onAddPerformanceTrack ? "#0b1624" : "#475569",
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    cursor: onAddPerformanceTrack ? "pointer" : "not-allowed",
                    boxShadow: onAddPerformanceTrack
                      ? "0 2px 6px rgba(39,224,176,0.35)"
                      : "none",
                  }}
                >
                  + Track
                </button>
              </div>
            </div>
          )}
          <IconButton
            icon={isTimelineExpanded ? "unfold_less" : "unfold_more"}
            label={timelineToggleLabel}
            onClick={() => setTimelineExpanded((previous) => !previous)}
            style={{ minWidth: 44 }}
          />
        </div>
        <div
          className="scrollable"
          style={{
            overflowX: "auto",
            paddingBottom: 4,
            minHeight: `${timelineViewportHeight}px`,
            maxHeight: `${timelineViewportHeight}px`,
          }}
        >
          {sectionCount > 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 8,
                paddingRight: shouldEnableVerticalScroll ? 6 : 0,
              }}
            >
              <div style={{ width: ROW_LABEL_WIDTH, flexShrink: 0 }} />
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${sectionCount}, ${SLOT_WIDTH}px)`,
                    gap: SLOT_GAP,
                    width: timelineWidthStyle,
                    minWidth: timelineWidthStyle,
                  }}
                >
                  {Array.from({ length: sectionCount }, (_, columnIndex) => (
                    <button
                      key={`delete-column-${columnIndex}`}
                      type="button"
                      onClick={() => handleDeleteColumn(columnIndex)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 16,
                        border: "1px solid #2a3344",
                        background: "#111827",
                        color: "#e2e8f0",
                        fontSize: 11,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        cursor: "pointer",
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                        delete
                      </span>
                      <span>Loop {columnIndex + 1}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <div
            style={{
              maxHeight: `${timelineViewportHeight}px`,
              minHeight: `${timelineViewportHeight}px`,
              overflowY: shouldEnableVerticalScroll ? "auto" : "visible",
              paddingRight: shouldEnableVerticalScroll ? 6 : 0,
              width: timelineWidthStyle,
              minWidth: timelineWidthStyle,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {showEmptyTimeline ? (
              <div
                style={{
                  padding: 24,
                  borderRadius: 8,
                  border: "1px dashed #475569",
                  color: "#94a3b8",
                  fontSize: 13,
                }}
              >
                Add a loop to start placing loops into the timeline.
              </div>
            ) : (
              songRows.map((row, rowIndex) => {
                const maxColumns = Math.max(
                  effectiveColumnCount,
                  row.slots.length
                );
                let labelTimer: number | null = null;
                let longPressTriggered = false;

                const handleLabelPointerDown = (
                  event: ReactPointerEvent<HTMLDivElement>
                ) => {
                  event.preventDefault();
                  event.stopPropagation();
                  longPressTriggered = false;
                  if (labelTimer) window.clearTimeout(labelTimer);
                  labelTimer = window.setTimeout(() => {
                    longPressTriggered = true;
                    setEditingSlot(null);
                    setRowSettingsIndex(rowIndex);
                  }, 500);
                };

                const handleLabelPointerUp = (
                  event: ReactPointerEvent<HTMLDivElement>
                ) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (labelTimer) window.clearTimeout(labelTimer);
                  labelTimer = null;
                  if (longPressTriggered) {
                    longPressTriggered = false;
                    return;
                  }
                  const detail = event.detail ?? 0;
                  if (detail >= 2) {
                    handleToggleRowSolo(rowIndex);
                  } else {
                    handleToggleRowMute(rowIndex);
                  }
                };

                const handleLabelPointerLeave = () => {
                  if (labelTimer) window.clearTimeout(labelTimer);
                  labelTimer = null;
                };

                const rowMuted = row.muted;
                const performanceTrack = row.performanceTrackId
                  ? performanceTrackMap.get(row.performanceTrackId)
                  : undefined;
                const performanceAccent = performanceTrack
                  ? performanceTrack.color ||
                    getInstrumentColor(performanceTrack.instrument)
                  : null;
                const isPerformanceRow = Boolean(row.performanceTrackId);
                const isSelectedPerformanceRow =
                  isPerformanceRow &&
                  row.performanceTrackId === playInstrumentRowTrackId;
                const rowSelected =
                  rowSettingsIndex === rowIndex || isSelectedPerformanceRow;
                const firstAssignedGroupId =
                  row.slots.find((slotId) => slotId !== null) ?? null;
                const firstGroup = firstAssignedGroupId
                  ? patternGroupMap.get(firstAssignedGroupId)
                  : undefined;
                const loopAccentInstrument = firstGroup?.tracks.find(
                  (track) => track.instrument
                )?.instrument;
                const loopAccent = loopAccentInstrument
                  ? getInstrumentColor(loopAccentInstrument)
                  : null;
                const rowAccent = performanceAccent ?? loopAccent ?? null;
                const rowSolo = row.solo ?? false;
                const labelBackground = rowMuted
                  ? "#1b2332"
                  : rowSolo
                  ? "#14241d"
                  : "#111827";
                const isRecordingRow = recordingActive && isSelectedPerformanceRow;
                const isArmedRow =
                  !isRecordingRow && isRecordArmed && isSelectedPerformanceRow;
                const rowGhostNotes = isRecordingRow ? liveGhostNotes : [];
                const rowGhostNoteSet = isRecordingRow
                  ? liveGhostNoteSet
                  : undefined;
                const trackNoteSet = performanceTrack
                  ? new Set(performanceTrack.notes)
                  : undefined;
                const rowGhostDisplayNotes =
                  rowGhostNotes.length && trackNoteSet
                    ? rowGhostNotes.filter((note) => !trackNoteSet.has(note))
                    : rowGhostNotes;
                const performanceHasContent = isPerformanceRow
                  ? (performanceTrack?.notes.length ?? 0) > 0 ||
                    rowGhostDisplayNotes.length > 0
                  : false;
                const totalPerformanceNotes = isPerformanceRow
                  ? (performanceTrack?.notes.length ?? 0) +
                    (isRecordingRow ? rowGhostDisplayNotes.length : 0)
                  : 0;
                const performanceHighlightRange =
                  isPerformanceRow && isPlaying
                    ? {
                        start: currentSectionIndex,
                        end: currentSectionIndex + 1,
                        color: performanceAccent ?? rowAccent ?? "#27E0B0",
                      }
                    : undefined;
                const performanceStatusLabel = isPerformanceRow
                  ? isRecordingRow
                    ? "Recording"
                    : isArmedRow
                    ? "Armed"
                    : performanceHasContent
                    ? "Live"
                    : null
                  : null;
                const performanceInstrumentLabel =
                  isPerformanceRow && performanceTrack
                    ? formatInstrumentLabel(performanceTrack.instrument)
                    : null;
                const performanceDescription = isPerformanceRow
                  ? isRecordingRow
                    ? "Recording…"
                    : totalPerformanceNotes > 0
                    ? `${formatNoteCount(totalPerformanceNotes)} across the song`
                    : "No notes yet"
                  : null;
                const performanceTextColor =
                  isPerformanceRow && performanceHasContent
                    ? "#e6f2ff"
                    : "#94a3b8";
                const safeColumnCount = Math.max(1, maxColumns);
                
                return (
                  <div
                    key={`row-${rowIndex}`}
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <div
                      onPointerDown={() => {
                        if (isPerformanceRow) {
                          handleSelectPerformanceTrackRow(
                            row.performanceTrackId ?? null
                          );
                        } else if (playInstrumentRowTrackId) {
                          handleSelectPerformanceTrackRow(null);
                        }
                      }}
                      style={{
                        display: "flex",
                        alignItems: "stretch",
                        borderRadius: 6,
                        overflow: "hidden",
                        border: rowSelected
                          ? "2px solid #27E0B0"
                          : "1px solid #2a3344",
                        background: "#111827",
                        opacity: rowMuted ? 0.55 : 1,
                        transition: "opacity 0.2s ease, border 0.2s ease",
                      }}
                    >
                      <div
                        onPointerDown={handleLabelPointerDown}
                        onPointerUp={handleLabelPointerUp}
                        onPointerLeave={handleLabelPointerLeave}
                        onPointerCancel={handleLabelPointerLeave}
                        style={{
                          width: ROW_LABEL_WIDTH,
                          flexShrink: 0,
                          borderRight: "1px solid #2a3344",
                          background: labelBackground,
                          color: rowMuted ? "#475569" : "#f8fafc",
                          fontSize: 11,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          cursor: "pointer",
                          userSelect: "none",
                          letterSpacing: 0.6,
                          position: "relative",
                        }}
                        title={
                          rowMuted
                            ? "Tap to unmute. Double tap to solo. Long press for settings."
                            : rowSolo
                            ? "Tap to mute. Double tap to clear solo. Long press for settings."
                            : "Tap to mute. Double tap to solo. Long press for settings."
                        }
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: rowAccent ?? "#334155",
                              boxShadow: rowAccent
                                ? `0 0 6px ${withAlpha(rowAccent, 0.4)}`
                                : "none",
                            }}
                          />
                          <span>{rowIndex + 1}</span>
                          {rowSolo ? (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: 0.6,
                                color: "#facc15",
                              }}
                            >
                              SOLO
                            </span>
                          ) : null}
                          {isPerformanceRow && (isRecordingRow || isArmedRow) ? (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: 0.6,
                                color: "#fecdd3",
                                background: isRecordingRow
                                  ? "rgba(248, 113, 113, 0.22)"
                                  : "rgba(248, 113, 113, 0.12)",
                                border: `1px solid ${
                                  isRecordingRow ? "#f87171" : "#fb7185"
                                }`,
                                padding: "2px 6px",
                                borderRadius: 999,
                              }}
                            >
                              {isRecordingRow ? "REC" : "ARM"}
                            </span>
                          ) : null}
                        </div>
                        {rowSelected && (
                          <span
                            className="material-symbols-outlined"
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 6,
                              fontSize: 14,
                              color: "#27E0B0",
                            }}
                            aria-hidden="true"
                          >
                            tune
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          background: "#161d2b",
                          padding: slotPadding,
                          display: "flex",
                          alignItems: "stretch",
                        }}
                      >
                        <div
                          style={{
                            width: timelineWidthStyle,
                            minWidth: timelineWidthStyle,
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: `repeat(${safeColumnCount}, ${SLOT_WIDTH}px)`,
                              gap: SLOT_GAP,
                              width: "100%",
                            }}
                          >
                            {isPerformanceRow ? (
                              <div
                                key={`performance-span-${rowIndex}`}
                                style={{ gridColumn: `1 / span ${safeColumnCount}` }}
                              >
                                <div
                                  style={{
                                    width: "100%",
                                    minHeight: slotMinHeight,
                                    borderRadius: 8,
                                    border: `1px solid ${
                                      isRecordingRow
                                        ? withAlpha(playInstrumentColor, 0.6)
                                        : performanceHasContent
                                        ? "#2f384a"
                                        : "#1f2937"
                                    }`,
                                    background: isRecordingRow
                                      ? withAlpha(playInstrumentColor, 0.12)
                                      : performanceHasContent
                                      ? "#0f1a2a"
                                      : "#0b111d",
                                    color: performanceTextColor,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: slotGap,
                                    padding: slotPadding,
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      width: "100%",
                                    }}
                                  >
                                    <span style={{ fontWeight: 600 }}>
                                      {performanceInstrumentLabel
                                        ? `${performanceInstrumentLabel} Performance`
                                        : "Performance"}
                                    </span>
                                    <div
                                      style={{
                                        marginLeft: "auto",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                      }}
                                    >
                                      {performanceStatusLabel ? (
                                        <span
                                          style={{
                                            fontSize: 10,
                                            color: "#fce7f3",
                                            letterSpacing: 0.4,
                                            textTransform: "uppercase",
                                            background: isRecordingRow
                                              ? "rgba(248, 113, 113, 0.2)"
                                              : "rgba(248, 113, 113, 0.12)",
                                            border: `1px solid ${
                                              isRecordingRow ? "#f87171" : "#fb7185"
                                            }`,
                                            padding: "2px 8px",
                                            borderRadius: 999,
                                          }}
                                        >
                                          {performanceStatusLabel}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div style={{ width: "100%" }}>
                                    {renderPerformanceSlotPreview(
                                      performanceTrack,
                                      0,
                                      safeColumnCount,
                                      performanceAccent ?? rowAccent,
                                      rowGhostDisplayNotes,
                                      rowGhostNoteSet,
                                      performanceHighlightRange
                                    )}
                                  </div>
                                  {performanceDescription ? (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color:
                                          performanceTextColor === "#e6f2ff"
                                            ? "#94a3b8"
                                            : "#475569",
                                      }}
                                    >
                                      {performanceDescription}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            ) : (
                              Array.from({ length: maxColumns }, (_, columnIndex) => {
                                const groupId =
                                  columnIndex < row.slots.length
                                    ? row.slots[columnIndex]
                                    : null;
                                const group = groupId
                                  ? patternGroupMap.get(groupId)
                                  : undefined;
                                const highlight =
                                  isPlaying && columnIndex === currentSectionIndex;
                                const isEditing =
                                  editingSlot?.rowIndex === rowIndex &&
                                  editingSlot.columnIndex === columnIndex;
                                const assigned = Boolean(group);
                                const columnStart = columnIndex;
                                const columnEnd = columnIndex + 1;
                                const columnBounds = getColumnTickBounds(columnIndex);
                                const combinedPerformanceNotes = [
                                  ...(performanceTrack?.notes ?? []),
                                  ...rowGhostDisplayNotes,
                                ];
                                const columnNoteCount = countPerformanceNotesInRange(
                                  combinedPerformanceNotes,
                                  columnBounds.startTicks,
                                  columnBounds.endTicks
                                );
                                const hasPerformanceContent =
                                  combinedPerformanceNotes.length > 0;
                                const hasContent = assigned || hasPerformanceContent;
                                const textColor = hasContent ? "#e6f2ff" : "#94a3b8";
                                const descriptionColor = hasContent
                                  ? "#94a3b8"
                                  : "#475569";
                                const description = hasPerformanceContent
                                  ? columnNoteCount > 0
                                    ? formatNoteCount(columnNoteCount)
                                    : isRecordingRow
                                    ? "Recording…"
                                    : "No notes yet"
                                  : assigned
                                  ? null
                                  : patternGroups.length > 0
                                  ? "Tap to assign"
                                  : "Save a loop in Track view";
                                const performanceSlotStatus = isRecordingRow
                                  ? "Recording"
                                  : hasPerformanceContent
                                  ? "Live"
                                  : null;

                                const showSlotLabel = !isPlayInstrumentOpen;
                                const buttonStyles: CSSProperties = {
                                  width: "100%",
                                  minHeight: slotMinHeight,
                                  borderRadius: 8,
                                  border: `1px solid ${
                                    highlight
                                      ? "#27E0B0"
                                      : isRecordingRow
                                      ? withAlpha(playInstrumentColor, 0.6)
                                      : hasContent
                                      ? "#2f384a"
                                      : "#1f2937"
                                  }`,
                                  background: highlight
                                    ? "rgba(39, 224, 176, 0.12)"
                                    : isRecordingRow
                                    ? withAlpha(playInstrumentColor, 0.12)
                                    : hasContent
                                    ? "#0f1a2a"
                                    : "#0b111d",
                                  color: textColor,
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "stretch",
                                  justifyContent: "space-between",
                                  gap: showSlotLabel ? slotGap : slotGap / 2,
                                  padding: slotPadding,
                                  fontSize: 13,
                                  cursor:
                                    patternGroups.length > 0 ? "pointer" : "not-allowed",
                                  textAlign: "left",
                                  opacity: rowMuted ? 0.85 : 1,
                                  transition: "background 0.2s ease, border-color 0.2s ease",
                                };

                                return (
                                  <div key={`slot-${rowIndex}-${columnIndex}`}>
                                    {isEditing ? (
                                      <select
                                        value={groupId ?? ""}
                                        onChange={(event) => {
                                          const value = event.target.value;
                                          handleAssignSlot(
                                            rowIndex,
                                            columnIndex,
                                            value ? value : null
                                          );
                                          setEditingSlot(null);
                                        }}
                                        onBlur={() => setEditingSlot(null)}
                                        style={{
                                          width: "100%",
                                          minHeight: slotMinHeight,
                                          borderRadius: 8,
                                          border: `1px solid ${
                                            highlight ? "#27E0B0" : "#475569"
                                          }`,
                                          background: "#121827",
                                          color: "#e6f2ff",
                                          padding: "0 12px",
                                        }}
                                        autoFocus
                                      >
                                        <option value="">Empty Slot</option>
                                        {patternGroups.map((groupOption) => (
                                          <option key={groupOption.id} value={groupOption.id}>
                                            {groupOption.name}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (patternGroups.length === 0) return;
                                          setRowSettingsIndex(null);
                                          setEditingSlot({ rowIndex, columnIndex });
                                        }}
                                        style={buttonStyles}
                                        disabled={patternGroups.length === 0}
                                      >
                                        {showSlotLabel ? (
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              gap: 6,
                                              width: "100%",
                                            }}
                                          >
                                            <span style={{ fontWeight: 600 }}>
                                              {group?.name ?? "Empty"}
                                            </span>
                                            {performanceSlotStatus && (
                                              <span
                                                style={{
                                                  marginLeft: "auto",
                                                  fontSize: 10,
                                                  color: "#cbd5f5",
                                                  letterSpacing: 0.4,
                                                  textTransform: "uppercase",
                                                }}
                                              >
                                                {performanceSlotStatus}
                                              </span>
                                            )}
                                          </div>
                                        ) : null}
                                        <div style={{ width: "100%" }}>
                                          {hasPerformanceContent
                                            ? renderPerformanceSlotPreview(
                                                performanceTrack,
                                                columnStart,
                                                columnEnd,
                                                performanceAccent ?? rowAccent,
                                                rowGhostDisplayNotes,
                                                rowGhostNoteSet
                                              )
                                            : renderLoopSlotPreview(group)}
                                        </div>
                                        {description && (
                                          <span
                                            style={{
                                              fontSize: 11,
                                              color: descriptionColor,
                                            }}
                                          >
                                            {description}
                                          </span>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={hasRowSettings && Boolean(rowSettingsRow)}
        onClose={() => setRowSettingsIndex(null)}
        title="Row Settings"
        subtitle={rowSettingsLabel ? `Adjust playback for ${rowSettingsLabel}` : undefined}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <IconButton
              icon="check"
              label="Done"
              showLabel
              tone="accent"
              onClick={() => setRowSettingsIndex(null)}
            />
          </div>
        }
      >
        {rowSettingsRow ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                fontSize: 13,
                color: "#cbd5f5",
              }}
            >
              <span>Velocity</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={rowSettingsRow.velocity}
                  onChange={(event) => {
                    if (rowSettingsIndex === null) return;
                    handleRowVelocityChange(
                      rowSettingsIndex,
                      Number(event.target.value)
                    );
                  }}
                  style={{ flex: 1 }}
                />
                <span
                  style={{
                    minWidth: 48,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: "#94a3b8",
                  }}
                >
                  {rowSettingsRow.velocity.toFixed(2)}
                </span>
              </div>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                Adjust how prominent this row plays back during the song.
              </span>
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                Row actions
              </span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <IconButton
                  icon="content_copy"
                  label="Duplicate row"
                  showLabel
                  onClick={() => {
                    if (rowSettingsIndex === null) return;
                    handleDuplicateRow(rowSettingsIndex);
                  }}
                />
                <IconButton
                  icon="delete"
                  label="Delete row"
                  showLabel
                  tone="danger"
                  onClick={() => {
                    if (rowSettingsIndex === null) return;
                    handleDeleteRow(rowSettingsIndex);
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        {isPlayInstrumentOpen ? (
          <div
            className="scrollable"
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: 12,
              border: "1px solid #2a3344",
              background: "#111827",
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    background: playInstrumentColor,
                    boxShadow: `0 0 10px ${withAlpha(playInstrumentColor, 0.45)}`,
                  }}
                />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#e6f2ff",
                    letterSpacing: 0.2,
                  }}
                >
                  {formatInstrumentLabel(playInstrument)} Instrument
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                <IconButton
                  icon="close"
                  label="Close"
                  showLabel
                  onClick={handleCloseInstrumentPanel}
                />
                <IconButton
                  icon={recordingActive ? "stop" : "fiber_manual_record"}
                  label={recordingActive ? "Stop" : "Record"}
                  showLabel
                  tone={recordingActive ? "danger" : "default"}
                  onClick={() => setIsRecordEnabled((prev) => !prev)}
                  disabled={!hasPerformanceTarget}
                />
                <IconButton
                  icon="delete"
                  label="Clear"
                  showLabel
                  tone="danger"
                  onClick={handleClearRecording}
                  disabled={!canClearRecording}
                />
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                {isRecordEnabled ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      background: recordingActive
                        ? "rgba(248, 113, 113, 0.24)"
                        : "rgba(248, 113, 113, 0.14)",
                      border: `1px solid ${
                        recordingActive ? "#f87171" : "#fb7185"
                      }`,
                      color: "#fecdd3",
                      boxShadow: recordingActive
                        ? `0 0 12px ${withAlpha("#f87171", 0.35)}`
                        : "none",
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14 }}
                      aria-hidden="true"
                    >
                      fiber_manual_record
                    </span>
                    {recordIndicatorLabel}
                  </span>
                ) : null}
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  {liveRowMessage}
                </span>
              </div>
            </div>
            <div
              style={{
                borderRadius: 12,
                border: "1px solid #1f2937",
                background: "#10192c",
                padding: 12,
                flex: 1,
                minHeight: 0,
              }}
            >
              <InstrumentControlPanel
                track={playInstrumentTrackForPanel}
                allTracks={[]}
                onUpdatePattern={handlePlayInstrumentPatternUpdate}
                trigger={playInstrumentTrigger}
                isRecording={recordingActive}
                onPerformanceNote={handlePerformanceNoteRecorded}
              />
            </div>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Audition sounds or capture a new take for this performance row.
            </span>
          </div>
        ) : null}

      </div>
    </div>
  );
}

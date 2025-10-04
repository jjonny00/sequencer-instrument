import { useCallback, useEffect, useMemo } from "react";
import * as Tone from "tone";
import type {
  CSSProperties,
  Dispatch,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
} from "react";

import type { Chunk } from "./chunks";
import type {
  PatternGroup,
  PerformanceNote,
  PerformanceTrack,
  SongRow,
} from "./song";
import { createSongRow, getPerformanceTracksSpanMeasures } from "./song";
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
import { BottomDock } from "./components/layout/BottomDock";
import { TopBar } from "./components/layout/TopBar";
import { InstrumentControlPanel } from "./InstrumentControlPanel";
import { usePerformanceCapture } from "./hooks/usePerformanceCapture";
import { useTimelineState } from "./hooks/useTimelineState";
import { useTransport } from "./hooks/useTransport";
import { TimelineGrid } from "./views/song/TimelineGrid";
interface SongViewProps {
  patternGroups: PatternGroup[];
  songRows: SongRow[];
  setSongRows: Dispatch<SetStateAction<SongRow[]>>;
  currentSectionIndex: number;
  isPlaying: boolean;
  bpm: number;
  setBpm: Dispatch<SetStateAction<number>>;
  onToggleTransport: () => void;
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
  topBarLeft?: ReactNode;
  topBarCenter?: ReactNode;
  topBarRight?: ReactNode;
  timelineActions?: ReactNode;
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
const TIMELINE_TOOLBAR_GAP = 12;
const TIMELINE_CONTROL_HEIGHT = 36;
const TRANSPORT_CONTROL_HEIGHT = 44;

const TIMELINE_LABEL_STYLE: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: 0.3,
  color: "#e2e8f0",
};

const buildAccentButtonStyle = (
  enabled: boolean,
  height: number = TIMELINE_CONTROL_HEIGHT
): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 18px",
  height,
  borderRadius: 999,
  border: `1px solid ${enabled ? "#27E0B0" : "#273041"}`,
  background: enabled ? "#27E0B0" : "#273041",
  color: enabled ? "#0b1220" : "#475569",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  cursor: enabled ? "pointer" : "not-allowed",
  boxShadow: enabled ? "0 8px 24px rgba(39,224,176,0.35)" : "none",
  whiteSpace: "nowrap",
  transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
});

const buildSecondaryButtonStyle = (
  height: number = TIMELINE_CONTROL_HEIGHT
): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 16px",
  height,
  borderRadius: 999,
  border: "1px solid #1f2937",
  background: "#121a2c",
  color: "#e2e8f0",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  cursor: "pointer",
  whiteSpace: "nowrap",
  transition: "background 0.2s ease, border-color 0.2s ease, color 0.2s ease",
});

const TRANSPORT_CONTAINER_STYLE: CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  paddingLeft: "calc(var(--hpad) + env(safe-area-inset-left))",
  paddingRight: "calc(var(--hpad) + env(safe-area-inset-right))",
  borderTop: "1px solid #1f2937",
  background: "#0b1220",
  boxSizing: "border-box",
  gap: 16,
};

const buildTransportPlayButtonStyle = (isPlaying: boolean): CSSProperties => ({
  width: TRANSPORT_CONTROL_HEIGHT,
  height: TRANSPORT_CONTROL_HEIGHT,
  borderRadius: TRANSPORT_CONTROL_HEIGHT / 2,
  border: "none",
  background: isPlaying ? "#E02749" : "#27E0B0",
  color: isPlaying ? "#ffe4e6" : "#0b1220",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 26,
  cursor: "pointer",
  boxShadow: isPlaying
    ? "0 8px 24px rgba(224,39,73,0.32)"
    : "0 8px 24px rgba(39,224,176,0.32)",
  transition: "background 0.2s ease, box-shadow 0.2s ease, color 0.2s ease",
});

const BPM_SELECT_WRAPPER_STYLE: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
};

const BPM_SELECT_STYLE: CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  padding: "0 40px 0 18px",
  height: TRANSPORT_CONTROL_HEIGHT,
  borderRadius: 12,
  border: "1px solid #1f2937",
  background: "#111827",
  color: "#e2e8f0",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: 0.3,
  fontVariantNumeric: "tabular-nums",
  cursor: "pointer",
};

const BPM_SELECT_ICON_STYLE: CSSProperties = {
  position: "absolute",
  right: 14,
  pointerEvents: "none",
  color: "#94a3b8",
  fontSize: 20,
};

const TICKS_PER_QUARTER = Tone.Transport.PPQ;
const TICKS_PER_SIXTEENTH = TICKS_PER_QUARTER / 4;
const TICKS_PER_MEASURE = TICKS_PER_SIXTEENTH * 16;

interface TimelineColumn {
  id: string;
  index: number;
  hasSection: boolean;
}

interface TimelineRowItem {
  id: string;
  row: SongRow;
  rowIndex: number;
  maxColumns: number;
  safeColumnCount: number;
  rowMuted: boolean;
  rowSolo: boolean;
  rowAccent: string | null;
  labelBackground: string;
  rowSelected: boolean;
  isPerformanceRow: boolean;
  isRecordingRow: boolean;
  isArmedRow: boolean;
  rowGhostDisplayNotes: PerformanceNote[];
  rowGhostNoteSet?: Set<PerformanceNote>;
  performanceTrack?: PerformanceTrack;
  performanceAccent: string | null;
  performanceStatusLabel: string | null;
  performanceInstrumentLabel: string | null;
  performanceDescription: string | null;
  performanceHasContent: boolean;
  totalPerformanceNotes: number;
  performanceTextColor: string;
  performanceHighlightRange?: { start: number; end: number; color: string };
  combinedPerformanceNotes: PerformanceNote[];
  rowLabelTitle: string;
}

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
  performanceTracks,
  triggers,
  onEnsurePerformanceRow,
  activePerformanceTrackId,
  onAddPerformanceTrack,
  onSelectPerformanceTrack,
  onPlayInstrumentOpenChange,
  onUpdatePerformanceTrack,
  onRemovePerformanceTrack,
  topBarLeft,
  topBarCenter,
  topBarRight,
  timelineActions,
}: SongViewProps) {
  const {
    editingSlot,
    setEditingSlot,
    rowSettingsIndex,
    setRowSettingsIndex,
    isTimelineExpanded,
  } = useTimelineState();

  const {
    performanceTrackMap,
    isPlayInstrumentOpen,
    playInstrument,
    playInstrumentPattern,
    playInstrumentRowTrackId,
    isQuantizedRecording,
    setIsQuantizedRecording,
    isRecordEnabled,
    setIsRecordEnabled,
    liveGhostNotes,
    hasPerformanceTarget,
    recordingActive,
    isRecordArmed,
    handlePlayInstrumentPatternUpdate,
    handleCloseInstrumentPanel,
    handleSelectPerformanceTrackRow,
    handleClearRecording,
    handlePerformanceNoteRecorded,
    activePerformanceTrack,
  } = usePerformanceCapture({
    performanceTracks,
    activePerformanceTrackId,
    onPlayInstrumentOpenChange,
    onSelectPerformanceTrack,
    onUpdatePerformanceTrack,
    onEnsurePerformanceRow,
    createPerformancePattern,
    sortPerformanceNotes,
    ticksToTransportString,
    ticksToDurationString,
    ticksPerSixteenth: TICKS_PER_SIXTEENTH,
    ticksPerQuarter: TICKS_PER_QUARTER,
  });

  const { transportIcon, transportLabel, handleToggleTransport, handleBpmChange } =
    useTransport({ bpm, setBpm, isPlaying, onToggleTransport });

  const patternGroupMap = useMemo(
    () => new Map(patternGroups.map((group) => [group.id, group])),
    [patternGroups]
  );

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

  const handleAddSection = () => {
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

  const timelineRows = useMemo<TimelineRowItem[]>(() => {
    return songRows.map((row, rowIndex) => {
      const rowMuted = row.muted;
      const rowSolo = row.solo ?? false;
      const performanceTrack = row.performanceTrackId
        ? performanceTrackMap.get(row.performanceTrackId)
        : undefined;
      const performanceAccent = performanceTrack
        ? performanceTrack.color || getInstrumentColor(performanceTrack.instrument)
        : null;
      const isPerformanceRow = Boolean(row.performanceTrackId);
      const isSelectedPerformanceRow =
        isPerformanceRow && row.performanceTrackId === playInstrumentRowTrackId;
      const rowSelected = rowSettingsIndex === rowIndex || isSelectedPerformanceRow;
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
      const labelBackground = rowMuted
        ? "#1b2332"
        : rowSolo
        ? "#14241d"
        : "#111827";
      const isRecordingRow = recordingActive && isSelectedPerformanceRow;
      const isArmedRow = !isRecordingRow && isRecordArmed && isSelectedPerformanceRow;
      const rowGhostNotes = isRecordingRow ? liveGhostNotes : [];
      const rowGhostNoteSet = isRecordingRow ? liveGhostNoteSet : undefined;
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
        isPerformanceRow && performanceHasContent ? "#e6f2ff" : "#94a3b8";
      const maxColumns = Math.max(effectiveColumnCount, row.slots.length);
      const safeColumnCount = Math.max(1, maxColumns);
      const combinedPerformanceNotes = [
        ...(performanceTrack?.notes ?? []),
        ...rowGhostDisplayNotes,
      ];
      const rowLabelTitle = rowMuted
        ? "Tap to unmute. Double tap to solo. Long press for settings."
        : rowSolo
        ? "Tap to mute. Double tap to clear solo. Long press for settings."
        : "Tap to mute. Double tap to solo. Long press for settings.";

      return {
        id: `timeline-row-${rowIndex}`,
        row,
        rowIndex,
        maxColumns,
        safeColumnCount,
        rowMuted,
        rowSolo,
        rowAccent,
        labelBackground,
        rowSelected,
        isPerformanceRow,
        isRecordingRow,
        isArmedRow,
        rowGhostDisplayNotes,
        rowGhostNoteSet,
        performanceTrack,
        performanceAccent,
        performanceStatusLabel,
        performanceInstrumentLabel,
        performanceDescription,
        performanceHasContent,
        totalPerformanceNotes,
        performanceTextColor,
        performanceHighlightRange,
        combinedPerformanceNotes,
        rowLabelTitle,
      } satisfies TimelineRowItem;
    });
  }, [
    songRows,
    performanceTrackMap,
    playInstrumentRowTrackId,
    rowSettingsIndex,
    patternGroupMap,
    recordingActive,
    isRecordArmed,
    liveGhostNotes,
    liveGhostNoteSet,
    isPlaying,
    currentSectionIndex,
    effectiveColumnCount,
  ]);

  const timelineColumnCount = useMemo(() => {
    return timelineRows.reduce(
      (max, item) => Math.max(max, item.maxColumns),
      Math.max(1, sectionCount)
    );
  }, [timelineRows, sectionCount]);

  const timelineColumns = useMemo<TimelineColumn[]>(
    () =>
      Array.from({ length: timelineColumnCount }, (_, index) => ({
        id: `timeline-column-${index}`,
        index,
        hasSection: index < sectionCount,
      })),
    [timelineColumnCount, sectionCount]
  );

  const hasPerformanceRow = songRows.some((row) => Boolean(row.performanceTrackId));
  const showEmptyTimeline = sectionCount === 0 && !hasPerformanceRow;
  const slotMinHeight = SLOT_MIN_HEIGHT;
  const slotPadding = SLOT_PADDING;
  const slotGap = SLOT_CONTENT_GAP;
  const isTrackSelected = isPlayInstrumentOpen;
  const timelineRegionFlex =
    isTrackSelected && !isTimelineExpanded
      ? "0 0 var(--timeline-collapsed-h)"
      : "1 1 auto";
  const controlsRegionFlex =
    isTrackSelected && !isTimelineExpanded ? "1 1 auto" : "0 0 0";
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

  const renderTimelineCell = useCallback(
    (timelineRow: TimelineRowItem, column: TimelineColumn) => {
      const {
        row,
        rowIndex,
        rowMuted,
        rowAccent,
        rowGhostDisplayNotes,
        rowGhostNoteSet,
        performanceTrack,
        performanceAccent,
        combinedPerformanceNotes,
        isRecordingRow,
      } = timelineRow;
      const columnIndex = column.index;
      const groupId =
        columnIndex < row.slots.length ? row.slots[columnIndex] : null;
      const group = groupId ? patternGroupMap.get(groupId) : undefined;
      const highlight = isPlaying && columnIndex === currentSectionIndex;
      const isEditing =
        editingSlot?.rowIndex === rowIndex &&
        editingSlot.columnIndex === columnIndex;
      const assigned = Boolean(group);
      const columnBounds = getColumnTickBounds(columnIndex);
      const columnNoteCount = countPerformanceNotesInRange(
        combinedPerformanceNotes,
        columnBounds.startTicks,
        columnBounds.endTicks
      );
      const hasPerformanceContent = combinedPerformanceNotes.length > 0;
      const hasContent = assigned || hasPerformanceContent;
      const textColor = hasContent ? "#e6f2ff" : "#94a3b8";
      const descriptionColor = hasContent ? "#94a3b8" : "#475569";
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
        : "Save a sequence in Track view";
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
        cursor: patternGroups.length > 0 ? "pointer" : "not-allowed",
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
                border: `1px solid ${highlight ? "#27E0B0" : "#475569"}`,
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
                      columnIndex,
                      columnIndex + 1,
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
    },
    [
      patternGroupMap,
      isPlaying,
      currentSectionIndex,
      editingSlot,
      patternGroups,
      isPlayInstrumentOpen,
      slotMinHeight,
      slotGap,
      slotPadding,
      playInstrumentColor,
      handleAssignSlot,
      setEditingSlot,
      setRowSettingsIndex,
    ]
  );

  const renderTimelineRow = useCallback(
    (
      timelineRow: TimelineRowItem,
      columns: TimelineColumn[],
      renderCell: (row: TimelineRowItem, column: TimelineColumn) => ReactNode
    ) => {
      const {
        row,
        rowIndex,
        rowMuted,
        rowAccent,
        labelBackground,
        rowSelected,
        rowSolo,
        isPerformanceRow,
        isRecordingRow,
        isArmedRow,
        rowGhostDisplayNotes,
        rowGhostNoteSet,
        performanceTrack,
        performanceAccent,
        performanceStatusLabel,
        performanceInstrumentLabel,
        performanceDescription,
        performanceHasContent,
        performanceTextColor,
        performanceHighlightRange,
        safeColumnCount,
        maxColumns,
        rowLabelTitle,
      } = timelineRow;

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

      return (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}
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
              border: rowSelected ? "2px solid #27E0B0" : "1px solid #2a3344",
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
              title={rowLabelTitle}
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
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>
                              Live performance
                            </span>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>
                              {performanceInstrumentLabel ?? "Performance"}
                            </span>
                          </div>
                          {performanceStatusLabel ? (
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: 11,
                                color: "#cbd5f5",
                                letterSpacing: 0.4,
                                textTransform: "uppercase",
                                padding: "2px 8px",
                                borderRadius: 999,
                                background: isRecordingRow
                                  ? "rgba(248, 113, 113, 0.2)"
                                  : "rgba(248, 113, 113, 0.12)",
                              }}
                            >
                              {performanceStatusLabel}
                            </span>
                          ) : null}
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
                    columns
                      .slice(0, maxColumns)
                      .map((column) => renderCell(timelineRow, column))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    },
    [
      setEditingSlot,
      setRowSettingsIndex,
      handleToggleRowSolo,
      handleToggleRowMute,
      handleSelectPerformanceTrackRow,
      playInstrumentRowTrackId,
      slotPadding,
      timelineWidthStyle,
      slotMinHeight,
      slotGap,
      withAlpha,
      playInstrumentColor,
      renderPerformanceSlotPreview,
    ]
  );
  const timelineSection = (
    <div
      className="safe-top"
      style={{
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        paddingTop: "calc(env(safe-area-inset-top) + 16px)",
        paddingBottom: 16,
        paddingLeft: "calc(var(--hpad) + env(safe-area-inset-left))",
        paddingRight: "calc(var(--hpad) + env(safe-area-inset-right))",
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: TIMELINE_TOOLBAR_GAP,
            padding: "0 var(--hpad)",
          }}
        >
          <span style={TIMELINE_LABEL_STYLE}>Timeline</span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: TIMELINE_TOOLBAR_GAP,
              marginLeft: "auto",
            }}
          >
            <button
              type="button"
              onClick={handleAddRow}
              style={buildSecondaryButtonStyle()}
            >
              + Row
            </button>
            <button
              type="button"
              onClick={handleAddSection}
              style={buildSecondaryButtonStyle()}
            >
              + Sequence
            </button>
            {timelineActions ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: TIMELINE_TOOLBAR_GAP,
                }}
              >
                {timelineActions}
              </div>
            ) : null}
          </div>
        </div>
        <div
          className="min-h-0"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="min-h-0" style={{ height: "100%" }}>
            <div
              className="scrollable"
              style={{
                overflowX: "auto",
                paddingBottom: 4,
                height: "100%",
                minHeight: "100%",
              }}
            >
              {sectionCount > 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: 8,
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
                      {timelineColumns
                        .filter((column) => column.hasSection)
                        .map((column) => (
                          <button
                            key={`delete-column-${column.index}`}
                            type="button"
                            onClick={() => handleDeleteColumn(column.index)}
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
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 14 }}
                            >
                              delete
                            </span>
                            <span>Seq {column.index + 1}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <div
                style={{
                  width: timelineWidthStyle,
                  minWidth: timelineWidthStyle,
                }}
              >
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
                    Add a sequence to start placing loops into the timeline.
                  </div>
                ) : (
                  <TimelineGrid
                    rows={timelineRows}
                    columns={timelineColumns}
                    renderCell={renderTimelineCell}
                    renderRow={(row, cols, cellRenderer) =>
                      renderTimelineRow(row, cols, cellRenderer)
                    }
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const controlsSection = (
    <div
      style={{
        height: "100%",
        padding: isTrackSelected ? "12px 16px 16px" : 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxSizing: "border-box",
        background: "#0b1220",
        borderTop: "1px solid #1f2937",
      }}
    >
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
          opacity: isPlayInstrumentOpen ? 1 : 0,
          pointerEvents: isPlayInstrumentOpen ? "auto" : "none",
          transition: "opacity 180ms ease",
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
          <button
            type="button"
            onClick={() => setIsQuantizedRecording((prev) => !prev)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${
                isQuantizedRecording ? playInstrumentColor : "#2a3344"
              }`,
              background: isQuantizedRecording
                ? withAlpha(playInstrumentColor, 0.18)
                : "#0f172a",
              color: "#e6f2ff",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
            title={
              isQuantizedRecording
                ? "Quantized recording is on — notes snap to the grid."
                : "Quantized recording is off — capture free timing."
            }
          >
            Quantize {isQuantizedRecording ? "On" : "Off"}
          </button>
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
    </div>
  );

  const rowSettingsModal = (
    <Modal
      isOpen={hasRowSettings && Boolean(rowSettingsRow)}
      onClose={() => setRowSettingsIndex(null)}
      title="Row Settings"
      subtitle={
        rowSettingsLabel
          ? `Adjust playback for ${rowSettingsLabel}`
          : undefined
      }
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
  );

  return (
    <div
      id="song-root"
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {topBarLeft || topBarCenter || topBarRight ? (
        <TopBar left={topBarLeft} center={topBarCenter} right={topBarRight} />
      ) : null}

      <div
        id="song-middle"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          id="timeline-region"
          className="scroll-y"
          style={{
            flex: timelineRegionFlex,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {timelineSection}
        </div>

        <div
          id="controls-region"
          className="scroll-y"
          style={{
            flex: controlsRegionFlex,
            minHeight: 0,
            overflowY: "auto",
            transition: "flex-basis 180ms ease",
          }}
        >
          {controlsSection}
        </div>
      </div>

      <div
        id="bottom-dock-wrapper"
        style={{
          flex: "0 0 auto",
          position: "sticky",
          bottom: 0,
          zIndex: 5,
          background: "var(--color-bg)",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <BottomDock heightVar="var(--transport-h)">
          <div style={TRANSPORT_CONTAINER_STYLE}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                aria-label={transportLabel}
                onPointerDown={handleToggleTransport}
                onPointerUp={(event) => event.currentTarget.blur()}
                style={buildTransportPlayButtonStyle(isPlaying)}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  {transportIcon}
                </span>
              </button>
              <div style={BPM_SELECT_WRAPPER_STYLE}>
                <select
                  value={bpm}
                  onChange={(event) =>
                    handleBpmChange(parseInt(event.target.value, 10))
                  }
                  style={BPM_SELECT_STYLE}
                  aria-label="Tempo (beats per minute)"
                >
                  {[90, 100, 110, 120, 130].map((value) => (
                    <option key={value} value={value}>
                      {`${value} BPM`}
                    </option>
                  ))}
                </select>
                <span
                  className="material-symbols-outlined"
                  style={BPM_SELECT_ICON_STYLE}
                  aria-hidden="true"
                >
                  expand_more
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddPerformanceTrack}
              disabled={!onAddPerformanceTrack}
              style={buildAccentButtonStyle(
                Boolean(onAddPerformanceTrack),
                TRANSPORT_CONTROL_HEIGHT
              )}
            >
              + Track
            </button>
          </div>
        </BottomDock>
      </div>

      {rowSettingsModal}
    </div>
  );
}

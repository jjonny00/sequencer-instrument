import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CSSProperties,
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";

import type { Chunk } from "./chunks";
import type { PatternGroup, PerformanceTrack, SongRow } from "./song";
import { createSongRow } from "./song";
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
  onPlayInstrumentOpenChange?: (open: boolean) => void;
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

const PLAYABLE_INSTRUMENTS: TrackInstrument[] = [
  "arp",
  "keyboard",
  "harmonia",
];

const createPerformancePattern = (instrument: TrackInstrument): Chunk => ({
  id: `live-${instrument}-${Math.random().toString(36).slice(2, 8)}`,
  name: `${instrument}-performance`,
  instrument,
  steps: Array(16).fill(0),
  velocities: Array(16).fill(0),
  note: "C4",
  sustain: 0.8,
  velocityFactor: 1,
  timingMode: "sync",
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
  columnEnd: number
) => {
  const height = PREVIEW_HEIGHT;
  if (!performanceTrack || performanceTrack.notes.length === 0) {
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

  const { notes } = performanceTrack;
  const trackNotes = notes.filter(
    (note) => note.time + note.duration > columnStart && note.time < columnEnd
  );

  if (trackNotes.length === 0) {
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

  const range = columnEnd - columnStart;
  const accent =
    performanceTrack.color || getInstrumentColor(performanceTrack.instrument);
  const dotSize = PERFORMANCE_DOT_SIZE;

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
      {trackNotes.map((note, index) => {
        const start = Math.max(note.time, columnStart);
        const startRatio = (start - columnStart) / range;
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
              background: accent,
              boxShadow: `0 0 6px ${withAlpha(accent, 0.35)}`,
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
  onPlayInstrumentOpenChange,
}: SongViewProps) {
  const [editingSlot, setEditingSlot] = useState<
    { rowIndex: number; columnIndex: number } | null
  >(null);
  const [rowSettingsIndex, setRowSettingsIndex] = useState<number | null>(null);
  const [isTimelineExpanded, setTimelineExpanded] = useState(false);
  const [isPlayInstrumentOpen, setPlayInstrumentOpen] = useState(false);
  const [playInstrument, setPlayInstrument] =
    useState<TrackInstrument>("keyboard");
  const [playInstrumentPattern, setPlayInstrumentPattern] = useState<Chunk>(() =>
    createPerformancePattern("keyboard")
  );
  const [playInstrumentRowTrackId, setPlayInstrumentRowTrackId] = useState<
    string | null
  >(activePerformanceTrackId);

  useEffect(() => {
    onPlayInstrumentOpenChange?.(isPlayInstrumentOpen);
  }, [isPlayInstrumentOpen, onPlayInstrumentOpenChange]);

  const handleTogglePlayInstrumentPanel = useCallback(() => {
    setPlayInstrumentOpen((prev) => !prev);
  }, []);

  const handleSelectPlayInstrument = useCallback(
    (instrument: TrackInstrument) => {
      setPlayInstrument(instrument);
    },
    []
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
        return { ...next, instrument: playInstrument };
      });
    },
    [playInstrument]
  );

  useEffect(() => {
    if (!isPlayInstrumentOpen) return;
    setPlayInstrumentRowTrackId((currentId) =>
      onEnsurePerformanceRow(playInstrument, currentId) ?? currentId
    );
  }, [isPlayInstrumentOpen, playInstrument, onEnsurePerformanceRow]);

  useEffect(() => {
    if (isPlayInstrumentOpen) return;
    setPlayInstrumentRowTrackId(activePerformanceTrackId ?? null);
  }, [activePerformanceTrackId, isPlayInstrumentOpen]);

  useEffect(() => {
    setPlayInstrumentPattern(createPerformancePattern(playInstrument));
  }, [playInstrument]);

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

  const sectionCount = useMemo(
    () => songRows.reduce((max, row) => Math.max(max, row.slots.length), 0),
    [songRows]
  );

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
    [setSongRows]
  );

  const showEmptyTimeline = sectionCount === 0;
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
  const playInstrumentColor = useMemo(
    () => getInstrumentColor(playInstrument),
    [playInstrument]
  );
  const playInstrumentSource = useMemo(
    () => resolveInstrumentSource(playInstrument),
    [playInstrument]
  );
  const playInstrumentCharacterId = playInstrumentSource?.characterId ?? "";
  const playInstrumentTrackForPanel = useMemo<Track>(
    () => ({
      id: -1,
      name: `${formatInstrumentLabel(playInstrument)} Live`,
      instrument: playInstrument,
      pattern: playInstrumentPattern,
      muted: false,
      source: playInstrumentSource
        ? {
            packId: playInstrumentSource.packId,
            instrumentId: playInstrument,
            characterId: playInstrumentCharacterId,
          }
        : undefined,
    }),
    [
      playInstrument,
      playInstrumentPattern,
      playInstrumentSource,
      playInstrumentCharacterId,
    ]
  );
  const playInstrumentTrigger = useMemo(() => {
    if (!playInstrumentSource) return undefined;
    const triggerKey = createTriggerKey(
      playInstrumentSource.packId,
      playInstrument
    );
    const trigger = triggers[triggerKey];
    if (!trigger) return undefined;
    return (
      time: number,
      velocity?: number,
      pitch?: number,
      note?: string,
      sustain?: number,
      chunk?: Chunk
    ) =>
      trigger(
        time,
        velocity,
        pitch,
        note,
        sustain,
        chunk,
        playInstrumentCharacterId || undefined
      );
  }, [
    playInstrumentSource,
    playInstrument,
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
        {!isPlayInstrumentOpen ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: "#e6f2ff",
              }}
            >
              Timeline
            </h2>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <IconButton
                icon={isTimelineExpanded ? "unfold_less" : "unfold_more"}
                label={timelineToggleLabel}
                onClick={() => setTimelineExpanded((previous) => !previous)}
                style={{ minWidth: 0 }}
              />
              <button
                onClick={handleAddRow}
                style={{
                  padding: "6px 12px",
                  borderRadius: 20,
                  border: "1px solid #333",
                  background: "#273041",
                  color: "#e6f2ff",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                + Row
              </button>
              <button
                onClick={handleAddSection}
                style={{
                  padding: "6px 12px",
                  borderRadius: 20,
                  border: "1px solid #333",
                  background: "#273041",
                  color: "#e6f2ff",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                + Sequence
              </button>
            </div>
          </div>
        ) : null}
        <div
          className="scrollable"
          style={{
            overflowX: "auto",
            paddingBottom: 4,
            minHeight: `${timelineViewportHeight}px`,
            maxHeight: `${timelineViewportHeight}px`,
          }}
        >
          <div
            style={{
              maxHeight: `${timelineViewportHeight}px`,
              minHeight: `${timelineViewportHeight}px`,
              overflowY: shouldEnableVerticalScroll ? "auto" : "visible",
              paddingRight: shouldEnableVerticalScroll ? 6 : 0,
              minWidth: "100%",
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
                Add a sequence to start placing loops into the timeline.
              </div>
            ) : (
              songRows.map((row, rowIndex) => {
                const maxColumns = Math.max(sectionCount, row.slots.length);
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
                  handleToggleRowMute(rowIndex);
                };

                const handleLabelPointerLeave = () => {
                  if (labelTimer) window.clearTimeout(labelTimer);
                  labelTimer = null;
                };

                const rowMuted = row.muted;
                const rowSelected = rowSettingsIndex === rowIndex;
                const performanceTrack = row.performanceTrackId
                  ? performanceTrackMap.get(row.performanceTrackId)
                  : undefined;
                const performanceAccent = performanceTrack
                  ? performanceTrack.color ||
                    getInstrumentColor(performanceTrack.instrument)
                  : null;
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
                const labelBackground = rowMuted ? "#1b2332" : "#111827";

                return (
                  <div
                    key={`row-${rowIndex}`}
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <div
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
                            ? "Tap to unmute. Long press for settings."
                            : "Tap to mute. Long press for settings."
                        }
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 6,
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
                            width: "100%",
                            overflowX: "auto",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: `repeat(${maxColumns}, ${SLOT_WIDTH}px)`,
                              gap: SLOT_GAP,
                            }}
                          >
                            {Array.from({ length: maxColumns }, (_, columnIndex) => {
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
                              const columnPerformanceNotes = performanceTrack
                                ? performanceTrack.notes.filter(
                                    (note) =>
                                      note.time + note.duration > columnStart &&
                                      note.time < columnEnd
                                  )
                                : [];
                              const hasPerformance = Boolean(performanceTrack);
                              const hasContent = assigned || hasPerformance;
                              const textColor = hasContent ? "#e6f2ff" : "#94a3b8";
                              const descriptionColor = hasContent
                                ? "#94a3b8"
                                : "#475569";
                              const description = hasPerformance
                                ? columnPerformanceNotes.length > 0
                                  ? formatNoteCount(columnPerformanceNotes.length)
                                  : "No notes yet"
                                : assigned
                                ? null
                                : patternGroups.length > 0
                                ? "Tap to assign"
                                : "Save a sequence in Track view";

                              const showSlotLabel = !isPlayInstrumentOpen;
                              const buttonStyles: CSSProperties = {
                                width: "100%",
                                minHeight: slotMinHeight,
                                borderRadius: 8,
                                border: `1px solid ${
                                  highlight
                                    ? "#27E0B0"
                                    : hasContent
                                    ? "#2f384a"
                                    : "#1f2937"
                                }`,
                                background: highlight
                                  ? "rgba(39, 224, 176, 0.12)"
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
                                            {group?.name ??
                                              (hasPerformance
                                                ? `${formatInstrumentLabel(
                                                    performanceTrack?.instrument
                                                  )} Performance`
                                                : "Empty")}
                                          </span>
                                          {hasPerformance && (
                                            <span
                                              style={{
                                                marginLeft: "auto",
                                                fontSize: 10,
                                                color: "#cbd5f5",
                                                letterSpacing: 0.4,
                                                textTransform: "uppercase",
                                              }}
                                            >
                                              Live
                                            </span>
                                          )}
                                        </div>
                                      ) : null}
                                      <div style={{ width: "100%" }}>
                                        {hasPerformance
                                          ? renderPerformanceSlotPreview(
                                              performanceTrack,
                                              columnStart,
                                              columnEnd
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
                            })}
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
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <label>BPM</label>
          <select
            value={bpm}
            onChange={(e) => setBpm(parseInt(e.target.value, 10))}
            style={{
              padding: 8,
              borderRadius: 8,
              background: "#121827",
              color: "white",
            }}
          >
            {[90, 100, 110, 120, 130].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <IconButton
            icon="piano"
            label="Play Instrument"
            showLabel
            tone={isPlayInstrumentOpen ? "accent" : "default"}
            onClick={handleTogglePlayInstrumentPanel}
            style={{ minWidth: 0 }}
          />
          <button
            aria-label={isPlaying ? "Stop" : "Play"}
            onPointerDown={onToggleTransport}
            onPointerUp={(e) => e.currentTarget.blur()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 8,
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
        </div>
      </div>

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
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {liveRowLabel
                  ? `${liveRowLabel} captures this performance`
                  : "Live row added to your timeline"}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              {PLAYABLE_INSTRUMENTS.map((instrumentOption) => {
                const selected = instrumentOption === playInstrument;
                const accent = getInstrumentColor(instrumentOption);
                return (
                  <button
                    key={instrumentOption}
                    type="button"
                    onClick={() => handleSelectPlayInstrument(instrumentOption)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 999,
                      border: selected
                        ? `1px solid ${accent}`
                        : "1px solid #2a3344",
                      background: selected
                        ? withAlpha(accent, 0.22)
                        : "#0f172a",
                      color: selected ? "#e6f2ff" : "#94a3b8",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: 0.4,
                      cursor: "pointer",
                      transition: "background 0.2s ease, border 0.2s ease",
                    }}
                  >
                    {formatInstrumentLabel(instrumentOption)}
                  </button>
                );
              })}
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
              />
            </div>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Play and record directly into the live performance row from this
              panel.
            </span>
          </div>
        ) : (
          <div
            className="scrollable"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              paddingRight: 4,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#e6f2ff",
                }}
              >
                Loops Library
              </h3>
              <span
                style={{
                  fontSize: 12,
                  color: "#94a3b8",
                }}
              >
                Save and edit loops in Track view, then place them onto the song
                timeline.
              </span>
            </div>
            {patternGroups.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  border: "1px dashed #475569",
                  color: "#94a3b8",
                  fontSize: 13,
                }}
              >
                No loops yet. Create loops in Track view to start arranging
                the song.
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {patternGroups.map((group) => {
                  const trackLabels = group.tracks
                    .map((track) => track.name)
                    .filter((name): name is string => Boolean(name));
                  const isActive = selectedGroupId === group.id;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => onSelectLoop(group.id)}
                      style={{
                        borderRadius: 10,
                        border: `1px solid ${isActive ? "#27E0B0" : "#333"}`,
                        background: isActive
                          ? "rgba(39, 224, 176, 0.12)"
                          : "#121827",
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        textAlign: "left",
                        cursor: "pointer",
                        color: "#e6f2ff",
                      }}
                      title={`Open ${group.name} in Track view`}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span aria-hidden="true" style={{ fontSize: 16 }}>
                          📼
                        </span>
                        <span style={{ fontWeight: 600 }}>{group.name}</span>
                        <div style={{ marginLeft: "auto" }} />
                      </div>
                      {trackLabels.length === 0 ? (
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>
                          This loop is empty — add instruments in Tracks view
                          first.
                        </span>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          {trackLabels.map((name) => (
                            <span
                              key={`${group.id}-${name}`}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 6,
                                background: "#1f2532",
                                border: "1px solid #333",
                                fontSize: 12,
                              }}
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

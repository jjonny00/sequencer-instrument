import { useEffect, useMemo, useState } from "react";
import type {
  CSSProperties,
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";

import type { PatternGroup, PerformanceTrack, SongRow } from "./song";
import { createSongRow } from "./song";
import { getInstrumentColor, withAlpha } from "./utils/color";
import type { Track } from "./tracks";
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
  onOpenLoopsLibrary: () => void;
  onSelectLoop: (groupId: string) => void;
  performanceTracks: PerformanceTrack[];
}

const SLOT_WIDTH = 150;
const SLOT_GAP = 8;
const ROW_LABEL_WIDTH = 60;
const MAX_PREVIEW_STEPS = 16;
const PREVIEW_GAP_COLLAPSED = 1;
const PREVIEW_GAP_EXPANDED = 2;
const PREVIEW_HEIGHT_COLLAPSED = 14;
const PREVIEW_HEIGHT_EXPANDED = 28;
const PERFORMANCE_MIN_SEGMENT_WIDTH = 4;

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

const renderLoopSlotPreview = (
  group: PatternGroup | undefined,
  isExpanded: boolean
) => {
  if (!group) {
    return (
      <div
        style={{
          height: isExpanded ? PREVIEW_HEIGHT_EXPANDED : PREVIEW_HEIGHT_COLLAPSED,
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
          height: isExpanded ? PREVIEW_HEIGHT_EXPANDED : PREVIEW_HEIGHT_COLLAPSED,
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

  const gap = isExpanded ? PREVIEW_GAP_EXPANDED : PREVIEW_GAP_COLLAPSED;
  const dotSize = isExpanded ? 7 : 4;
  const containerHeight = isExpanded
    ? PREVIEW_HEIGHT_EXPANDED
    : PREVIEW_HEIGHT_COLLAPSED;

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
  isExpanded: boolean
) => {
  const height = isExpanded ? PREVIEW_HEIGHT_EXPANDED : PREVIEW_HEIGHT_COLLAPSED;
  if (!performanceTrack || performanceTrack.notes.length === 0) {
    return (
      <div
        style={{
          height,
          borderRadius: 6,
          background: "rgba(30, 41, 59, 0.65)",
          border: "1px solid #1f2937",
        }}
      />
    );
  }

  const { notes } = performanceTrack;
  const accent = performanceTrack.color || getInstrumentColor(performanceTrack.instrument);
  const background = withAlpha(accent, 0.12);
  const trackNotes = notes.filter(
    (note) => note.time + note.duration > columnStart && note.time < columnEnd
  );

  if (trackNotes.length === 0) {
    return (
      <div
        style={{
          height,
          borderRadius: 6,
          background: withAlpha(accent, 0.08),
          border: `1px solid ${withAlpha(accent, 0.25)}`,
        }}
      />
    );
  }

  const range = columnEnd - columnStart;
  const dotHeight = isExpanded ? 10 : 6;
  const verticalPadding = isExpanded ? 4 : 3;

  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: 6,
        background,
        border: `1px solid ${withAlpha(accent, 0.25)}`,
        overflow: "hidden",
      }}
    >
      {trackNotes.map((note, index) => {
        const start = Math.max(note.time, columnStart);
        const end = Math.min(note.time + note.duration, columnEnd);
        if (end <= start) {
          return null;
        }
        const startRatio = (start - columnStart) / range;
        const endRatio = (end - columnStart) / range;
        const widthPercent = Math.max(
          PERFORMANCE_MIN_SEGMENT_WIDTH,
          (endRatio - startRatio) * 100
        );
        return (
          <span
            key={`perf-note-${index}`}
            style={{
              position: "absolute",
              left: `${startRatio * 100}%`,
              width: `${widthPercent}%`,
              top: verticalPadding,
              height: dotHeight,
              borderRadius: 999,
              background: accent,
              boxShadow: `0 0 6px ${withAlpha(accent, 0.35)}`,
            }}
          />
        );
      })}
    </div>
  );
};

const formatTrackCount = (count: number) =>
  `${count} track${count === 1 ? "" : "s"}`;

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
  onOpenLoopsLibrary,
  onSelectLoop,
  performanceTracks,
}: SongViewProps) {
  const [editingSlot, setEditingSlot] = useState<
    { rowIndex: number; columnIndex: number } | null
  >(null);
  const [activeRowSettings, setActiveRowSettings] = useState<number | null>(
    null
  );
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

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

  const activeGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    return patternGroups.find((group) => group.id === selectedGroupId) ?? null;
  }, [patternGroups, selectedGroupId]);

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
    if (activeRowSettings === null) return;
    if (activeRowSettings >= songRows.length) {
      setActiveRowSettings(null);
    }
  }, [activeRowSettings, songRows.length]);

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

  const showEmptyTimeline = sectionCount === 0;

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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onOpenLoopsLibrary}
          disabled={patternGroups.length === 0}
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid #333",
            background: "#1f2532",
            color: patternGroups.length === 0 ? "#475569" : "#e6f2ff",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.3,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: patternGroups.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          <span>
            Loop: {activeGroup?.name ?? "None"}
          </span>
          <span aria-hidden="true" style={{ fontSize: 10 }}>
            ▴
          </span>
        </button>
      </div>
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
            Song Timeline
          </h2>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button
              onClick={handleAddRow}
              style={{
                padding: "6px 12px",
                borderRadius: 20,
                border: "1px solid #333",
                background: "#273041",
                color: "#e6f2ff",
                fontSize: 12,
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
              }}
            >
              + Section
            </button>
          </div>
        </div>
        <div
          className="scrollable"
          style={{
            overflowX: "auto",
            paddingBottom: 4,
            minHeight: 120,
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
                Add a section to start placing sequences into the song timeline.
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
                    setActiveRowSettings(rowIndex);
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
                const rowSelected = activeRowSettings === rowIndex;
                const performanceTrack = row.performanceTrackId
                  ? performanceTrackMap.get(row.performanceTrackId)
                  : undefined;
                const isRowExpanded = Boolean(expandedRows[rowIndex]);
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
                const rowAccent = performanceAccent ?? loopAccent;
                const labelBorderColor = rowSelected
                  ? "#27E0B0"
                  : rowAccent
                  ? withAlpha(rowAccent, 0.6)
                  : "#333";
                const labelBackground = rowMuted
                  ? "#181f2b"
                  : rowAccent
                  ? withAlpha(rowAccent, 0.18)
                  : "#121827";

                return (
                  <div
                    key={`row-${rowIndex}`}
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: SLOT_GAP,
                        alignItems: "stretch",
                        opacity: rowMuted ? 0.55 : 1,
                        transition: "opacity 0.2s ease",
                      }}
                    >
                      <div
                        onPointerDown={handleLabelPointerDown}
                        onPointerUp={handleLabelPointerUp}
                        onPointerLeave={handleLabelPointerLeave}
                        onPointerCancel={handleLabelPointerLeave}
                        style={{
                          width: ROW_LABEL_WIDTH,
                          borderRadius: 8,
                          border: `1px solid ${labelBorderColor}`,
                          background: labelBackground,
                          color: rowMuted ? "#475569" : "#f8fafc",
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 600,
                          cursor: "pointer",
                          userSelect: "none",
                          letterSpacing: 0.4,
                          position: "relative",
                        }}
                        title={
                          rowMuted
                            ? "Tap to unmute. Long press for settings."
                            : "Tap to mute. Long press for settings."
                        }
                      >
                        {rowIndex + 1}
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
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setExpandedRows((previous) => {
                              const next = { ...previous };
                              next[rowIndex] = !isRowExpanded;
                              return next;
                            });
                          }}
                          style={{
                            position: "absolute",
                            bottom: 4,
                            right: 4,
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            border: "1px solid #2a3344",
                            background: "rgba(15, 23, 42, 0.85)",
                            color: "#94a3b8",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                          aria-label={
                            isRowExpanded
                              ? "Collapse row preview"
                              : "Expand row preview"
                          }
                        >
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                            style={{ fontSize: 14, lineHeight: 1 }}
                          >
                            {isRowExpanded ? "unfold_less" : "unfold_more"}
                          </span>
                        </button>
                      </div>
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
                          const slotAccentInstrument = group?.tracks.find(
                            (track) => track.instrument
                          )?.instrument;
                          const slotAccentColor = hasPerformance
                            ? performanceAccent
                            : slotAccentInstrument
                            ? getInstrumentColor(slotAccentInstrument)
                            : rowAccent;
                          const resolvedAccent = slotAccentColor ?? "#273041";
                          const hasContent = assigned || hasPerformance;
                          const textColor = hasContent ? "#e6f2ff" : "#64748b";
                          const descriptionColor = hasContent
                            ? "#94a3b8"
                            : "#475569";

                          const buttonStyles: CSSProperties = {
                            width: "100%",
                            minHeight: isRowExpanded ? 104 : 80,
                            borderRadius: 8,
                            border: `1px solid ${
                              highlight
                                ? "#27E0B0"
                                : hasContent
                                ? withAlpha(resolvedAccent, 0.55)
                                : "#333"
                            }`,
                            background: hasContent
                              ? highlight
                                ? withAlpha(resolvedAccent, 0.32)
                                : withAlpha(resolvedAccent, 0.22)
                              : "#111826",
                            color: textColor,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "stretch",
                            justifyContent: "space-between",
                            gap: isRowExpanded ? 8 : 6,
                            padding: isRowExpanded ? "10px 12px" : "8px 12px",
                            fontSize: 13,
                            cursor:
                              patternGroups.length > 0 ? "pointer" : "not-allowed",
                            textAlign: "left",
                            opacity: rowMuted ? 0.7 : 1,
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
                                    minHeight: isRowExpanded ? 104 : 80,
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
                                      {groupOption.name} (
                                      {formatTrackCount(groupOption.tracks.length)})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (patternGroups.length === 0) return;
                                    setActiveRowSettings(null);
                                    setEditingSlot({ rowIndex, columnIndex });
                                  }}
                                  style={buttonStyles}
                                  disabled={patternGroups.length === 0}
                                >
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
                                          padding: "2px 6px",
                                          borderRadius: 999,
                                          background: withAlpha(
                                            resolvedAccent,
                                            0.25
                                          ),
                                          border: `1px solid ${withAlpha(
                                            resolvedAccent,
                                            0.35
                                          )}`,
                                          color: "#f8fafc",
                                          fontWeight: 600,
                                          letterSpacing: 0.4,
                                          textTransform: "uppercase",
                                        }}
                                      >
                                        Live
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ width: "100%" }}>
                                    {hasPerformance
                                      ? renderPerformanceSlotPreview(
                                          performanceTrack,
                                          columnStart,
                                          columnEnd,
                                          isRowExpanded
                                        )
                                      : renderLoopSlotPreview(group, isRowExpanded)}
                                  </div>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: descriptionColor,
                                    }}
                                  >
                                    {assigned
                                      ? formatTrackCount(group?.tracks.length ?? 0)
                                      : hasPerformance
                                      ? columnPerformanceNotes.length > 0
                                        ? formatNoteCount(
                                            columnPerformanceNotes.length
                                          )
                                        : "No notes yet"
                                      : patternGroups.length > 0
                                      ? "Tap to assign"
                                      : "Save a sequence in Track view"}
                                  </span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {activeRowSettings === rowIndex && (
                      <div
                        style={{
                          marginLeft: ROW_LABEL_WIDTH,
                          padding: "12px 16px",
                          background: "rgba(17, 24, 39, 0.95)",
                          borderRadius: 8,
                          border: "1px solid #333",
                          display: "flex",
                          alignItems: "center",
                          gap: 16,
                          boxShadow: "0 8px 20px rgba(8, 12, 20, 0.45)",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            flex: "1 1 auto",
                            fontSize: 12,
                            color: "#94a3b8",
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 18 }}
                            aria-hidden="true"
                          >
                            speed
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={row.velocity}
                            onChange={(event) =>
                              handleRowVelocityChange(
                                rowIndex,
                                Number(event.target.value)
                              )
                            }
                            style={{ flex: 1 }}
                          />
                          <span style={{ width: 48, textAlign: "right" }}>
                            {row.velocity.toFixed(2)}
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setActiveRowSettings(null)}
                          aria-label="Close row settings"
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 6,
                            border: "1px solid #333",
                            background: "#27E0B0",
                            color: "#0f1420",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 20 }}
                          >
                            check
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

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
        <div style={{ display: "flex", gap: 12 }}>
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
                    <span
                      style={{
                        fontSize: 12,
                        color: "#94a3b8",
                      }}
                    >
                      {formatTrackCount(group.tracks.length)}
                    </span>
                    <div style={{ marginLeft: "auto" }} />
                  </div>
                  {trackLabels.length === 0 ? (
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      This loop is empty — add instruments in Tracks view first.
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
    </div>
  );
}

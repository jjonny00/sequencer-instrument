import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";

import type { PatternGroup } from "./song";
import type { Track } from "./tracks";

interface SongViewProps {
  tracks: Track[];
  patternGroups: PatternGroup[];
  setPatternGroups: Dispatch<SetStateAction<PatternGroup[]>>;
  songRows: (string | null)[][];
  setSongRows: Dispatch<SetStateAction<(string | null)[][]>>;
  currentSectionIndex: number;
  isPlaying: boolean;
  bpm: number;
  setBpm: Dispatch<SetStateAction<number>>;
  onPlayPause: () => void;
  onStop: () => void;
}

const SLOT_WIDTH = 150;
const SLOT_GAP = 8;
const ROW_LABEL_WIDTH = 80;

const createPatternGroupId = () =>
  `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createEmptyRow = (length: number) =>
  Array.from({ length }, () => null as string | null);

const formatTrackCount = (count: number) =>
  `${count} track${count === 1 ? "" : "s"}`;

export function SongView({
  tracks,
  patternGroups,
  setPatternGroups,
  songRows,
  setSongRows,
  currentSectionIndex,
  isPlaying,
  bpm,
  setBpm,
  onPlayPause,
  onStop,
}: SongViewProps) {
  const [editingSlot, setEditingSlot] = useState<
    { rowIndex: number; columnIndex: number } | null
  >(null);

  const trackMap = useMemo(
    () => new Map(tracks.map((track) => [track.id, track])),
    [tracks]
  );

  const patternGroupMap = useMemo(
    () => new Map(patternGroups.map((group) => [group.id, group])),
    [patternGroups]
  );

  const sectionCount = useMemo(
    () => songRows.reduce((max, row) => Math.max(max, row.length), 0),
    [songRows]
  );

  const playableTracks = useMemo(
    () => tracks.filter((track) => track.pattern),
    [tracks]
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
    if (columnIndex >= songRows[rowIndex].length) {
      setEditingSlot(null);
    }
  }, [editingSlot, songRows, patternGroups.length]);

  const handleAddSection = () => {
    setSongRows((rows) => {
      if (rows.length === 0) {
        return [[null]];
      }
      return rows.map((row) => [...row, null]);
    });
  };

  const handleAddRow = () => {
    setSongRows((rows) => {
      const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const newRow = createEmptyRow(maxColumns);
      if (rows.length === 0) {
        return [newRow.length ? newRow : [null]];
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
        const nextRow = row.slice();
        while (nextRow.length <= columnIndex) {
          nextRow.push(null);
        }
        nextRow[columnIndex] = groupId;
        return nextRow;
      })
    );
  };

  const handleCreatePatternGroup = () => {
    if (playableTracks.length === 0) return;
    const snapshot = playableTracks.map((track) => track.id);
    setPatternGroups((prev) => {
      const existingNames = new Set(prev.map((group) => group.name));
      let index = prev.length + 1;
      let candidate = `Group ${index}`;
      while (existingNames.has(candidate)) {
        index += 1;
        candidate = `Group ${index}`;
      }
      const newGroup: PatternGroup = {
        id: createPatternGroupId(),
        name: candidate,
        trackIds: snapshot,
      };
      return [...prev, newGroup];
    });
  };

  const handleDuplicatePatternGroup = (groupId: string) => {
    setPatternGroups((prev) => {
      const source = prev.find((group) => group.id === groupId);
      if (!source) return prev;
      const existingNames = new Set(prev.map((group) => group.name));
      const baseName = `${source.name} Copy`;
      let candidate = baseName;
      let counter = 2;
      while (existingNames.has(candidate)) {
        candidate = `${baseName} ${counter}`;
        counter += 1;
      }
      const copy: PatternGroup = {
        id: createPatternGroupId(),
        name: candidate,
        trackIds: [...source.trackIds],
      };
      return [...prev, copy];
    });
  };

  const timelineHeader = (
    <div
      style={{
        display: "flex",
        gap: SLOT_GAP,
        paddingLeft: ROW_LABEL_WIDTH,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${sectionCount}, ${SLOT_WIDTH}px)`,
          gap: SLOT_GAP,
        }}
      >
        {Array.from({ length: sectionCount }, (_, index) => {
          const highlight = isPlaying && index === currentSectionIndex;
          return (
            <div
              key={`header-${index}`}
              style={{
                height: 28,
                borderRadius: 6,
                border: `1px solid ${highlight ? "#27E0B0" : "#333"}`,
                background: highlight ? "#1f2532" : "#121827",
                color: highlight ? "#27E0B0" : "#94a3b8",
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {index + 1}
            </div>
          );
        })}
      </div>
    </div>
  );

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
                Add a section to start placing Pattern Groups into the song timeline.
              </div>
            ) : (
              <>
                {timelineHeader}
                {songRows.map((row, rowIndex) => {
                  const maxColumns = Math.max(sectionCount, row.length);
                  return (
                    <div
                      key={`row-${rowIndex}`}
                      style={{
                        display: "flex",
                        gap: SLOT_GAP,
                        alignItems: "stretch",
                      }}
                    >
                      <div
                        style={{
                          width: ROW_LABEL_WIDTH,
                          borderRadius: 8,
                          border: "1px solid #333",
                          background: "#121827",
                          color: "#94a3b8",
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 600,
                        }}
                      >
                        Row {rowIndex + 1}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: `repeat(${maxColumns}, ${SLOT_WIDTH}px)` ,
                          gap: SLOT_GAP,
                        }}
                      >
                        {Array.from({ length: maxColumns }, (_, columnIndex) => {
                          const groupId =
                            columnIndex < row.length ? row[columnIndex] : null;
                          const group = groupId
                            ? patternGroupMap.get(groupId)
                            : undefined;
                          const highlight =
                            isPlaying && columnIndex === currentSectionIndex;
                          const isEditing =
                            editingSlot?.rowIndex === rowIndex &&
                            editingSlot.columnIndex === columnIndex;
                          const assigned = Boolean(group);

                          const buttonStyles: CSSProperties = {
                            width: "100%",
                            height: 60,
                            borderRadius: 8,
                            border: `1px solid ${
                              highlight ? "#27E0B0" : assigned ? "#374151" : "#333"
                            }`,
                            background: assigned
                              ? highlight
                                ? "#1f2937"
                                : "#273041"
                              : "#111826",
                            color: assigned ? "#e6f2ff" : "#64748b",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                            justifyContent: "center",
                            gap: 4,
                            padding: "8px 12px",
                            fontSize: 13,
                            cursor:
                              patternGroups.length > 0 ? "pointer" : "not-allowed",
                            textAlign: "left",
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
                                    height: 60,
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
                                      {formatTrackCount(groupOption.trackIds.length)})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (patternGroups.length === 0) return;
                                    setEditingSlot({ rowIndex, columnIndex });
                                  }}
                                  style={buttonStyles}
                                  disabled={patternGroups.length === 0}
                                >
                                  <span style={{ fontWeight: 600 }}>
                                    {group?.name ?? "Empty"}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: assigned ? "#94a3b8" : "#475569",
                                    }}
                                  >
                                    {assigned
                                      ? formatTrackCount(group?.trackIds.length ?? 0)
                                      : patternGroups.length > 0
                                      ? "Tap to assign"
                                      : "Create a Pattern Group"}
                                  </span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
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
            aria-label={isPlaying ? "Pause" : "Play"}
            onPointerDown={onPlayPause}
            onPointerUp={(e) => e.currentTarget.blur()}
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              border: "1px solid #333",
              background: "#27E0B0",
              color: "#1F2532",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            <span className="material-symbols-outlined">
              {isPlaying ? "pause" : "play_arrow"}
            </span>
          </button>
          <button
            aria-label="Stop"
            onPointerDown={onStop}
            onPointerUp={(e) => e.currentTarget.blur()}
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              border: "1px solid #333",
              background: "#E02749",
              color: "#e6f2ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              padding: 0,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ lineHeight: 1, width: "100%", height: "100%" }}
            >
              stop
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
            alignItems: "center",
            gap: 12,
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
            Pattern Groups
          </h3>
          <button
            onClick={handleCreatePatternGroup}
            disabled={playableTracks.length === 0}
            style={{
              marginLeft: "auto",
              padding: "6px 12px",
              borderRadius: 999,
              border: "1px solid #333",
              background:
                playableTracks.length === 0 ? "#1f2532" : "#27E0B0",
              color: playableTracks.length === 0 ? "#64748b" : "#1F2532",
              cursor: playableTracks.length === 0 ? "default" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Capture Pattern Group
          </button>
        </div>
        {playableTracks.length === 0 && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px dashed #475569",
              color: "#94a3b8",
              fontSize: 12,
            }}
          >
            Create patterns in Track view to capture them into reusable groups.
          </div>
        )}
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
            No Pattern Groups yet. Capture the current track patterns to start
            building song sections.
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
              const trackLabels = group.trackIds
                .map((trackId) => trackMap.get(trackId)?.name)
                .filter((name): name is string => Boolean(name));
              return (
                <div
                  key={group.id}
                  style={{
                    borderRadius: 10,
                    border: "1px solid #333",
                    background: "#121827",
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{group.name}</span>
                    <span
                      style={{
                        fontSize: 12,
                        color: "#94a3b8",
                      }}
                    >
                      {formatTrackCount(group.trackIds.length)}
                    </span>
                    <button
                      onClick={() => handleDuplicatePatternGroup(group.id)}
                      style={{
                        marginLeft: "auto",
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid #333",
                        background: "#273041",
                        color: "#e6f2ff",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Duplicate
                    </button>
                  </div>
                  {trackLabels.length === 0 ? (
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      This group has no playable tracks.
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

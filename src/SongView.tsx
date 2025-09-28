import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  Dispatch,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";
import * as Tone from "tone";

import type { PatternGroup, SongRow } from "./song";
import { createSongRow } from "./song";
import { initAudioContext } from "./utils/audio";
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
}

const SLOT_WIDTH = 150;
const SLOT_GAP = 8;
const ROW_LABEL_WIDTH = 80;

type PerformanceInstrumentType = "keyboard" | "arp" | "pads";

const INSTRUMENT_SETTINGS = {
  keyboard: {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.25 },
  },
  arp: {
    oscillator: { type: "square" },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.15 },
  },
  pads: {
    oscillator: { type: "sine" },
    envelope: { attack: 0.25, decay: 0.4, sustain: 0.8, release: 1.6 },
  },
} as const satisfies Record<PerformanceInstrumentType, Record<string, unknown>>;

const INSTRUMENT_DURATIONS: Record<PerformanceInstrumentType, string> = {
  keyboard: "4n",
  arp: "8n",
  pads: "2n",
};

const INSTRUMENT_VELOCITY: Record<PerformanceInstrumentType, number> = {
  keyboard: 0.8,
  arp: 0.7,
  pads: 0.9,
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
}: SongViewProps) {
  const [editingSlot, setEditingSlot] = useState<
    { rowIndex: number; columnIndex: number } | null
  >(null);
  const [activeRowSettings, setActiveRowSettings] = useState<number | null>(
    null
  );
  const [instrumentPanelOpen, setInstrumentPanelOpen] = useState(false);
  const [instrumentType, setInstrumentType] =
    useState<PerformanceInstrumentType>("keyboard");

  const liveInstrumentRef = useRef<Tone.PolySynth<Tone.Synth> | null>(null);
  const liveInstrumentTypeRef = useRef<PerformanceInstrumentType | null>(null);

  const patternGroupMap = useMemo(
    () => new Map(patternGroups.map((group) => [group.id, group])),
    [patternGroups]
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

  const getOrCreateInstrument = useCallback(async () => {
    await initAudioContext();
    if (
      !liveInstrumentRef.current ||
      liveInstrumentTypeRef.current !== instrumentType
    ) {
      liveInstrumentRef.current?.dispose();
      const synth = new Tone.PolySynth(Tone.Synth).toDestination();
      synth.set(INSTRUMENT_SETTINGS[instrumentType] as Tone.SynthOptions);
      synth.volume.value = instrumentType === "pads" ? -4 : -6;
      liveInstrumentRef.current = synth;
      liveInstrumentTypeRef.current = instrumentType;
    }
    return liveInstrumentRef.current;
  }, [instrumentType]);

  const triggerLiveNote = useCallback(
    async (note: string) => {
      const instrument = await getOrCreateInstrument();
      if (!instrument) return;
      const now = Tone.now();
      instrument.triggerAttackRelease(
        note,
        INSTRUMENT_DURATIONS[instrumentType],
        now,
        INSTRUMENT_VELOCITY[instrumentType]
      );
    },
    [getOrCreateInstrument, instrumentType]
  );

  const keyboardNotes = useMemo(() => {
    const octaves = instrumentType === "pads" ? [3, 4] : [4, 5];
    const toneOrder = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ];
    return octaves.flatMap((octave) =>
      toneOrder.map((note) => `${note}${octave}`)
    );
  }, [instrumentType]);

  useEffect(() => {
    if (!instrumentPanelOpen) return;
    void getOrCreateInstrument();
  }, [getOrCreateInstrument, instrumentPanelOpen]);

  useEffect(() => {
    return () => {
      liveInstrumentRef.current?.dispose();
      liveInstrumentRef.current = null;
      liveInstrumentTypeRef.current = null;
    };
  }, []);

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
                          border: `1px solid ${
                            rowSelected ? "#27E0B0" : "#333"
                          }`,
                          background: rowMuted ? "#181f2b" : "#121827",
                          color: rowMuted ? "#475569" : "#e6f2ff",
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
                              right: 4,
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
                            opacity: rowMuted ? 0.7 : 1,
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
                                      ? formatTrackCount(group?.tracks.length ?? 0)
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
          flexWrap: "wrap",
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
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
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
          <button
            type="button"
            onClick={() => {
              if (!instrumentPanelOpen) {
                void initAudioContext();
              }
              setInstrumentPanelOpen((prev) => !prev);
            }}
            aria-pressed={instrumentPanelOpen}
            style={{
              height: 44,
              padding: "0 16px",
              borderRadius: 10,
              border: `1px solid ${instrumentPanelOpen ? "#27E0B0" : "#333"}`,
              background: instrumentPanelOpen
                ? "rgba(39, 224, 176, 0.14)"
                : "#1b2130",
              color: "#e6f2ff",
              fontSize: 13,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              letterSpacing: 0.3,
            }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              piano
            </span>
            Play Instrument
          </button>
        </div>
      </div>

      {instrumentPanelOpen ? (
        <div
          style={{
            borderRadius: 12,
            border: "1px solid #333",
            background: "#10192c",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
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
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {(
                [
                  { id: "keyboard", label: "Keyboard", icon: "🎹" },
                  { id: "arp", label: "Arp", icon: "🌀" },
                  { id: "pads", label: "Pads", icon: "🎛️" },
                ] as const
              ).map(({ id, label, icon }) => {
                const active = instrumentType === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInstrumentType(id)}
                    aria-pressed={active}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: `1px solid ${active ? "#27E0B0" : "#333"}`,
                      background: active ? "rgba(39, 224, 176, 0.18)" : "#1b2130",
                      color: "#e6f2ff",
                      fontSize: 12,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      letterSpacing: 0.3,
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 14 }}>
                      {icon}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setInstrumentPanelOpen(false)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "#1b2536",
                color: "#94a3b8",
                fontSize: 12,
              }}
            >
              Close
            </button>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Tap notes to play along with the song timeline.
            </span>
            <div
              className="scrollable"
              style={{
                overflowX: "auto",
                paddingBottom: 4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  minWidth: keyboardNotes.length * 44,
                }}
              >
                {keyboardNotes.map((note) => {
                  const sharp = note.includes("#");
                  return (
                    <button
                      key={note}
                      type="button"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        void triggerLiveNote(note);
                      }}
                      onPointerUp={(event) => {
                        event.currentTarget.blur();
                      }}
                      style={{
                        width: 44,
                        height: sharp ? 56 : 72,
                        borderRadius: 8,
                        border: `1px solid ${sharp ? "#273041" : "#94a3b8"}`,
                        background: sharp ? "#1f2532" : "#e2e8f0",
                        color: sharp ? "#e6f2ff" : "#0f172a",
                        fontSize: 11,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        paddingBottom: 6,
                        letterSpacing: 0.4,
                      }}
                    >
                      {note}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

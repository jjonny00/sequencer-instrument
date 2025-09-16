import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import * as Tone from "tone";
import type { Track, TriggerMap } from "./tracks";
import type { Chunk } from "./chunks";
import { packs } from "./packs";
import { StepModal } from "./StepModal";
import type { PatternGroup } from "./song";
import { createPatternGroupId } from "./song";

const baseInstrumentColors: Record<string, string> = {
  kick: "#e74c3c",
  snare: "#3498db",
  hat: "#f1c40f",
  bass: "#1abc9c",
  cowbell: "#ff9f1c",
  chord: "#2ecc71",
  arpeggiator: "#9b59b6",
};

const FALLBACK_INSTRUMENT_COLOR = "#27E0B0";

const getInstrumentColor = (instrument: string) =>
  baseInstrumentColors[instrument] ?? FALLBACK_INSTRUMENT_COLOR;

const formatInstrumentLabel = (value: string) =>
  value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getTrackNumberLabel = (tracks: Track[], trackId: number) => {
  const index = tracks.findIndex((track) => track.id === trackId);
  const number = index >= 0 ? index + 1 : trackId;
  return number.toString().padStart(2, "0");
};

const formatPitchDisplay = (value: number) =>
  value > 0 ? `+${value}` : value.toString();

const LABEL_WIDTH = 60;
const ROW_HEIGHT = 40;

type GroupEditorState =
  | {
      mode: "create";
      name: string;
      trackIds: number[];
    }
  | {
      mode: "edit";
      groupId: string;
      name: string;
      trackIds: number[];
    };

/**
 * Top strip visualizing a 16-step loop.
 * - Displays each track's 16-step pattern.
 * - Highlights the current step in sync with Tone.Transport.
 * - Allows editing a track's pattern inline.
 */
export function LoopStrip({
  started,
  isPlaying,
  tracks,
  editing,
  setEditing,
  setTracks,
  packIndex,
  setPackIndex,
  patternGroups,
  setPatternGroups,
}: {
  started: boolean;
  isPlaying: boolean;
  tracks: Track[];
  editing: number | null;
  setEditing: Dispatch<SetStateAction<number | null>>;
  setTracks: Dispatch<SetStateAction<Track[]>>;
  packIndex: number;
  setPackIndex: Dispatch<SetStateAction<number>>;
  patternGroups: PatternGroup[];
  setPatternGroups: Dispatch<SetStateAction<PatternGroup[]>>;
}) {
  const [step, setStep] = useState(-1);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupEditor, setGroupEditor] = useState<GroupEditorState | null>(null);
  const [stepEditing, setStepEditing] = useState<
    { trackId: number; index: number } | null
  >(null);
  const [detailTrackId, setDetailTrackId] = useState<number | null>(null);
  const swipeRef = useRef(0);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const pack = packs[packIndex];
  const instrumentOptions = Object.keys(pack.instruments);
  const canAddTrack = instrumentOptions.length > 0;
  const addTrackEnabled = canAddTrack && detailTrackId === null;
  const selectedGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    return patternGroups.find((group) => group.id === selectedGroupId) ?? null;
  }, [patternGroups, selectedGroupId]);

  const getNextGroupName = (groups: PatternGroup[] = patternGroups) => {
    const existingNames = new Set(
      groups.map((group) => group.name.toLowerCase())
    );
    let index = 1;
    while (true) {
      const candidate = `group${String(index).padStart(2, "0")}`;
      if (!existingNames.has(candidate.toLowerCase())) {
        return candidate;
      }
      index += 1;
    }
  };

  const selectedTracks = useMemo(() => {
    if (!selectedGroup) return [] as Track[];
    const selectedIds = new Set(selectedGroup.trackIds);
    return tracks.filter((track) => selectedIds.has(track.id));
  }, [selectedGroup, tracks]);

  const isCreatingGroup = groupEditor?.mode === "create";
  const isEditingCurrentGroup =
    groupEditor?.mode === "edit" && groupEditor.groupId === selectedGroupId;

  useEffect(() => {
    if (patternGroups.length === 0) {
      setSelectedGroupId(null);
      setGroupEditor(null);
      return;
    }
    setSelectedGroupId((prev) => {
      if (prev && patternGroups.some((group) => group.id === prev)) {
        return prev;
      }
      return patternGroups[0]?.id ?? null;
    });
  }, [patternGroups]);

  useEffect(() => {
    setGroupEditor(null);
  }, [packIndex]);

  useEffect(() => {
    if (!groupEditor) return;
    if (groupEditor.mode === "edit") {
      const exists = patternGroups.some(
        (group) => group.id === groupEditor.groupId
      );
      if (!exists) {
        setGroupEditor(null);
      }
    }
  }, [groupEditor, patternGroups]);

  useEffect(() => {
    setGroupEditor((state) => {
      if (!state) return state;
      const validTrackIds = new Set(tracks.map((track) => track.id));
      const filtered = state.trackIds.filter((id) => validTrackIds.has(id));
      if (filtered.length === state.trackIds.length) return state;
      return { ...state, trackIds: filtered };
    });
  }, [tracks]);

  useEffect(() => {
    if (detailTrackId === null) return;
    if (!tracks.some((track) => track.id === detailTrackId)) {
      setDetailTrackId(null);
    }
  }, [detailTrackId, tracks]);

  // Schedule a step advance on each 16th note when audio has started.
  useEffect(() => {
    if (!started) return;
    let current = 0;
    const id = Tone.Transport.scheduleRepeat((time) => {
      Tone.Draw.schedule(() => {
        setStep(current);
        current = (current + 1) % 16;
      }, time);
    }, "16n");
    return () => {
      Tone.Transport.clear(id);
    };
  }, [started]);

  // Reset playhead when transport stops or is paused.
  useEffect(() => {
    if (!isPlaying) setStep(-1);
  }, [isPlaying]);

  const addPattern = (trackId: number) => {
    let created = false;
    setTracks((ts) =>
      ts.map((t) => {
        if (t.id !== trackId) return t;
        if (!t.instrument) return t;
        const label = getTrackNumberLabel(ts, trackId);
        created = true;
        return {
          ...t,
          pattern: {
            id: `track-${trackId}-${Date.now()}`,
            name: `Track ${label} Pattern`,
            instrument: t.instrument,
            steps: Array(16).fill(0),
            velocities: Array(16).fill(1),
            pitches: Array(16).fill(0),
          },
        };
      })
    );
    if (created) {
      setEditing(trackId);
    }
  };

  const handleAddTrack = () => {
    if (!addTrackEnabled) return;
    let createdId: number | null = null;
    setTracks((ts) => {
      const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
      const label = (ts.length + 1).toString().padStart(2, "0");
      createdId = nextId;
      return [
        ...ts,
        {
          id: nextId,
          name: label,
          instrument: "",
          pattern: null,
          muted: false,
        },
      ];
    });
    if (createdId !== null) {
      setEditing(createdId);
      setDetailTrackId(createdId);
    }
  };

  const handleToggleMute = (trackId: number) => {
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId
          ? {
              ...t,
              muted: !t.muted,
            }
          : t
      )
    );
  };

  const showTrackDetails = (trackId: number) => {
    setDetailTrackId(trackId);
    setEditing(trackId);
  };

  const handleInstrumentChange = (trackId: number, value: string) => {
    setTracks((ts) =>
      ts.map((t) => {
        if (t.id !== trackId) return t;
        if (!value) {
          return {
            ...t,
            instrument: "",
          };
        }
        const instrument = value as keyof TriggerMap;
        const pattern = t.pattern
          ? { ...t.pattern, instrument }
          : t.pattern;
        return {
          ...t,
          instrument,
          pattern,
        };
      })
    );
  };

  const handlePresetLoad = (trackId: number, chunkId: string) => {
    if (!chunkId) return;
    const chunk = pack.chunks.find((c) => c.id === chunkId);
    if (!chunk) return;
    loadChunk(chunk, trackId);
  };

  const hideTrackDetails = () => setDetailTrackId(null);

  const openCreateGroup = () => {
    setGroupEditor({ mode: "create", name: getNextGroupName(), trackIds: [] });
  };

  const openEditGroup = () => {
    if (!selectedGroup) return;
    setGroupEditor({
      mode: "edit",
      groupId: selectedGroup.id,
      name: selectedGroup.name,
      trackIds: selectedGroup.trackIds,
    });
  };

  const handleEditorNameChange = (value: string) => {
    setGroupEditor((state) => (state ? { ...state, name: value } : state));
  };

  const handleEditorTrackToggle = (trackId: number) => {
    setGroupEditor((state) => {
      if (!state) return state;
      const next = new Set(state.trackIds);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      const ordered = tracks
        .filter((track) => next.has(track.id))
        .map((track) => track.id);
      return { ...state, trackIds: ordered };
    });
  };

  const handleSaveGroup = () => {
    if (!groupEditor) return;
    if (groupEditor.mode === "edit") {
      setPatternGroups((groups) =>
        groups.map((group) => {
          if (group.id !== groupEditor.groupId) return group;
          const trimmed = groupEditor.name.trim();
          return {
            ...group,
            name: trimmed || group.name,
            trackIds: groupEditor.trackIds,
          };
        })
      );
      setGroupEditor(null);
      return;
    }
    const newId = createPatternGroupId();
    const trimmed = groupEditor.name.trim();
    setPatternGroups((groups) => {
      const name = trimmed || getNextGroupName(groups);
      return [
        ...groups,
        {
          id: newId,
          name,
          trackIds: groupEditor.trackIds,
        },
      ];
    });
    setSelectedGroupId(newId);
    setGroupEditor(null);
  };

  const handleDuplicateGroup = () => {
    if (!selectedGroupId) return;
    const newId = createPatternGroupId();
    setPatternGroups((groups) => {
      const source = groups.find((group) => group.id === selectedGroupId);
      if (!source) return groups;
      const existingNames = new Set(
        groups.map((group) => group.name.toLowerCase())
      );
      let candidate = `${source.name} copy`;
      let suffix = 2;
      while (existingNames.has(candidate.toLowerCase())) {
        candidate = `${source.name} copy ${suffix}`;
        suffix += 1;
      }
      return [
        ...groups,
        { id: newId, name: candidate, trackIds: [...source.trackIds] },
      ];
    });
    setSelectedGroupId(newId);
    setGroupEditor(null);
  };

  const handleDeleteGroup = () => {
    if (!selectedGroupId) return;
    if (patternGroups.length <= 1) return;
    let fallbackId: string | null = null;
    setPatternGroups((groups) => {
      const filtered = groups.filter((group) => group.id !== selectedGroupId);
      if (filtered.length === 0) {
        const fallbackGroup: PatternGroup = {
          id: createPatternGroupId(),
          name: getNextGroupName([]),
          trackIds: [],
        };
        fallbackId = fallbackGroup.id;
        return [fallbackGroup];
      }
      return filtered;
    });
    if (fallbackId) {
      setSelectedGroupId(fallbackId);
    }
    setGroupEditor(null);
  };

  const handleCancelGroupEdit = () => {
    setGroupEditor(null);
  };

  const renderTrackChooser = (
    selectedIds: number[],
    onToggle: (trackId: number) => void,
    disabled = false
  ) => {
    if (tracks.length === 0) {
      return (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: "#94a3b8",
          }}
        >
          Add a track to start building scenes.
        </div>
      );
    }

    return (
      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {tracks.map((track, index) => {
          const checked = selectedIds.includes(track.id);
          const label = (index + 1).toString().padStart(2, "0");
          return (
            <label
              key={track.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${checked ? "#27E0B0" : "#333"}`,
                background: checked ? "rgba(39, 224, 176, 0.08)" : "#1f2532",
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.6 : 1,
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (disabled) return;
                  onToggle(track.id);
                }}
                disabled={disabled}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    );
  };

  const updatePattern = (trackId: number, steps: number[]) => {
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId && t.pattern
          ? { ...t, pattern: { ...t.pattern, steps } }
          : t
      )
    );
  };

  const updateStep = (
    trackId: number,
    index: number,
    props: { velocity?: number; pitch?: number }
  ) => {
    setTracks((ts) =>
      ts.map((t) => {
        if (t.id === trackId && t.pattern) {
          const velocities = t.pattern.velocities
            ? t.pattern.velocities.slice()
            : Array(16).fill(1);
          const pitches = t.pattern.pitches
            ? t.pattern.pitches.slice()
            : Array(16).fill(0);
          if (props.velocity !== undefined) velocities[index] = props.velocity;
          if (props.pitch !== undefined) pitches[index] = props.pitch;
          return {
            ...t,
            pattern: { ...t.pattern, velocities, pitches },
          };
        }
        return t;
      })
    );
  };

  const updatePatternControls = (
    trackId: number,
    props: { velocity?: number; pitch?: number }
  ) => {
    setTracks((ts) =>
      ts.map((t) => {
        if (t.id === trackId && t.pattern) {
          const velocities = t.pattern.velocities
            ? t.pattern.velocities.slice()
            : Array(16).fill(1);
          const pitches = t.pattern.pitches
            ? t.pattern.pitches.slice()
            : Array(16).fill(0);
          if (props.velocity !== undefined)
            velocities.fill(props.velocity);
          if (props.pitch !== undefined) pitches.fill(props.pitch);
          return {
            ...t,
            pattern: { ...t.pattern, velocities, pitches },
          };
        }
        return t;
      })
    );
  };


  const loadChunk = (chunk: Chunk, targetTrackId: number) => {
    setTracks((ts) => {
      const exists = ts.some((t) => t.id === targetTrackId);
      if (!exists) return ts;
      return ts.map((t) =>
        t.id === targetTrackId
          ? {
              ...t,
              name: chunk.name,
              instrument: chunk.instrument as keyof TriggerMap,
              pattern: { ...chunk },
            }
          : t
      );
    });
    setEditing(targetTrackId);
    setDetailTrackId(targetTrackId);
  };

  return (
    <div
      style={{
        height: "32vh",
        width: "100%",
        background: "#2a2f3a",
        display: "flex",
        flexDirection: "column",
        padding: "8px",
        boxSizing: "border-box",
        gap: 4,
        overflow: "hidden",
      }}
    >
      <div style={{ marginBottom: 4 }}>
        <select
          value={packIndex}
          onChange={(event) => setPackIndex(Number(event.target.value))}
          style={{
            width: "100%",
            padding: 4,
            borderRadius: 4,
            background: "#121827",
            color: "white",
            border: "1px solid #333",
          }}
        >
          {packs.map((p, i) => (
            <option key={p.id} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          <button
            type="button"
            onClick={openCreateGroup}
            aria-label="Create scene"
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "1px solid #333",
              background: isCreatingGroup ? "#27E0B0" : "#1f2532",
              color: isCreatingGroup ? "#1F2532" : "#e6f2ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20 }}
            >
              add
            </span>
          </button>
          <select
            aria-label="Current scene"
            value={selectedGroupId ?? patternGroups[0]?.id ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedGroupId(value || null);
              setGroupEditor(null);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: 6,
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1f2532",
              color: "#e6f2ff",
            }}
          >
            {patternGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
          }}
        >
          <button
            type="button"
            onClick={openEditGroup}
            disabled={!selectedGroup}
            aria-label="Edit scene"
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "1px solid #333",
              background: isEditingCurrentGroup ? "#27E0B0" : "#1f2532",
              color: selectedGroup
                ? isEditingCurrentGroup
                  ? "#1F2532"
                  : "#e6f2ff"
                : "#64748b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: selectedGroup ? "pointer" : "default",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              edit
            </span>
          </button>
          <button
            type="button"
            onClick={handleDuplicateGroup}
            disabled={!selectedGroup}
            aria-label="Duplicate scene"
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1f2532",
              color: selectedGroup ? "#e6f2ff" : "#64748b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: selectedGroup ? "pointer" : "default",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              content_copy
            </span>
          </button>
          <button
            type="button"
            onClick={handleDeleteGroup}
            disabled={!selectedGroup || patternGroups.length <= 1}
            aria-label="Delete scene"
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1f2532",
              color:
                selectedGroup && patternGroups.length > 1
                  ? "#e6f2ff"
                  : "#64748b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor:
                selectedGroup && patternGroups.length > 1
                  ? "pointer"
                  : "default",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              delete
            </span>
          </button>
        </div>
      </div>
      <div
        ref={trackAreaRef}
        className="scrollable"
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {tracks.length === 0 && (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              fontSize: 12,
              color: "#94a3b8",
            }}
          >
            Tap “Add Track” to start building your loop.
          </div>
        )}
        {tracks.map((t) => {
          let labelTimer: number | null = null;
          let longPressTriggered = false;
          const color = getInstrumentColor(t.instrument);
          const isMuted = t.muted;
          const isEditing = editing === t.id;
          const trackLabel = getTrackNumberLabel(tracks, t.id);
          const velocityValue = t.pattern?.velocities?.[0] ?? 1;
          const pitchValue = t.pattern?.pitches?.[0] ?? 0;

          const handleLabelPointerDown = (
            event: ReactPointerEvent<HTMLDivElement>
          ) => {
            event.stopPropagation();
            longPressTriggered = false;
            if (labelTimer) window.clearTimeout(labelTimer);
            labelTimer = window.setTimeout(() => {
              longPressTriggered = true;
              showTrackDetails(t.id);
            }, 500);
          };

          const handleLabelPointerUp = (
            event: ReactPointerEvent<HTMLDivElement>
          ) => {
            event.stopPropagation();
            if (labelTimer) window.clearTimeout(labelTimer);
            labelTimer = null;
            if (longPressTriggered) return;
            handleToggleMute(t.id);
          };

          const handleLabelPointerLeave = () => {
            if (labelTimer) window.clearTimeout(labelTimer);
            labelTimer = null;
          };

          return (
            <div
              key={t.id}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div
                onPointerDown={(event) => {
                  swipeRef.current = event.clientX;
                }}
                onPointerUp={(event) => {
                  const dx = event.clientX - swipeRef.current;
                  if (isEditing && dx > 50) {
                    setEditing(null);
                  } else if (!isEditing && Math.abs(dx) < 10) {
                    setEditing(t.id);
                  }
                }}
                style={{
                  display: "flex",
                  height: ROW_HEIGHT,
                  minHeight: ROW_HEIGHT,
                  flex: "none",
                  boxSizing: "border-box",
                  borderRadius: 6,
                  overflow: "hidden",
                  border: isEditing ? "2px solid #27E0B0" : "1px solid #555",
                  background: "#111827",
                  opacity: editing !== null && !isEditing ? 0.4 : 1,
                  pointerEvents:
                    editing !== null && !isEditing ? "none" : "auto",
                  transition: "opacity 0.2s ease, border 0.2s ease",
                }}
              >
                <div
                  onPointerDown={handleLabelPointerDown}
                  onPointerUp={handleLabelPointerUp}
                  onPointerLeave={handleLabelPointerLeave}
                  style={{
                    width: LABEL_WIDTH,
                    borderRight: "1px solid #333",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    userSelect: "none",
                    background: isMuted ? "#1b2332" : color,
                    color: isMuted ? "#94a3b8" : "#0f1420",
                    cursor: "pointer",
                    transition: "background 0.2s ease, color 0.2s ease",
                  }}
                  title={isMuted ? "Unmute track" : "Mute track"}
                >
                  {trackLabel}
                </div>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 8px",
                    background: "#161d2b",
                    position: "relative",
                    overflow: "hidden",
                    opacity: isMuted ? 0.3 : 1,
                    filter: isMuted ? "grayscale(0.7)" : "none",
                    transition: "opacity 0.2s ease, filter 0.2s ease",
                  }}
                >
                  {t.pattern ? (
                    isEditing ? (
                      <PatternEditor
                        steps={t.pattern.steps}
                        onToggle={(i) => {
                          const next = t.pattern!.steps.slice();
                          next[i] = next[i] ? 0 : 1;
                          updatePattern(t.id, next);
                        }}
                        onStepLongPress={(i) =>
                          setStepEditing({ trackId: t.id, index: i })
                        }
                        color={color}
                        currentStep={step}
                      />
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(16, 1fr)",
                          gap: 2,
                          width: "100%",
                          height: "100%",
                        }}
                      >
                        {Array.from({ length: 16 }).map((_, i) => {
                          const active = t.pattern?.steps[i] ?? 0;
                          const playing = step === i && active;
                          return (
                            <div
                              key={i}
                              style={{
                                border: "1px solid #555",
                                background: active ? color : "#1f2532",
                                opacity: active ? 1 : 0.2,
                                boxShadow: playing
                                  ? `0 0 6px ${color}`
                                  : "none",
                              }}
                            />
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <button
                      onClick={() => addPattern(t.id)}
                      disabled={!t.instrument}
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: 6,
                        border: t.instrument
                          ? "1px dashed #3b4252"
                          : "1px dashed #242c3c",
                        background: t.instrument ? "#1d2432" : "#161b27",
                        color: t.instrument ? "#e6f2ff" : "#475569",
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        fontWeight: 600,
                        cursor: t.instrument ? "pointer" : "not-allowed",
                      }}
                    >
                      New Pattern
                    </button>
                  )}
                  {detailTrackId === t.id && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        zIndex: 1,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        padding: "8px 12px",
                        gap: 12,
                        background: "rgba(17, 24, 39, 0.95)",
                        border: "1px solid #2a3344",
                        borderRadius: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          width: "100%",
                          flexWrap: "nowrap",
                          alignItems: "center",
                        }}
                      >
                        <select
                          value={t.instrument}
                          onChange={(event) =>
                            handleInstrumentChange(t.id, event.target.value)
                          }
                          aria-label="Select instrument"
                          style={{
                            flex: "1 1 0%",
                            minWidth: 0,
                            padding: 6,
                            borderRadius: 6,
                            border: "1px solid #333",
                            background: "#1f2532",
                            color: t.instrument ? "#e6f2ff" : "#64748b",
                          }}
                        >
                          <option value="" disabled>
                            Select instrument
                          </option>
                          {instrumentOptions.map((instrument) => (
                            <option key={instrument} value={instrument}>
                              {formatInstrumentLabel(instrument)}
                            </option>
                          ))}
                        </select>
                        <select
                          value=""
                          onChange={(event) =>
                            handlePresetLoad(t.id, event.target.value)
                          }
                          aria-label="Preset (optional)"
                          disabled={!t.instrument}
                          style={{
                            flex: "1 1 0%",
                            minWidth: 0,
                            padding: 6,
                            borderRadius: 6,
                            border: "1px solid #333",
                            background: "#1f2532",
                            color: t.instrument ? "#e6f2ff" : "#475569",
                            opacity: t.instrument ? 1 : 0.5,
                          }}
                        >
                          <option value="">Preset (optional)</option>
                          {pack.chunks
                            .filter((chunk) => chunk.instrument === t.instrument)
                            .map((chunk) => (
                              <option key={chunk.id} value={chunk.id}>
                                {chunk.name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={hideTrackDetails}
                          disabled={!t.instrument}
                          aria-label="Done editing track"
                          style={{
                            width: 40,
                            height: 36,
                            borderRadius: 6,
                            border: "1px solid #333",
                            background: t.instrument ? "#27E0B0" : "#1f2532",
                            color: t.instrument ? "#0f1420" : "#475569",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: t.instrument ? "pointer" : "not-allowed",
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
                    </div>
                  )}
                </div>
              </div>
              {detailTrackId === t.id && (
                <div
                  style={{
                    marginLeft: LABEL_WIDTH,
                    marginTop: 6,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      padding: 12,
                      background: "rgba(15, 21, 34, 0.95)",
                      borderRadius: 8,
                      border: "1px solid #333",
                      boxShadow: "0 8px 18px rgba(8, 12, 20, 0.6)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <label
                        style={{
                          flex: "1 1 260px",
                          minWidth: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 12,
                          color: t.pattern ? "#94a3b8" : "#475569",
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
                          value={velocityValue}
                          onChange={(event) =>
                            updatePatternControls(t.id, {
                              velocity: Number(event.target.value),
                            })
                          }
                          style={{
                            flex: 1,
                            opacity: t.pattern ? 1 : 0.4,
                            cursor: t.pattern ? "pointer" : "not-allowed",
                          }}
                          aria-label="Velocity"
                          title="Velocity"
                          disabled={!t.pattern}
                        />
                        <span
                          style={{
                            width: 48,
                            textAlign: "right",
                            color: t.pattern ? "#94a3b8" : "#475569",
                          }}
                        >
                          {velocityValue.toFixed(2)}
                        </span>
                      </label>
                      <label
                        style={{
                          flex: "1 1 260px",
                          minWidth: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 12,
                          color: t.pattern ? "#94a3b8" : "#475569",
                        }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 18 }}
                          aria-hidden="true"
                        >
                          music_note
                        </span>
                        <input
                          type="range"
                          min={-12}
                          max={12}
                          step={1}
                          value={pitchValue}
                          onChange={(event) =>
                            updatePatternControls(t.id, {
                              pitch: Number(event.target.value),
                            })
                          }
                          style={{
                            flex: 1,
                            opacity: t.pattern ? 1 : 0.4,
                            cursor: t.pattern ? "pointer" : "not-allowed",
                          }}
                          aria-label="Pitch"
                          title="Pitch"
                          disabled={!t.pattern}
                        />
                        <span
                          style={{
                            width: 48,
                            textAlign: "right",
                            color: t.pattern ? "#94a3b8" : "#475569",
                          }}
                        >
                          {formatPitchDisplay(pitchValue)}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div>
          <button
            type="button"
            onClick={handleAddTrack}
            disabled={!addTrackEnabled}
            style={{
              width: "100%",
              height: ROW_HEIGHT,
              borderRadius: 6,
              border: addTrackEnabled
                ? "1px dashed #3b4252"
                : "1px dashed #242c3c",
              background: addTrackEnabled ? "#141924" : "#161b27",
              color: addTrackEnabled ? "#e6f2ff" : "#475569",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontWeight: 600,
              cursor: addTrackEnabled ? "pointer" : "not-allowed",
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18 }}
            >
              add
            </span>
            Add Track
          </button>
        </div>
      </div>
      {groupEditor ? (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <input
            value={groupEditor.name}
            onChange={(event) => handleEditorNameChange(event.target.value)}
            placeholder={getNextGroupName()}
            style={{
              padding: 6,
              borderRadius: 6,
              border: "1px solid #333",
              background: "#1f2532",
              color: "#e6f2ff",
            }}
          />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            Select tracks to include in this scene.
          </span>
          {renderTrackChooser(groupEditor.trackIds, handleEditorTrackToggle)}
          {groupEditor.trackIds.length === 0 && tracks.length > 0 && (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              This scene is empty. Add tracks to hear it in Song view.
            </span>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleSaveGroup}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #333",
                background: "#27E0B0",
                color: "#1F2532",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Save Scene
            </button>
            <button
              type="button"
              onClick={handleCancelGroupEdit}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #333",
                background: "#1f2532",
                color: "#e6f2ff",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : selectedGroup ? (
        selectedTracks.length ? (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {selectedTracks.map((track) => {
              const label = getTrackNumberLabel(tracks, track.id);
              return (
                <span
                  key={track.id}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 9999,
                    background: "rgba(39, 224, 176, 0.1)",
                    border: "1px solid #27E0B0",
                    fontSize: 12,
                  }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        ) : null
      ) : (
        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "#94a3b8",
          }}
        >
          Create a scene to capture the current track mix.
        </div>
      )}
      {stepEditing && (() => {
        const track = tracks.find((tr) => tr.id === stepEditing.trackId);
        if (!track || !track.pattern) return null;
        const velocity =
          track.pattern.velocities?.[stepEditing.index] ?? 1;
        const pitch = track.pattern.pitches?.[stepEditing.index] ?? 0;
        return (
          <StepModal
            velocity={velocity}
            pitch={pitch}
            onChange={(p) => updateStep(track.id, stepEditing.index, p)}
            onClose={() => setStepEditing(null)}
          />
        );
      })()}
    </div>
  );
}

function PatternEditor({
  steps,
  onToggle,
  onStepLongPress,
  color,
  currentStep,
}: {
  steps: number[];
  onToggle: (index: number) => void;
  onStepLongPress: (index: number) => void;
  color: string;
  currentStep: number;
}) {
  const longPressRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(16, 1fr)",
        gap: 2,
        height: "100%",
      }}
    >
      {steps.map((v, i) => {
        const playing = currentStep === i && v;
        return (
          <div
            key={i}
            onPointerDown={() => {
              timerRef.current = window.setTimeout(() => {
                longPressRef.current = true;
                onStepLongPress(i);
              }, 500);
            }}
            onPointerUp={() => {
              if (timerRef.current) window.clearTimeout(timerRef.current);
              if (longPressRef.current) {
                longPressRef.current = false;
                return;
              }
              onToggle(i);
            }}
            onPointerLeave={() => {
              if (timerRef.current) window.clearTimeout(timerRef.current);
            }}
            style={{
              border: "1px solid #555",
              background: v ? color : "#1f2532",
              cursor: "pointer",
              boxShadow: playing ? `0 0 6px ${color}` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

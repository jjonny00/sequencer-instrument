import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
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

const getTrackNumberLabel = (tracks: Track[], trackId: number) => {
  const index = tracks.findIndex((track) => track.id === trackId);
  const number = index >= 0 ? index + 1 : trackId;
  return number.toString().padStart(2, "0");
};

const LABEL_WIDTH = 60;
const ROW_HEIGHT = 40;

const cloneChunk = (chunk: Chunk): Chunk => ({
  ...chunk,
  steps: chunk.steps.slice(),
  velocities: chunk.velocities ? chunk.velocities.slice() : undefined,
  pitches: chunk.pitches ? chunk.pitches.slice() : undefined,
  notes: chunk.notes ? chunk.notes.slice() : undefined,
  degrees: chunk.degrees ? chunk.degrees.slice() : undefined,
});

const cloneTrack = (track: Track): Track => ({
  ...track,
  pattern: track.pattern ? cloneChunk(track.pattern) : null,
  source: track.source ? { ...track.source } : undefined,
});

export interface AddTrackRequest {
  packId: string;
  instrumentId: string;
  characterId: string;
  presetId?: string | null;
}

type GroupEditorState =
  | {
      mode: "create";
      name: string;
    }
  | {
      mode: "edit";
      groupId: string;
      name: string;
    };

export interface LoopStripHandle {
  openSequenceLibrary: () => void;
  addTrack: () => void;
  addTrackWithOptions: (options: AddTrackRequest) => void;
  updateTrackWithOptions: (trackId: number, options: AddTrackRequest) => void;
  removeTrack: (trackId: number) => void;
}

interface LoopStripProps {
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
  selectedGroupId: string | null;
  setSelectedGroupId: Dispatch<SetStateAction<string | null>>;
  onAddTrack: () => void;
  onRequestTrackModal: (track: Track) => void;
}

/**
 * Top strip visualizing a 16-step loop.
 * - Displays each track's 16-step pattern.
 * - Highlights the current step in sync with Tone.Transport.
 * - Allows editing a track's pattern inline.
 */
export const LoopStrip = forwardRef<LoopStripHandle, LoopStripProps>(
  function LoopStrip(
    {
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
      selectedGroupId,
      setSelectedGroupId,
      onAddTrack,
      onRequestTrackModal,
    },
    ref
  ) {
  const [step, setStep] = useState(-1);
  const [groupEditor, setGroupEditor] = useState<GroupEditorState | null>(null);
  const [stepEditing, setStepEditing] = useState<
    { trackId: number; index: number } | null
  >(null);
  const [isSequenceLibraryOpen, setIsSequenceLibraryOpen] = useState(false);
  const swipeRef = useRef(0);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const pack = packs[packIndex];
  const instrumentOptions = Object.keys(pack.instruments);
  const canAddTrack = instrumentOptions.length > 0;
  const addTrackEnabled = canAddTrack;
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
      const candidate = `sequence${String(index).padStart(2, "0")}`;
      if (!existingNames.has(candidate.toLowerCase())) {
        return candidate;
      }
      index += 1;
    }
  };

  const captureCurrentTracks = () => tracks.map((track) => cloneTrack(track));

  const applyGroupTracks = useCallback(
    (group: PatternGroup | null) => {
      const cloned = group ? group.tracks.map((track) => cloneTrack(track)) : [];
      setTracks(cloned);
      setEditing(null);
      setStepEditing(null);
    },
    [setTracks, setEditing, setStepEditing]
  );

  const isCreatingGroup = groupEditor?.mode === "create";
  const isEditingCurrentGroup =
    groupEditor?.mode === "edit" && groupEditor.groupId === selectedGroupId;

  useEffect(() => {
    if (patternGroups.length === 0) {
      if (selectedGroupId !== null) {
        setSelectedGroupId(null);
      }
      setGroupEditor(null);
      setIsSequenceLibraryOpen(false);
      return;
    }
    const exists = selectedGroupId
      ? patternGroups.some((group) => group.id === selectedGroupId)
      : false;
    if (exists) return;
    const fallbackGroup = patternGroups[0] ?? null;
    setSelectedGroupId(fallbackGroup?.id ?? null);
  }, [patternGroups, selectedGroupId, setSelectedGroupId]);

  useEffect(() => {
    const group = selectedGroupId
      ? patternGroups.find((g) => g.id === selectedGroupId) ?? null
      : null;
    applyGroupTracks(group ?? null);
  }, [selectedGroupId, patternGroups, applyGroupTracks]);

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

  const handleAddTrack = useCallback(() => {
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
    }
  }, [
    addTrackEnabled,
    setTracks,
    setEditing,
  ]);

  const handleAddTrackWithOptions = useCallback(
    ({ packId, instrumentId, characterId, presetId }: AddTrackRequest) => {
      if (!addTrackEnabled) return;
      if (!instrumentId) return;
      const activePack = pack.id === packId ? pack : packs.find((p) => p.id === packId);
      if (!activePack || activePack.id !== pack.id) {
        return;
      }
      let createdId: number | null = null;
      setTracks((ts) => {
        const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
        const label = (ts.length + 1).toString().padStart(2, "0");
        const preset = presetId
          ? activePack.chunks.find((chunk) => chunk.id === presetId)
          : null;
        const pattern: Chunk = preset
          ? {
              ...cloneChunk(preset),
              id: `${preset.id}-${Date.now()}`,
              instrument: instrumentId,
              name: preset.name,
            }
          : {
              id: `track-${nextId}-${Date.now()}`,
              name: `Track ${label} Pattern`,
              instrument: instrumentId,
              steps: Array(16).fill(0),
              velocities: Array(16).fill(1),
              pitches: Array(16).fill(0),
            };
        createdId = nextId;
        return [
          ...ts,
          {
            id: nextId,
            name: label,
            instrument: instrumentId as keyof TriggerMap,
            pattern,
            muted: false,
            source: {
              packId,
              instrumentId,
              characterId,
              presetId: presetId ?? null,
            },
          },
        ];
      });
      if (createdId !== null) {
        setEditing(createdId);
      }
    },
    [
      addTrackEnabled,
      pack,
      setTracks,
      setEditing,
    ]
  );

  const handleUpdateTrackWithOptions = useCallback(
    (
      trackId: number,
      { packId, instrumentId, characterId, presetId }: AddTrackRequest
    ) => {
      if (!instrumentId) return;
      const activePack = pack.id === packId ? pack : packs.find((p) => p.id === packId);
      if (!activePack || activePack.id !== pack.id) {
        return;
      }
      setTracks((ts) =>
        ts.map((t) => {
          if (t.id !== trackId) return t;
          const preset = presetId
            ? activePack.chunks.find((chunk) => chunk.id === presetId)
            : null;
          const nextPattern: Chunk | null = preset
            ? {
                ...cloneChunk(preset),
                id: `${preset.id}-${Date.now()}`,
                instrument: instrumentId,
                name: preset.name,
              }
            : t.pattern
            ? { ...t.pattern, instrument: instrumentId }
            : {
                id: `track-${trackId}-${Date.now()}`,
                name: t.name,
                instrument: instrumentId,
                steps: Array(16).fill(0),
                velocities: Array(16).fill(1),
                pitches: Array(16).fill(0),
              };
          const nextName = preset ? preset.name : t.name;
          return {
            ...t,
            name: nextName,
            instrument: instrumentId as keyof TriggerMap,
            pattern: nextPattern,
            source: {
              packId,
              instrumentId,
              characterId,
              presetId: presetId ?? null,
            },
          };
        })
      );
      setEditing(trackId);
    },
    [pack, setTracks, setEditing]
  );

  const removeTrack = useCallback(
    (trackId: number) => {
      setTracks((ts) => ts.filter((t) => t.id !== trackId));
      setEditing((current) => (current === trackId ? null : current));
      setStepEditing((current) =>
        current && current.trackId === trackId ? null : current
      );
    },
    [setTracks, setEditing, setStepEditing]
  );

  useImperativeHandle(
    ref,
    () => ({
      openSequenceLibrary: () => setIsSequenceLibraryOpen(true),
      addTrack: () => handleAddTrack(),
      addTrackWithOptions: (options: AddTrackRequest) =>
        handleAddTrackWithOptions(options),
      updateTrackWithOptions: (trackId: number, options: AddTrackRequest) =>
        handleUpdateTrackWithOptions(trackId, options),
      removeTrack: (trackId: number) => removeTrack(trackId),
    }),
    [
      handleAddTrack,
      handleAddTrackWithOptions,
      handleUpdateTrackWithOptions,
      removeTrack,
    ]
  );

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

  const openCreateGroup = () => {
    setGroupEditor({
      mode: "create",
      name: getNextGroupName(),
    });
  };

  const openEditGroup = () => {
    if (!selectedGroup) return;
    setGroupEditor({
      mode: "edit",
      groupId: selectedGroup.id,
      name: selectedGroup.name,
    });
  };

  const handleEditorNameChange = (value: string) => {
    setGroupEditor((state) => (state ? { ...state, name: value } : state));
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
          };
        })
      );
      setGroupEditor(null);
      return;
    }
    const newId = createPatternGroupId();
    const trimmed = groupEditor.name.trim();
    let created: PatternGroup | null = null;
    setPatternGroups((groups) => {
      const name = trimmed || getNextGroupName(groups);
      created = {
        id: newId,
        name,
        tracks: [],
      };
      return [...groups, created];
    });
    if (created) {
      setSelectedGroupId(newId);
      applyGroupTracks(created);
    } else {
      setSelectedGroupId(newId);
      applyGroupTracks(null);
    }
    setGroupEditor(null);
  };

  const handleDuplicateGroup = () => {
    if (!selectedGroupId) return;
    let created: PatternGroup | null = null;
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
      const duplicatedTracks =
        source.id === selectedGroupId
          ? captureCurrentTracks()
          : source.tracks.map((track) => cloneTrack(track));
      created = {
        id: newId,
        name: candidate,
        tracks: duplicatedTracks,
      };
      return [...groups, created];
    });
    if (created) {
      setSelectedGroupId(newId);
      applyGroupTracks(created);
    }
    setGroupEditor(null);
  };

  const handleSnapshotSelectedGroup = () => {
    if (!selectedGroupId) return;
    setPatternGroups((groups) =>
      groups.map((group) => {
        if (group.id !== selectedGroupId) return group;
        return {
          ...group,
          tracks: captureCurrentTracks(),
        };
      })
    );
  };

  const handleDeleteGroup = () => {
    if (!selectedGroupId) return;
    if (patternGroups.length <= 1) return;
    setPatternGroups((groups) => {
      const filtered = groups.filter((group) => group.id !== selectedGroupId);
      if (filtered.length === 0) {
        const fallbackGroup: PatternGroup = {
          id: createPatternGroupId(),
          name: getNextGroupName([]),
          tracks: [],
        };
        setSelectedGroupId(fallbackGroup.id);
        applyGroupTracks(fallbackGroup);
        return [fallbackGroup];
      }
      const nextGroup = filtered[0] ?? null;
      if (nextGroup) {
        setSelectedGroupId(nextGroup.id);
        applyGroupTracks(nextGroup);
      } else {
        setSelectedGroupId(null);
        applyGroupTracks(null);
      }
      return filtered;
    });
    setGroupEditor(null);
  };

  const handleCancelGroupEdit = () => {
    setGroupEditor(null);
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() =>
            setIsSequenceLibraryOpen((open) => !open && patternGroups.length > 0)
          }
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
          <span>Sequence: {selectedGroup?.name ?? "None"}</span>
          <span aria-hidden="true" style={{ fontSize: 10 }}>
            ▴
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (!addTrackEnabled) return;
            onAddTrack();
          }}
          disabled={!addTrackEnabled}
          style={{
            padding: "6px 16px",
            borderRadius: 999,
            border: "1px solid #333",
            background: addTrackEnabled ? "#27E0B0" : "#1f2532",
            color: addTrackEnabled ? "#1F2532" : "#475569",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.3,
            cursor: addTrackEnabled ? "pointer" : "not-allowed",
            boxShadow: addTrackEnabled
              ? "0 2px 6px rgba(15, 20, 32, 0.35)"
              : "none",
          }}
        >
          + Track
        </button>
      </div>
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

          const handleLabelPointerDown = (
            event: ReactPointerEvent<HTMLDivElement>
          ) => {
            event.stopPropagation();
            longPressTriggered = false;
            if (labelTimer) window.clearTimeout(labelTimer);
            labelTimer = window.setTimeout(() => {
              longPressTriggered = true;
              onRequestTrackModal(t);
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
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {isSequenceLibraryOpen && (
        <div
          onClick={() => setIsSequenceLibraryOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(8, 12, 20, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#111827",
              border: "1px solid #2a3344",
              borderRadius: 12,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "0 18px 40px rgba(8, 12, 20, 0.6)",
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
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#e6f2ff",
                }}
              >
                Sequence Library
              </h3>
              <button
                type="button"
                onClick={() => setIsSequenceLibraryOpen(false)}
                style={{
                  marginLeft: "auto",
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #333",
                  background: "#1f2532",
                  color: "#e6f2ff",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={openCreateGroup}
                aria-label="Create new sequence"
                title="Create new sequence"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
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
                  style={{ fontSize: 22 }}
                >
                  add
                </span>
              </button>
              <select
                aria-label="Current sequence"
                value={selectedGroupId ?? patternGroups[0]?.id ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedGroupId(value || null);
                  setGroupEditor(null);
                  setIsSequenceLibraryOpen(false);
                }}
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  padding: 8,
                  borderRadius: 8,
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
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              <button
                type="button"
                onClick={handleSnapshotSelectedGroup}
                disabled={!selectedGroup}
                aria-label="Save sequence"
                title="Save sequence"
                style={{
                  flex: "1 1 100px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: selectedGroup ? "#27E0B0" : "#1f2532",
                  color: selectedGroup ? "#1F2532" : "#64748b",
                  cursor: selectedGroup ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                }}
              >
                <span className="material-symbols-outlined">save</span>
                Save
              </button>
              <button
                type="button"
                onClick={openEditGroup}
                disabled={!selectedGroup}
                aria-label="Edit sequence"
                style={{
                  flex: "1 1 100px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: isEditingCurrentGroup ? "#27E0B0" : "#1f2532",
                  color: selectedGroup
                    ? isEditingCurrentGroup
                      ? "#1F2532"
                      : "#e6f2ff"
                    : "#64748b",
                  cursor: selectedGroup ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                }}
              >
                <span className="material-symbols-outlined">edit</span>
                Edit
              </button>
              <button
                type="button"
                onClick={handleDuplicateGroup}
                disabled={!selectedGroup}
                aria-label="Duplicate sequence"
                style={{
                  flex: "1 1 110px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#1f2532",
                  color: selectedGroup ? "#e6f2ff" : "#64748b",
                  cursor: selectedGroup ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                }}
              >
                <span className="material-symbols-outlined">content_copy</span>
                Duplicate
              </button>
              <button
                type="button"
                onClick={handleDeleteGroup}
                disabled={!selectedGroup || patternGroups.length <= 1}
                aria-label="Delete sequence"
                style={{
                  flex: "1 1 110px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#1f2532",
                  color:
                    selectedGroup && patternGroups.length > 1
                      ? "#fca5a5"
                      : "#64748b",
                  cursor:
                    selectedGroup && patternGroups.length > 1
                      ? "pointer"
                      : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                }}
              >
                <span className="material-symbols-outlined">delete</span>
                Delete
              </button>
            </div>
            {groupEditor ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <input
                  value={groupEditor.name}
                  onChange={(event) =>
                    handleEditorNameChange(event.target.value)
                  }
                  placeholder={getNextGroupName()}
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#1f2532",
                    color: "#e6f2ff",
                  }}
                />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  {groupEditor.mode === "create"
                    ? "New sequences start blank. Name it to keep things organized."
                    : "Rename this sequence."}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      handleSaveGroup();
                      setIsSequenceLibraryOpen(false);
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #333",
                      background: "#27E0B0",
                      color: "#1F2532",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {groupEditor.mode === "create"
                      ? "Create New Sequence"
                      : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelGroupEdit}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
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
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {selectedGroup.tracks.length === 0
                  ? "No saved tracks yet. Tap Save Sequence to capture the current loop."
                  : `${selectedGroup.tracks.length} saved track${
                      selectedGroup.tracks.length === 1 ? "" : "s"
                    } including mute states.`}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                Create a sequence to capture the current track mix.
              </span>
            )}
          </div>
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
);

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
        flex: 1,
        width: "100%",
        display: "grid",
        gridTemplateColumns: "repeat(16, minmax(0, 1fr))",
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

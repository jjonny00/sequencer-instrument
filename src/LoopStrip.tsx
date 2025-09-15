import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
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

const computeDefaultTrackName = (instrument: string, tracks: Track[]) => {
  const base = formatInstrumentLabel(instrument);
  const count = tracks.filter((track) => track.instrument === instrument).length;
  return count ? `${base} ${count + 1}` : base;
};

const LABEL_WIDTH = 60;
const ROW_HEIGHT = 40;

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
  const [selectedChunk, setSelectedChunk] = useState("");
  const [newTrackInstrument, setNewTrackInstrument] = useState("");
  const [newTrackName, setNewTrackName] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<"new" | string>("new");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupTrackIds, setNewGroupTrackIds] = useState<number[]>([]);
  const [stepEditing, setStepEditing] = useState<
    { trackId: number; index: number | null } | null
  >(null);
  const swipeRef = useRef(0);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const pack = packs[packIndex];
  const instrumentOptions = Object.keys(pack.instruments);
  const selectedGroup = useMemo(
    () =>
      activeGroupId === "new"
        ? null
        : patternGroups.find((group) => group.id === activeGroupId) ?? null,
    [activeGroupId, patternGroups]
  );
  const defaultGroupName = useMemo(() => {
    const existingNames = new Set(patternGroups.map((group) => group.name));
    let index = patternGroups.length + 1;
    let candidate = `Group ${index}`;
    while (existingNames.has(candidate)) {
      index += 1;
      candidate = `Group ${index}`;
    }
    return candidate;
  }, [patternGroups]);

  useEffect(() => {
    setSelectedChunk("");
    setNewTrackInstrument((prev) => {
      if (!prev) return prev;
      return pack.instruments[prev] ? prev : "";
    });
  }, [pack]);

  useEffect(() => {
    if (activeGroupId === "new") return;
    if (!patternGroups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId("new");
    }
  }, [patternGroups, activeGroupId]);

  useEffect(() => {
    setNewGroupTrackIds((ids) =>
      ids.filter((id) => tracks.some((track) => track.id === id))
    );
  }, [tracks]);

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
    setTracks((ts) =>
      ts.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          pattern: {
            id: `track-${trackId}-${Date.now()}`,
            name: `${t.name} Pattern`,
            instrument: t.instrument,
            steps: Array(16).fill(0),
            velocities: Array(16).fill(1),
            pitches: Array(16).fill(0),
          },
        };
      })
    );
    setEditing(trackId);
  };

  const handleAddTrack = () => {
    if (!newTrackInstrument) return;
    let createdId: number | null = null;
    setTracks((ts) => {
      const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
      const trimmedName = newTrackName.trim();
      const name =
        trimmedName || computeDefaultTrackName(newTrackInstrument, ts);
      createdId = nextId;
      return [
        ...ts,
        {
          id: nextId,
          name,
          instrument: newTrackInstrument as keyof TriggerMap,
          pattern: null,
        },
      ];
    });
    if (createdId !== null) {
      setEditing(createdId);
    }
    setNewTrackName("");
  };

  const handleToggleNewGroupTrack = (trackId: number) => {
    setNewGroupTrackIds((ids) => {
      if (ids.includes(trackId)) {
        return ids.filter((id) => id !== trackId);
      }
      const next = new Set([...ids, trackId]);
      return tracks
        .filter((track) => next.has(track.id))
        .map((track) => track.id);
    });
  };

  const handleCreateGroup = () => {
    const name = newGroupName.trim() || defaultGroupName;
    if (tracks.length === 0 || newGroupTrackIds.length === 0) return;
    const groupTrackIds = tracks
      .filter((track) => newGroupTrackIds.includes(track.id))
      .map((track) => track.id);
    if (groupTrackIds.length === 0) return;
    const newId = createPatternGroupId();
    const newGroup: PatternGroup = {
      id: newId,
      name,
      trackIds: groupTrackIds,
    };
    setPatternGroups((prev) => [...prev, newGroup]);
    setActiveGroupId(newId);
    setNewGroupName("");
    setNewGroupTrackIds([]);
  };

  const handleRenameGroup = (value: string) => {
    if (!selectedGroup) return;
    setPatternGroups((groups) =>
      groups.map((group) =>
        group.id === selectedGroup.id ? { ...group, name: value } : group
      )
    );
  };

  const handleToggleExistingGroupTrack = (trackId: number) => {
    if (!selectedGroup) return;
    setPatternGroups((groups) =>
      groups.map((group) => {
        if (group.id !== selectedGroup.id) return group;
        const next = new Set(group.trackIds);
        if (next.has(trackId)) {
          next.delete(trackId);
        } else {
          next.add(trackId);
        }
        const ordered = tracks
          .filter((track) => next.has(track.id))
          .map((track) => track.id);
        return { ...group, trackIds: ordered };
      })
    );
  };

  const renderTrackChooser = (
    selectedIds: number[],
    onToggle: (trackId: number) => void
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
          Add a track to start building groups.
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
        {tracks.map((track) => {
          const checked = selectedIds.includes(track.id);
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
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(track.id)}
              />
              <span>{track.name}</span>
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


  const loadChunk = (chunk: Chunk) => {
    let targetId: number | null = null;
    setTracks((ts) => {
      if (editing !== null) {
        const trackExists = ts.some((t) => t.id === editing);
        if (!trackExists) {
          targetId = null;
          return ts;
        }
        targetId = editing;
        return ts.map((t) =>
          t.id === editing
            ? {
                ...t,
                name: chunk.name,
                instrument: chunk.instrument as keyof TriggerMap,
                pattern: { ...chunk },
              }
            : t
        );
      }
      const existing = ts.find((t) => t.instrument === chunk.instrument);
      if (existing) {
        targetId = existing.id;
        return ts.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                name: chunk.name,
                instrument: chunk.instrument as keyof TriggerMap,
                pattern: { ...chunk },
              }
            : t
        );
      }
      const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
      targetId = nextId;
      return [
        ...ts,
        {
          id: nextId,
          name: chunk.name,
          instrument: chunk.instrument as keyof TriggerMap,
          pattern: { ...chunk },
        },
      ];
    });
    if (targetId !== null) {
      setEditing(targetId);
    }
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
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        {packs.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setPackIndex(i)}
            style={{
              flex: 1,
              padding: 4,
              borderRadius: 4,
              background: i === packIndex ? "#27E0B0" : "#121827",
              color: i === packIndex ? "#1F2532" : "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div style={{ marginBottom: 4 }}>
        <select
          value={selectedChunk}
          onChange={(e) => {
            const id = e.target.value;
            setSelectedChunk("");
            const chunk = pack.chunks.find((c) => c.id === id);
            if (chunk) loadChunk(chunk);
          }}
          style={{
            padding: 4,
            borderRadius: 4,
            background: "#121827",
            color: "white",
            width: "100%",
          }}
        >
          <option value="">Load preset…</option>
          {pack.chunks.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleAddTrack();
        }}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <select
          value={newTrackInstrument}
          onChange={(event) => setNewTrackInstrument(event.target.value)}
          style={{
            flex: "1 1 150px",
            minWidth: 140,
            padding: 4,
            borderRadius: 4,
            background: "#121827",
            color: "white",
            border: "1px solid #333",
          }}
        >
          <option value="">Choose instrument…</option>
          {instrumentOptions.map((instrument) => (
            <option key={instrument} value={instrument}>
              {formatInstrumentLabel(instrument)}
            </option>
          ))}
        </select>
        <input
          value={newTrackName}
          onChange={(event) => setNewTrackName(event.target.value)}
          placeholder="Optional name"
          style={{
            flex: "2 1 160px",
            minWidth: 160,
            padding: 4,
            borderRadius: 4,
            border: "1px solid #333",
            background: "#121827",
            color: "white",
          }}
        />
        <button
          type="submit"
          disabled={!newTrackInstrument}
          style={{
            flex: "0 0 auto",
            padding: "4px 12px",
            borderRadius: 4,
            border: "1px solid #333",
            background: newTrackInstrument ? "#27E0B0" : "#1f2532",
            color: newTrackInstrument ? "#1F2532" : "#64748b",
            cursor: newTrackInstrument ? "pointer" : "default",
            fontWeight: 600,
          }}
        >
          Add Track
        </button>
      </form>
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
        {tracks.map((t) => {
          let labelTimer: number | null = null;
          const handleLabelPointerDown = () => {
            if (editing !== t.id) return;
            labelTimer = window.setTimeout(() => {
              setStepEditing({ trackId: t.id, index: null });
            }, 500);
          };
          const clearLabelTimer = () => {
            if (labelTimer) window.clearTimeout(labelTimer);
            labelTimer = null;
          };
          const color = getInstrumentColor(t.instrument);
          return (
            <div
              key={t.id}
              onPointerDown={(e) => {
                swipeRef.current = e.clientX;
              }}
              onPointerUp={(e) => {
                const dx = e.clientX - swipeRef.current;
                if (editing === t.id && dx > 50) {
                  setEditing(null);
                } else if (editing === null && t.pattern && Math.abs(dx) < 10) {
                  setEditing(t.id);
                }
              }}
              style={{
                display: "flex",
                height: ROW_HEIGHT,
                minHeight: ROW_HEIGHT,
                flex: "none",
                boxSizing: "border-box",
                cursor: t.pattern ? "pointer" : "default",
                opacity: editing !== null && editing !== t.id ? 0.3 : 1,
                border: editing === t.id ? "2px solid #27E0B0" : "1px solid #555",
                pointerEvents: editing !== null && editing !== t.id ? "none" : "auto",
              }}
            >
              <div
                onPointerDown={handleLabelPointerDown}
                onPointerUp={clearLabelTimer}
                onPointerLeave={clearLabelTimer}
                style={{
                  width: LABEL_WIDTH,
                  borderRight: "1px solid #555",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontSize: 12,
                }}
              >
                {t.name}
              </div>
              <div style={{ flex: 1 }}>
                {t.pattern ? (
                  editing === t.id ? (
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
                    style={{
                      width: "100%",
                      height: "100%",
                      background: "#2a2f3a",
                      color: "white",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    New Pattern
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 8,
          borderRadius: 8,
          border: "1px solid #333",
          padding: 12,
          background: "#121827",
          color: "#e6f2ff",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 12 }}>Groups</span>
          <select
            value={activeGroupId}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "new") {
                setActiveGroupId("new");
                setNewGroupName("");
                setNewGroupTrackIds([]);
              } else {
                setActiveGroupId(value);
              }
            }}
            style={{
              flex: "1 1 160px",
              minWidth: 160,
              padding: 4,
              borderRadius: 4,
              background: "#1f2532",
              color: "#e6f2ff",
              border: "1px solid #333",
            }}
          >
            <option value="new">Create new group…</option>
            {patternGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        {selectedGroup ? (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <input
              value={selectedGroup.name}
              onChange={(event) => handleRenameGroup(event.target.value)}
              style={{
                padding: 6,
                borderRadius: 6,
                border: "1px solid #333",
                background: "#1f2532",
                color: "#e6f2ff",
              }}
            />
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Toggle tracks to include in this group.
            </span>
            {renderTrackChooser(
              selectedGroup.trackIds,
              handleToggleExistingGroupTrack
            )}
            {selectedGroup.trackIds.length === 0 && tracks.length > 0 && (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                No tracks selected. This group will be silent until tracks are
                added.
              </span>
            )}
          </div>
        ) : (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder={defaultGroupName}
              style={{
                padding: 6,
                borderRadius: 6,
                border: "1px solid #333",
                background: "#1f2532",
                color: "#e6f2ff",
              }}
            />
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Select tracks to include in this new group.
            </span>
            {renderTrackChooser(newGroupTrackIds, handleToggleNewGroupTrack)}
            <button
              type="button"
              onClick={handleCreateGroup}
              disabled={tracks.length === 0 || newGroupTrackIds.length === 0}
              style={{
                alignSelf: "flex-start",
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid #333",
                background:
                  tracks.length === 0 || newGroupTrackIds.length === 0
                    ? "#1f2532"
                    : "#27E0B0",
                color:
                  tracks.length === 0 || newGroupTrackIds.length === 0
                    ? "#64748b"
                    : "#1F2532",
                cursor:
                  tracks.length === 0 || newGroupTrackIds.length === 0
                    ? "default"
                    : "pointer",
                fontWeight: 600,
              }}
            >
              Add Group
            </button>
          </div>
        )}
        {patternGroups.length === 0 &&
          selectedGroup === null &&
          tracks.length > 0 && (
            <span
              style={{
                fontSize: 12,
                color: "#94a3b8",
                marginTop: 8,
                display: "block",
              }}
            >
              Groups let you reuse sets of tracks when arranging the song.
            </span>
          )}
      </div>
      {stepEditing && (() => {
        const track = tracks.find((tr) => tr.id === stepEditing.trackId);
        if (!track || !track.pattern) return null;
        const velocity =
          stepEditing.index === null
            ? track.pattern.velocities?.[0] ?? 1
            : track.pattern.velocities?.[stepEditing.index] ?? 1;
        const pitch =
          stepEditing.index === null
            ? track.pattern.pitches?.[0] ?? 0
            : track.pattern.pitches?.[stepEditing.index] ?? 0;
        const onChange = (p: { velocity?: number; pitch?: number }) => {
          if (stepEditing.index === null) {
            updatePatternControls(track.id, p);
          } else {
            updateStep(track.id, stepEditing.index, p);
          }
        };
        return (
          <StepModal
            velocity={velocity}
            pitch={pitch}
            onChange={onChange}
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

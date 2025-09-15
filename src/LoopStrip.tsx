import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as Tone from "tone";
import type { Track, TriggerMap } from "./tracks";
import type { Chunk } from "./chunks";
import { packs } from "./packs";
import { StepModal } from "./StepModal";

const instrumentColors: Record<string, string> = {
  kick: "#e74c3c",
  snare: "#3498db",
  hat: "#f1c40f",
  chord: "#2ecc71",
  arpeggiator: "#9b59b6",
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
  triggers,
  editing,
  setEditing,
  setTracks,
  packIndex,
  setPackIndex,
  songSections,
  currentSection,
}: {
  started: boolean;
  isPlaying: boolean;
  tracks: Track[];
  triggers: TriggerMap;
  editing: number | null;
  setEditing: Dispatch<SetStateAction<number | null>>;
  setTracks: Dispatch<SetStateAction<Track[]>>;
  packIndex: number;
  setPackIndex: Dispatch<SetStateAction<number>>;
  songSections: boolean[][];
  currentSection: number;
}) {
  const [step, setStep] = useState(-1);
  const [selectedChunk, setSelectedChunk] = useState("");
  const [stepEditing, setStepEditing] = useState<
    { trackId: number; index: number | null } | null
  >(null);
  const swipeRef = useRef(0);
  const trackAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedChunk("");
  }, [packIndex]);

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
    const pack = packs[packIndex];
    const track = tracks.find((t) => t.id === trackId);
    if (!pack || !track) return;
    const chunk = pack.chunks.find((c) => c.instrument === track.instrument);
    if (!chunk) return;
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId ? { ...t, pattern: { ...chunk } } : t
      )
    );
    setEditing(trackId);
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
    setTracks((ts) => {
      const existing = ts.find((t) => t.instrument === chunk.instrument);
      if (existing) {
        const updated = ts.map((t) =>
          t.instrument === chunk.instrument
            ? { ...t, name: chunk.name, pattern: { ...chunk } }
            : t
        );
        setEditing(existing.id);
        return updated;
      }
      const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
      setEditing(nextId);
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
            const chunk = packs[packIndex].chunks.find((c) => c.id === id);
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
          {packs[packIndex].chunks.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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
        {tracks.map((t, trackIndex) => {
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
                      color={instrumentColors[t.instrument]}
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
                              background: active
                                ? instrumentColors[t.instrument]
                                : "#1f2532",
                              opacity: active ? 1 : 0.2,
                              boxShadow: playing
                                ? `0 0 6px ${instrumentColors[t.instrument]}`
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
                    Add Pattern
                  </button>
                )}
                {t.pattern && (
                  <PatternPlayer
                    pattern={t.pattern}
                    trigger={triggers[t.instrument]}
                    started={started}
                    isTrackActive={() =>
                      songSections[currentSection]?.[trackIndex] ?? true
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
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

function PatternPlayer({
  pattern,
  trigger,
  started,
  isTrackActive,
}: {
  pattern: Chunk;
  trigger: (
    time: number,
    velocity?: number,
    pitch?: number,
    note?: string,
    sustain?: number,
    chunk?: Chunk
  ) => void;
  started: boolean;
  isTrackActive: () => boolean;
}) {
  const isTrackActiveRef = useRef(isTrackActive);

  useEffect(() => {
    isTrackActiveRef.current = isTrackActive;
  }, [isTrackActive]);

  useEffect(() => {
    if (!started) return;
    const seq = new Tone.Sequence(
      (time, index: number) => {
        const active = pattern.steps[index] ?? 0;
        if (active && isTrackActiveRef.current()) {
          const velocity = pattern.velocities?.[index];
          const pitch = pattern.pitches?.[index];
          trigger(time, velocity, pitch, pattern.note, pattern.sustain, pattern);
        }
      },
      Array.from({ length: 16 }, (_, i) => i),
      "16n"
    ).start(0);
    return () => {
      seq.dispose();
    };
  }, [
    pattern.steps,
    pattern.velocities,
    pattern.pitches,
    pattern.note,
    pattern.sustain,
    pattern.attack,
    pattern.glide,
    pattern.pan,
    pattern.reverb,
    pattern.delay,
    pattern.distortion,
    pattern.bitcrusher,
    trigger,
    started,
    pattern,
  ]);
  return null;
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

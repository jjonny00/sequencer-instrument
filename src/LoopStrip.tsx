import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as Tone from "tone";
import type { Track, TriggerMap } from "./tracks";
import type { Chunk } from "./chunks";
import { packs } from "./packs";
import { ChunkModal } from "./ChunkModal";

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
}) {
  const [step, setStep] = useState(0);
  const [selectedChunk, setSelectedChunk] = useState("");
  const [chunkEditing, setChunkEditing] = useState<number | null>(null);
  const longPressRef = useRef(false);
  const timerRef = useRef<number>();

  useEffect(() => {
    setSelectedChunk("");
  }, [packIndex]);

  // Schedule a step advance on each 16th note when audio has started.
  useEffect(() => {
    if (!started) return;
    const id = Tone.Transport.scheduleRepeat((time) => {
      Tone.Draw.schedule(() => {
        setStep((s) => (s + 1) % 16);
      }, time);
    }, "16n");
    return () => {
      Tone.Transport.clear(id);
    };
  }, [started]);

  // Reset playhead when transport stops or is paused.
  useEffect(() => {
    if (!isPlaying) setStep(0);
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

  const updateChunk = (trackId: number, props: Partial<Chunk>) => {
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId && t.pattern
          ? { ...t, pattern: { ...t.pattern, ...props } }
          : t
      )
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
        height: "25vh",
        width: "100%",
        background: "#2a2f3a",
        display: "flex",
        flexDirection: "column",
        padding: "8px",
        boxSizing: "border-box",
        gap: 4,
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
      {tracks.map((t) => (
        <div
          key={t.id}
          onClick={() => {
            if (longPressRef.current) {
              longPressRef.current = false;
              return;
            }
            if (t.pattern && editing === null) setEditing(t.id);
          }}
          onPointerDown={() => {
            if (!t.pattern) return;
            timerRef.current = window.setTimeout(() => {
              longPressRef.current = true;
              setChunkEditing(t.id);
            }, 500);
          }}
          onPointerUp={() => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
          }}
          onPointerLeave={() => {
            if (timerRef.current) window.clearTimeout(timerRef.current);
          }}
          style={{
            display: "flex",
            flex: 1,
            cursor: t.pattern ? "pointer" : "default",
            opacity: editing !== null && editing !== t.id ? 0.3 : 1,
            border: editing === t.id ? "2px solid #27E0B0" : "1px solid #555",
            pointerEvents: editing !== null && editing !== t.id ? "none" : "auto",
          }}
        >
          <div
            style={{
              width: 60,
              borderRight: "1px solid #555",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 12,
            }}
          >
            {editing === t.id ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(null);
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  background: "#27E0B0",
                  border: "none",
                  color: "#1F2532",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Done
              </button>
            ) : (
              t.name
            )}
          </div>
          <div style={{ flex: 1 }}>
            {t.pattern ? (
              editing === t.id ? (
                <PatternEditor
                  steps={t.pattern.steps}
                  onChange={(p) => updatePattern(t.id, p)}
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
                    const isCurrent = i === step;
                    return (
                      <div
                        key={i}
                        style={{
                          border: "1px solid #555",
                          background: active ? "#27E0B0" : "#1f2532",
                          opacity: isCurrent ? 1 : 0.5,
                          transition: "opacity 60ms linear",
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
              />
            )}
          </div>
        </div>
      ))}
      {chunkEditing !== null && (() => {
        const track = tracks.find((tr) => tr.id === chunkEditing);
        if (!track || !track.pattern) return null;
        return (
          <ChunkModal
            chunk={track.pattern}
            onChange={(p) => updateChunk(track.id, p)}
            onClose={() => setChunkEditing(null)}
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
}: {
  pattern: Chunk;
  trigger: (time: number) => void;
  started: boolean;
}) {
  useEffect(() => {
    if (!started) return;
    const seq = new Tone.Sequence(
      (time, step) => {
        if (step) trigger(time);
      },
      pattern.steps,
      "16n"
    ).start(0);
    return () => {
      seq.dispose();
    };
  }, [pattern.steps, trigger, started]);
  return null;
}

function PatternEditor({
  steps,
  onChange,
}: {
  steps: number[];
  onChange: (p: number[]) => void;
}) {
  const toggle = (index: number) => {
    const next = steps.slice();
    next[index] = next[index] ? 0 : 1;
    onChange(next);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(16, 1fr)",
        gap: 2,
        height: "100%",
      }}
    >
      {steps.map((v, i) => (
        <div
          key={i}
          onClick={() => toggle(i)}
          style={{
            border: "1px solid #555",
            background: v ? "#27E0B0" : "#1f2532",
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import * as Tone from "tone";
import type { Track, TriggerMap } from "./tracks";
import { presets, type Pattern } from "./patterns";

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
}: {
  started: boolean;
  isPlaying: boolean;
  tracks: Track[];
  triggers: TriggerMap;
  editing: number | null;
  setEditing: Dispatch<SetStateAction<number | null>>;
  setTracks: Dispatch<SetStateAction<Track[]>>;
}) {
  const [step, setStep] = useState(0);

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
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId ? { ...t, pattern: { ...presets[t.instrument] } } : t
      )
    );
    setEditing(trackId);
  };

  const updatePattern = (trackId: number, steps: number[]) => {
    setTracks((ts) =>
      ts.map((t) => (t.id === trackId ? { ...t, pattern: { steps } } : t))
    );
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
      {tracks.map((t) => (
        <div
          key={t.id}
          onClick={() => {
            if (t.pattern && editing === null) setEditing(t.id);
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
    </div>
  );
}

function PatternPlayer({
  pattern,
  trigger,
  started,
}: {
  pattern: Pattern;
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

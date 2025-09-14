import { useState, useEffect, useRef } from "react";
import * as Tone from "tone";

// Map of trigger functions for each instrument.
type TriggerMap = Record<string, (time: number) => void>;

interface Pattern {
  steps: number[];
}

interface Track {
  id: number;
  name: string;
  instrument: keyof TriggerMap;
  pattern: Pattern | null;
}

export function Tracks({
  started,
  triggers
}: {
  started: boolean;
  triggers: TriggerMap;
}) {
  const [tracks, setTracks] = useState<Track[]>([
    { id: 1, name: "Kick", instrument: "kick", pattern: null },
    { id: 2, name: "Snare", instrument: "snare", pattern: null }
  ]);
  const [editing, setEditing] = useState<number | null>(null);

  const presets: Record<string, Pattern> = {
    kick: { steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
    snare: { steps: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] }
  };

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
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 16 }}>
      {tracks.map((t) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            border: t.id === editing ? "2px solid #27E0B0" : "1px solid #555",
            background: "#1f2532",
            opacity: editing !== null && t.id !== editing ? 0.3 : 1,
            pointerEvents: editing !== null && t.id !== editing ? "none" : "auto"
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
              fontSize: 12
            }}
          >
            {t.name}
          </div>
          <div style={{ flex: 1, padding: 4 }}>
            {t.pattern ? (
              t.id === editing ? (
                <>
                  <PatternPlayer
                    pattern={t.pattern}
                    trigger={triggers[t.instrument]}
                    started={started}
                  />
                  <PatternEditor
                    steps={t.pattern.steps}
                    onChange={(p) => updatePattern(t.id, p)}
                    onClose={() => setEditing(null)}
                  />
                </>
              ) : (
                <>
                  <PatternPlayer
                    pattern={t.pattern}
                    trigger={triggers[t.instrument]}
                    started={started}
                  />
                  <PatternPreview
                    steps={t.pattern.steps}
                    onLongPress={() => setEditing(t.id)}
                  />
                </>
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
                  cursor: "pointer"
                }}
              >
                Add Pattern
              </button>
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
  started
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

function PatternPreview({
  steps,
  onLongPress
}: {
  steps: number[];
  onLongPress: () => void;
}) {
  const timer = useRef<number | null>(null);
  return (
    <div
      onPointerDown={() => {
        timer.current = window.setTimeout(onLongPress, 500);
      }}
      onPointerUp={() => {
        if (timer.current !== null) window.clearTimeout(timer.current);
      }}
      onPointerLeave={() => {
        if (timer.current !== null) window.clearTimeout(timer.current);
      }}
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: "repeat(16, 1fr)",
        gap: 2
      }}
    >
      {steps.map((v, i) => (
        <div key={i} style={{ background: v ? "#27E0B0" : "#2a2f3a" }} />
      ))}
    </div>
  );
}

function PatternEditor({
  steps,
  onChange,
  onClose
}: {
  steps: number[];
  onChange: (p: number[]) => void;
  onClose: () => void;
}) {
  const toggle = (index: number) => {
    const next = steps.slice();
    next[index] = next[index] ? 0 : 1;
    onChange(next);
  };

  return (
    <div style={{ padding: 4 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(16, 1fr)",
          gap: 4,
          marginBottom: 8
        }}
      >
        {steps.map((v, i) => (
          <div
            key={i}
            onClick={() => toggle(i)}
            style={{
              border: "1px solid #555",
              background: v ? "#27E0B0" : "#1f2532",
              height: 32,
              cursor: "pointer"
            }}
          />
        ))}
      </div>
      <button
        onClick={onClose}
        style={{
          padding: 8,
          background: "#27E0B0",
          border: "1px solid #333",
          borderRadius: 8,
          color: "#1F2532"
        }}
      >
        Back
      </button>
    </div>
  );
}

import { useState, useEffect } from "react";
import * as Tone from "tone";

// Map of trigger functions for each instrument.
type TriggerMap = Record<string, (time: number) => void>;

interface Chunk {
  pattern: number[];
}

interface Track {
  id: number;
  name: string;
  instrument: keyof TriggerMap;
  chunk: Chunk | null;
}

export function Tracks({
  started,
  triggers
}: {
  started: boolean;
  triggers: TriggerMap;
}) {
  const [tracks, setTracks] = useState<Track[]>([
    { id: 1, name: "Kick", instrument: "kick", chunk: null },
    { id: 2, name: "Snare", instrument: "snare", chunk: null }
  ]);
  const [editing, setEditing] = useState<number | null>(null);

  const presets: Record<string, Chunk> = {
    kick: { pattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] },
    snare: { pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] }
  };

  const dropChunk = (trackId: number) => {
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId ? { ...t, chunk: { ...presets[t.instrument] } } : t
      )
    );
  };

  const updatePattern = (trackId: number, pattern: number[]) => {
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId ? { ...t, chunk: { ...t.chunk!, pattern } } : t
      )
    );
  };

  if (editing !== null) {
    const track = tracks.find((t) => t.id === editing)!;
    return (
      <ChunkEditor
        pattern={track.chunk!.pattern}
        onChange={(p) => updatePattern(track.id, p)}
        onClose={() => setEditing(null)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 16 }}>
      {tracks.map((t) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            height: 40,
            border: "1px solid #555",
            background: "#1f2532"
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
          <div style={{ flex: 1 }}>
            {t.chunk ? (
              <ChunkView
                chunk={t.chunk}
                trigger={triggers[t.instrument]}
                started={started}
                onEdit={() => setEditing(t.id)}
              />
            ) : (
              <button
                onClick={() => dropChunk(t.id)}
                style={{
                  width: "100%",
                  height: "100%",
                  background: "#2a2f3a",
                  color: "white",
                  border: "none",
                  cursor: "pointer"
                }}
              >
                Add Chunk
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChunkView({
  chunk,
  trigger,
  started,
  onEdit
}: {
  chunk: Chunk;
  trigger: (time: number) => void;
  started: boolean;
  onEdit: () => void;
}) {
  useEffect(() => {
    if (!started) return;
    const seq = new Tone.Sequence(
      (time, step) => {
        if (step) trigger(time);
      },
      chunk.pattern,
      "16n"
    ).start(0);
    return () => seq.dispose();
  }, [chunk.pattern, trigger, started]);

  return (
    <div
      onClick={onEdit}
      style={{
        width: "100%",
        height: "100%",
        background: "#27E0B0",
        cursor: "pointer"
      }}
    />
  );
}

function ChunkEditor({
  pattern,
  onChange,
  onClose
}: {
  pattern: number[];
  onChange: (p: number[]) => void;
  onClose: () => void;
}) {
  const toggle = (index: number) => {
    const next = pattern.slice();
    next[index] = next[index] ? 0 : 1;
    onChange(next);
  };

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(16, 1fr)",
          gap: 4,
          marginBottom: 12
        }}
      >
        {pattern.map((v, i) => (
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

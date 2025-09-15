import { useMemo, useState, type MutableRefObject } from "react";
import * as Tone from "tone";

// Subdivision type mirrors App.tsx
export type Subdivision = "16n" | "8n" | "4n";

function nextGridTime(subdivision: Subdivision): number {
  const now = Tone.now();
  const pos = Tone.Transport.seconds;
  const dur = Tone.Time(subdivision).toSeconds();
  const next = Math.ceil(pos / dur) * dur;
  const epsilon = 0.001;
  const target = next - pos < epsilon ? next + dur : next;
  return now + (target - pos);
}

export function Keyboard({
  subdiv,
  noteRef,
}: {
  subdiv: Subdivision;
  noteRef: MutableRefObject<Tone.Synth | null>;
}) {
  const notes = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) =>
        Tone.Frequency("C4").transpose(i).toNote()
      ),
    []
  );
  const [pressed, setPressed] = useState<Record<string, boolean>>({});
  const [bend, setBend] = useState(0);

  const handleDown = (note: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPressed((p) => ({ ...p, [note]: true }));
    const t = nextGridTime(subdiv);
    noteRef.current?.triggerAttackRelease(note, "8n", t);
  };

  const handleUp = (note: string) => () => {
    setPressed((p) => ({ ...p, [note]: false }));
  };

  const isSharp = (n: string) => n.includes("#");

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${notes.length}, 1fr)`,
          touchAction: "none",
        }}
      >
        {notes.map((note) => (
          <div
            key={note}
            onPointerDown={handleDown(note)}
            onPointerUp={handleUp(note)}
            onPointerCancel={handleUp(note)}
            style={{
              height: 80,
              border: "1px solid #333",
              background: isSharp(note)
                ? pressed[note]
                  ? "#555"
                  : "#333"
                : pressed[note]
                ? "#ddd"
                : "#fff",
              color: isSharp(note) ? "#fff" : "#000",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              fontSize: "0.75rem",
              userSelect: "none",
              touchAction: "none",
            }}
          >
            {note}
          </div>
        ))}
      </div>
      <div
        style={{
          width: 40,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: 4,
        }}
      >
        <input
          type="range"
          min={-1200}
          max={1200}
          step={1}
          value={bend}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setBend(val);
            noteRef.current?.detune.rampTo(val, 0.05);
          }}
          onPointerUp={() => {
            setBend(0);
            noteRef.current?.detune.rampTo(0, 0.2);
          }}
          onPointerCancel={() => {
            setBend(0);
            noteRef.current?.detune.rampTo(0, 0.2);
          }}
          style={{
            transform: "rotate(-90deg)",
            width: "100%",
          }}
        />
      </div>
    </div>
  );
}


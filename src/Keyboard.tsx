import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import * as Tone from "tone";
import type { Track } from "./tracks";

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
  setTracks,
}: {
  subdiv: Subdivision;
  noteRef: MutableRefObject<Tone.PolySynth<Tone.Synth> | null>;
  setTracks: Dispatch<SetStateAction<Track[]>>;
}) {
  // Two octave range starting at middle C
  const notes = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) =>
        Tone.Frequency("C4").transpose(i).toNote()
      ),
    []
  );
  const isSharp = (n: string) => n.includes("#");
  const whiteNotes = useMemo(
    () => notes.filter((n) => !isSharp(n)),
    [notes]
  );
  const whiteWidth = 100 / whiteNotes.length;
  const blackWidth = whiteWidth * 0.6;
  const [pressed, setPressed] = useState<Record<string, boolean>>({});
  const [bend, setBend] = useState(0);
  const [sustain, setSustain] = useState(0.4); // seconds
  const [record, setRecord] = useState(false);
  const trackIdRef = useRef<number | null>(null);

  const addTrack = () => {
    setTracks((ts) => {
      const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
      const steps = Array(16).fill(0);
      const velocities = Array(16).fill(1);
      const pitches = Array(16).fill(0);
      trackIdRef.current = nextId;
      return [
        ...ts,
        {
          id: nextId,
          name: "Keyboard",
          instrument: "chord",
          pattern: {
            id: `kb-${Date.now()}`,
            name: "Keyboard",
            instrument: "chord",
            steps,
            velocities,
            pitches,
            note: "C4",
            sustain,
          },
        },
      ];
    });
  };

  useEffect(() => {
    if (!record) {
      trackIdRef.current = null;
    }
  }, [record]);

  const handleDown = (note: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPressed((p) => ({ ...p, [note]: true }));
    const t = nextGridTime(subdiv);
    noteRef.current?.triggerAttack(note, t);

    if (record) {
      const pitch =
        Tone.Frequency(note).toMidi() - Tone.Frequency("C4").toMidi();
      const ticks = Tone.Transport.getTicksAtTime(t);
      const stepIndex =
        Math.floor(ticks / (Tone.Transport.PPQ / 4)) % 16;
      setTracks((ts) => {
        let tid = trackIdRef.current;
        if (tid === null) {
          tid = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
          trackIdRef.current = tid;
          const steps = Array(16).fill(0);
          const velocities = Array(16).fill(1);
          const pitches = Array(16).fill(0);
          steps[stepIndex] = 1;
          velocities[stepIndex] = 1;
          pitches[stepIndex] = pitch;
          return [
            ...ts,
            {
              id: tid,
              name: "Keyboard",
              instrument: "chord",
              pattern: {
                id: `kb-${Date.now()}`,
                name: "Keyboard",
                instrument: "chord",
                steps,
                velocities,
                pitches,
                note: "C4",
                sustain,
              },
            },
          ];
        }
        return ts.map((t) => {
          if (t.id !== tid) return t;
          const pattern =
            t.pattern ?? {
              id: `kb-${Date.now()}`,
              name: "Keyboard",
              instrument: "chord",
              steps: Array(16).fill(0),
              velocities: Array(16).fill(1),
              pitches: Array(16).fill(0),
              note: "C4",
              sustain,
            };
          const steps = pattern.steps.slice();
          const velocities = (pattern.velocities
            ? pattern.velocities.slice()
            : Array(16).fill(1));
          const pitches = (pattern.pitches
            ? pattern.pitches.slice()
            : Array(16).fill(0));
          steps[stepIndex] = 1;
          velocities[stepIndex] = 1;
          pitches[stepIndex] = pitch;
          return {
            ...t,
            pattern: { ...pattern, steps, velocities, pitches, sustain },
          };
        });
      });
    }
  };

  const handleUp = (note: string) => () => {
    setPressed((p) => ({ ...p, [note]: false }));
    const t = nextGridTime(subdiv);
    noteRef.current?.triggerRelease(note, t);
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 12,
          alignItems: "center",
        }}
      >
        <label>Sustain</label>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={sustain}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setSustain(val);
            noteRef.current?.set({ envelope: { release: val } });
          }}
          style={{ flex: 1 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={addTrack}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "#121827",
              color: "#e6f2ff",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            New
          </button>
          <button
            onClick={() => setRecord((r) => !r)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #333",
              background: record ? "#E02749" : "#27E0B0",
              color: record ? "#e6f2ff" : "#1F2532",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {record ? "Recording" : "Record"}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div
          style={{
            flex: 1,
            position: "relative",
            height: 160,
            touchAction: "none",
            userSelect: "none",
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", height: "100%" }}>
            {whiteNotes.map((note, i) => (
              <div
                key={note}
                onPointerDown={handleDown(note)}
                onPointerUp={handleUp(note)}
                onPointerCancel={handleUp(note)}
                style={{
                  flex: 1,
                  borderRight: "1px solid #333",
                  borderLeft: i === 0 ? "1px solid #333" : "none",
                  borderBottom: "1px solid #333",
                  background: pressed[note] ? "#ddd" : "#fff",
                  color: "#000",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  touchAction: "none",
                }}
              >
                {note}
              </div>
            ))}
          </div>
          {notes.map((note, i) => {
            if (!isSharp(note)) return null;
            const whiteCount = notes
              .slice(0, i)
              .filter((n) => !isSharp(n)).length;
            const left = whiteCount * whiteWidth - blackWidth / 2;
            return (
              <div
                key={note}
                onPointerDown={handleDown(note)}
                onPointerUp={handleUp(note)}
                onPointerCancel={handleUp(note)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: `${left}%`,
                  width: `${blackWidth}%`,
                  height: "60%",
                  background: pressed[note] ? "#555" : "#333",
                  color: "#fff",
                  border: "1px solid #222",
                  zIndex: 1,
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  touchAction: "none",
                }}
              >
                {note}
              </div>
            );
          })}
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
              const synth = noteRef.current as unknown as {
                detune: Tone.Signal;
              };
              synth?.detune.rampTo(val, 0.05);
            }}
            onInput={(e) => {
              const val = parseInt((e.target as HTMLInputElement).value, 10);
              setBend(val);
              const synth = noteRef.current as unknown as {
                detune: Tone.Signal;
              };
              synth?.detune.rampTo(val, 0.05);
            }}
            onPointerUp={() => {
              setBend(0);
              const synth = noteRef.current as unknown as {
                detune: Tone.Signal;
              };
              synth?.detune.rampTo(0, 0.2);
            }}
            onPointerCancel={() => {
              setBend(0);
              const synth = noteRef.current as unknown as {
                detune: Tone.Signal;
              };
              synth?.detune.rampTo(0, 0.2);
            }}
            style={{
              width: 32,
              height: 160,
              writingMode: "vertical-rl",
              WebkitAppearance: "slider-vertical",
              touchAction: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}


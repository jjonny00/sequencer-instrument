import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import * as Tone from "tone";
import type { Track } from "./tracks";

type Subdivision = "16n" | "8n" | "4n";

type ArpStyle = "up" | "down" | "up-down" | "random";

function nextGridTime(subdivision: Subdivision): number {
  const now = Tone.now();
  const pos = Tone.Transport.seconds;
  const dur = Tone.Time(subdivision).toSeconds();
  const next = Math.ceil(pos / dur) * dur;
  const epsilon = 0.001;
  const target = next - pos < epsilon ? next + dur : next;
  return now + (target - pos);
}

export function Arpeggiator({
  started,
  subdiv,
  setTracks,
}: {
  started: boolean;
  subdiv: Subdivision;
  setTracks: Dispatch<SetStateAction<Track[]>>;
}) {
  const [root, setRoot] = useState("C4");
  const [style, setStyle] = useState<ArpStyle>("up");
  const [mode, setMode] = useState<"manual" | "continuous">("manual");
  const [record, setRecord] = useState(false);
  const [sustain, setSustain] = useState(0.1);
  const [held, setHeld] = useState<string[]>([]);
  const [chord, setChord] = useState<string[]>([]);
  const synthRef = useRef<Tone.Synth | null>(null);
  const loopRef = useRef<Tone.Loop | null>(null);
  const indexRef = useRef(0);
  const directionRef = useRef(1);
  const trackIdRef = useRef<number | null>(null);
  const loopStartRef = useRef<number | null>(null);

  const keyNotes = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) =>
        Tone.Frequency(root).transpose(i).toNote()
      ),
    [root]
  );

  useEffect(() => {
    if (!started) return;
    if (!synthRef.current) {
      synthRef.current = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.4 },
      }).toDestination();
    }
  }, [started]);

  useEffect(() => {
    loopRef.current?.dispose();
    if (!started) return;
    if (!chord.length) return;
    const notes = [...chord];
    // Sort notes ascending for deterministic styles
    notes.sort(
      (a, b) =>
        Tone.Frequency(a).toMidi() - Tone.Frequency(b).toMidi()
    );
    indexRef.current = style === "down" ? notes.length - 1 : 0;
    directionRef.current = 1;
    const start = loopStartRef.current ?? nextGridTime(subdiv);
    loopStartRef.current = null;
    const ticksPerStep = Tone.Transport.PPQ / 4;
    loopRef.current = new Tone.Loop((time) => {
      let note: string;
      if (style === "random") {
        note = notes[Math.floor(Math.random() * notes.length)];
      } else {
        note = notes[indexRef.current];
        if (style === "up") {
          indexRef.current = (indexRef.current + 1) % notes.length;
        } else if (style === "down") {
          indexRef.current = (indexRef.current - 1 + notes.length) % notes.length;
        } else {
          if (indexRef.current === notes.length - 1) directionRef.current = -1;
          else if (indexRef.current === 0) directionRef.current = 1;
          indexRef.current += directionRef.current;
        }
      }
      synthRef.current?.triggerAttackRelease(note, sustain, time);
      if (record) {
        const pitch =
          Tone.Frequency(note).toMidi() - Tone.Frequency(root).toMidi();
        const ticks = Tone.Transport.getTicksAtTime(time);
        const stepIndex = Math.floor(ticks / ticksPerStep) % 16;
        Tone.Draw.schedule(() => {
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
                  name: "Arp",
                  instrument: "chord",
                  pattern: {
                    id: `arp-${Date.now()}`,
                    name: "Arp",
                    instrument: "chord",
                    steps,
                    velocities,
                    pitches,
                    note: root,
                    sustain,
                  },
                },
              ];
            }
            return ts.map((t) => {
              if (t.id !== tid) return t;
              const pattern =
                t.pattern ?? {
                  id: `arp-${Date.now()}`,
                  name: "Arp",
                  instrument: "chord",
                  steps: Array(16).fill(0),
                  velocities: Array(16).fill(1),
                  pitches: Array(16).fill(0),
                  note: root,
                  sustain,
                };
              const steps = pattern.steps.slice();
              const velocities = pattern.velocities
                ? pattern.velocities.slice()
                : Array(16).fill(1);
              const pitches = pattern.pitches
                ? pattern.pitches.slice()
                : Array(16).fill(0);
              steps[stepIndex] = 1;
              velocities[stepIndex] = 1;
              pitches[stepIndex] = pitch;
              return {
                ...t,
                pattern: { ...pattern, steps, velocities, pitches, sustain },
              };
            });
          });
        }, time);
      }
    }, subdiv).start(start);
    return () => {
      loopRef.current?.dispose();
    };
  }, [started, style, subdiv, record, setTracks, root, chord, sustain]);

  useEffect(() => {
    if (!record) {
      trackIdRef.current = null;
    }
  }, [record]);

  const pressNote = (note: string) => {
    setHeld((h) => {
      if (h.includes(note)) return h;
      const next = [...h, note];
      if (h.length === 0) {
        loopStartRef.current = nextGridTime(subdiv);
      }
      if (mode === "manual") {
        setChord(next);
      } else {
        setChord((c) => (c.includes(note) ? c : [...c, note]));
      }
      return next;
    });
  };

  const releaseNote = (note: string) => {
    setHeld((h) => {
      const next = h.filter((n) => n !== note);
      if (mode === "manual") setChord(next);
      return next;
    });
  };

  useEffect(() => {
    if (mode === "manual") setChord(held);
  }, [mode, held]);

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 12,
          alignItems: "center",
        }}
      >
        <label>Root</label>
        <select
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          style={{
            padding: 8,
            borderRadius: 8,
            background: "#121827",
            color: "white",
          }}
        >
          {["C3", "D3", "E3", "F3", "G3", "A3", "B3"].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label>Style</label>
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value as ArpStyle)}
          style={{
            padding: 8,
            borderRadius: 8,
            background: "#121827",
            color: "white",
          }}
        >
          <option value="up">Up</option>
          <option value="down">Down</option>
          <option value="up-down">Up-Down</option>
          <option value="random">Random</option>
        </select>
        <label>Playback</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "manual" | "continuous")}
          style={{
            padding: 8,
            borderRadius: 8,
            background: "#121827",
            color: "white",
          }}
        >
          <option value="manual">Manual</option>
          <option value="continuous">Continuous</option>
        </select>
        <label>Sustain</label>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={sustain}
          onChange={(e) => setSustain(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
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
      <div style={{ display: "flex", gap: 4 }}>
        {keyNotes.map((n) => (
          <div
            key={n}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pressNote(n);
            }}
            onPointerUp={(e) => {
              releaseNote(n);
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => releaseNote(n)}
            style={{
              flex: 1,
              height: 60,
              background: held.includes(n) ? "#30394f" : "#1f2532",
              border: "1px solid #333",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#e6f2ff",
              userSelect: "none",
            }}
          >
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

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
  editing,
}: {
  started: boolean;
  subdiv: Subdivision;
  setTracks: Dispatch<SetStateAction<Track[]>>;
  editing: number | null;
}) {
  const [root, setRoot] = useState("C4");
  const [style, setStyle] = useState<ArpStyle>("up");
  const [record, setRecord] = useState(false);
  const [active, setActive] = useState<string[]>([]);
  const synthRef = useRef<Tone.Synth | null>(null);
  const loopRef = useRef<Tone.Loop | null>(null);
  const indexRef = useRef(0);
  const directionRef = useRef(1);
  const recordIndexRef = useRef(0);

  const keyNotes = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) =>
        Tone.Frequency(root).transpose(i).toNote()
      ),
    [root]
  );

  const stepSize = subdiv === "16n" ? 1 : subdiv === "8n" ? 2 : 4;

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
    if (!active.length) return;
    const notes = [...active];
    // Sort notes ascending for deterministic styles
    notes.sort(
      (a, b) =>
        Tone.Frequency(a).toMidi() - Tone.Frequency(b).toMidi()
    );
    indexRef.current = style === "down" ? notes.length - 1 : 0;
    directionRef.current = 1;
    recordIndexRef.current = 0;
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
      synthRef.current?.triggerAttackRelease(note, "8n", time);
      if (record && editing !== null) {
        const pitch =
          Tone.Frequency(note).toMidi() - Tone.Frequency(root).toMidi();
        const stepIndex = recordIndexRef.current;
        Tone.Draw.schedule(() => {
          setTracks((ts) =>
            ts.map((t) => {
              if (t.id !== editing) return t;
              const pattern =
                t.pattern ?? {
                  id: `arp-${Date.now()}`,
                  name: "Arp",
                  instrument: t.instrument,
                  steps: Array(16).fill(0),
                  velocities: Array(16).fill(1),
                  pitches: Array(16).fill(0),
                  note: root,
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
                pattern: { ...pattern, steps, velocities, pitches },
              };
            })
          );
        }, time);
        recordIndexRef.current = (stepIndex + stepSize) % 16;
      }
    }, subdiv).start(nextGridTime(subdiv));
    return () => {
      loopRef.current?.dispose();
    };
  }, [started, style, subdiv, record, editing, setTracks, root, active, stepSize]);

  const pressNote = (note: string) => {
    setActive((a) => (a.includes(note) ? a : [...a, note]));
  };

  const releaseNote = (note: string) => {
    setActive((a) => a.filter((n) => n !== note));
    if (active.length <= 1) {
      loopRef.current?.dispose();
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
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
        <button
          onClick={() => setRecord((r) => !r)}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #333",
            background: record ? "#E02749" : "#27E0B0",
            color: record ? "#e6f2ff" : "#1F2532",
            cursor: "pointer",
          }}
        >
          {record ? "Recording" : "Record to Pattern"}
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
              background: active.includes(n) ? "#30394f" : "#1f2532",
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

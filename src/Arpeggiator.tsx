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

type ArpStyle = "up" | "down" | "up-down" | "random" | "unfold";

function nextGridTime(subdivision: Subdivision): number {
  const now = Tone.now();
  const pos = Tone.Transport.seconds;
  const dur = Tone.Time(subdivision).toSeconds();
  const next = Math.ceil(pos / dur) * dur;
  const epsilon = 0.001;
  const target = next - pos < epsilon ? next + dur : next;
  return now + (target - pos);
}

function buildVoicing(notes: string[], root: string): {
  notes: string[];
  degrees: number[];
} {
  if (!notes.length) return { notes: [], degrees: [] };
  const midis = notes
    .map((n) => Tone.Frequency(n).toMidi())
    .sort((a, b) => a - b);
  const rootMidi = midis[0];
  const intervals = midis.map((m) => m - rootMidi);
  let third = intervals.find((i) => i === 3 || i === 4);
  if (third === undefined) third = 4;
  let fifth = intervals.find((i) => i === 7);
  if (fifth === undefined) fifth = 7;
  const voicing = [rootMidi, rootMidi + third, rootMidi + fifth];
  const chordNotes = voicing.map((m) =>
    Tone.Frequency(m, "midi").toNote()
  );
  const degrees = voicing.map(
    (m) => m - Tone.Frequency(root).toMidi()
  );
  return { notes: chordNotes, degrees };
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
  const [bend, setBend] = useState(0);
  const [held, setHeld] = useState<string[]>([]);
  const [chord, setChord] = useState<string[]>([]);
  const [degrees, setDegrees] = useState<number[]>([]);
  const synthRef = useRef<Tone.Synth | null>(null);
  const loopRef = useRef<Tone.Loop | null>(null);
  const indexRef = useRef(0);
  const directionRef = useRef(1);
  const trackIdRef = useRef<number | null>(null);
  const loopStartRef = useRef<number | null>(null);

  const addTrack = () => {
    setTracks((ts) => {
      const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
      const steps = Array(16).fill(0);
      const velocities = Array(16).fill(1);
      const pitches = Array(16).fill(0);
      const label = (ts.length + 1).toString().padStart(2, "0");
      trackIdRef.current = nextId;
      return [
        ...ts,
        {
          id: nextId,
          name: label,
          instrument: "arpeggiator",
          muted: false,
          pattern: {
            id: `arp-${Date.now()}`,
            name: `Track ${label} Pattern`,
            instrument: "arpeggiator",
            steps,
            velocities,
            pitches,
            note: root,
            sustain,
            notes: chord.length ? chord.slice() : [root],
            degrees: degrees.length ? degrees.slice() : [0],
            pitchBend: bend,
            style,
            mode,
          },
        },
      ];
    });
  };

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
      const bent = Tone.Frequency(note).transpose(bend).toNote();
      synthRef.current?.triggerAttackRelease(bent, sustain, time);
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
              const label = (ts.length + 1).toString().padStart(2, "0");
              steps[stepIndex] = 1;
              velocities[stepIndex] = 1;
              pitches[stepIndex] = pitch;
              return [
                ...ts,
                {
                  id: tid,
                  name: label,
                  instrument: "arpeggiator",
                  muted: false,
                  pattern: {
                    id: `arp-${Date.now()}`,
                    name: `Track ${label} Pattern`,
                    instrument: "arpeggiator",
                    steps,
                    velocities,
                    pitches,
                    note: root,
                    sustain,
                    notes: [note],
                    degrees: degrees.length ? degrees.slice() : [0],
                    pitchBend: bend,
                    style,
                    mode,
                  },
                },
              ];
            }
            return ts.map((t) => {
              if (t.id !== tid) return t;
              const label = /^\d+$/.test(t.name)
                ? t.name
                : (() => {
                    const index = ts.findIndex((candidate) => candidate.id === t.id);
                    const number = index >= 0 ? index + 1 : t.id;
                    return number.toString().padStart(2, "0");
                  })();
              const pattern =
                t.pattern ?? {
                  id: `arp-${Date.now()}`,
                  name: `Track ${label} Pattern`,
                  instrument: "arpeggiator",
                  steps: Array(16).fill(0),
                  velocities: Array(16).fill(1),
                  pitches: Array(16).fill(0),
                  note: root,
                  sustain,
                  notes: [],
                  degrees: [],
                  pitchBend: bend,
                  style,
                  mode,
                };
              const steps = pattern.steps.slice();
              const velocities = pattern.velocities
                ? pattern.velocities.slice()
                : Array(16).fill(1);
              const pitches = pattern.pitches
                ? pattern.pitches.slice()
                : Array(16).fill(0);
              const notesArr = pattern.notes ? pattern.notes.slice() : [];
              const degs =
                pattern.degrees && pattern.degrees.length
                  ? pattern.degrees.slice()
                  : degrees.slice();
              if (!notesArr.includes(note)) notesArr.push(note);
              steps[stepIndex] = 1;
              velocities[stepIndex] = 1;
              pitches[stepIndex] = pitch;
              return {
                ...t,
                pattern: {
                  ...pattern,
                  steps,
                  velocities,
                  pitches,
                  sustain,
                  notes: notesArr,
                  degrees: degs,
                  pitchBend: bend,
                  style,
                  mode,
                },
              };
            });
          });
        }, time);
      }
    }, subdiv).start(start);
    return () => {
      loopRef.current?.dispose();
    };
  }, [started, style, subdiv, record, setTracks, root, chord, sustain, mode, bend, degrees]);

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
      const v = buildVoicing(next, root);
      setChord(v.notes);
      setDegrees(v.degrees);
      return next;
    });
  };

  const releaseNote = (note: string) => {
    setHeld((h) => {
      const next = h.filter((n) => n !== note);
      if (mode === "manual") {
        const v = buildVoicing(next, root);
        setChord(v.notes);
        setDegrees(v.degrees);
      }
      return next;
    });
  };

  useEffect(() => {
    if (mode === "manual") {
      const v = buildVoicing(held, root);
      setChord(v.notes);
      setDegrees(v.degrees);
    }
  }, [mode, held, root]);

  useEffect(() => {
    setDegrees(
      chord.map(
        (n) => Tone.Frequency(n).toMidi() - Tone.Frequency(root).toMidi()
      )
    );
  }, [root, chord]);

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
          <option value="unfold">Unfold</option>
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
        <label>Pitch Bend</label>
        <input
          type="range"
          min={-5}
          max={5}
          step={0.1}
          value={bend}
          onChange={(e) => setBend(parseFloat(e.target.value))}
          style={{ width: 80 }}
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

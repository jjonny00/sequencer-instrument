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
import presets from "./keyboardPresets.json";
import type { Track } from "./tracks";

type FxChain = {
  reverb: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  distortion: Tone.Distortion;
  bitCrusher: Tone.BitCrusher;
  panner: Tone.Panner;
  chorus: Tone.Chorus;
  tremolo: Tone.Tremolo;
  filter: Tone.Filter;
};

type Scale = "Chromatic" | "Major" | "Minor" | "Pentatonic";

function Knob({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
}) {
  const angle = ((value - min) / (max - min)) * 270 - 135;
  return (
    <div
      style={{
        position: "relative",
        width: 56,
        height: 56,
        borderRadius: "50%",
        border: "1px solid #333",
        background: "#1f2532",
        touchAction: "none",
        boxShadow: value > min ? "0 0 8px #27E0B0" : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: 4,
          height: 20,
          background: "#27E0B0",
          transform: `translate(-50%, -100%) rotate(${angle}deg)`,
          transformOrigin: "bottom center",
          borderRadius: 2,
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
        }}
      />
    </div>
  );
}

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
  fxRef,
  setTracks,
}: {
  subdiv: Subdivision;
  noteRef: MutableRefObject<Tone.PolySynth<Tone.Synth> | null>;
  fxRef: MutableRefObject<FxChain | null>;
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
  const [attack, setAttack] = useState(0.005);
  const [release, setRelease] = useState(0.4);
  const [glide, setGlide] = useState(0);
  const [space, setSpace] = useState(0);
  const [grit, setGrit] = useState(0);
  const [lofi, setLofi] = useState(0);
  const [pan, setPan] = useState(0);
  const [sustainPedal, setSustainPedal] = useState(false);
  const [scale, setScale] = useState<Scale>("Chromatic");
  const [preset, setPreset] = useState("Custom");
  const [record, setRecord] = useState(false);
  const trackIdRef = useRef<number | null>(null);
  const activeNotes = useRef<Record<string, string>>({});
  const sustained = useRef<Set<string>>(new Set());

  const scales: Record<string, number[]> = {
    Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    Major: [0, 2, 4, 5, 7, 9, 11],
    Minor: [0, 2, 3, 5, 7, 8, 10],
    Pentatonic: [0, 2, 4, 7, 9],
  };

  const lockToScale = (note: string): string => {
    if (scale === "Chromatic") return note;
    const midi = Tone.Frequency(note).toMidi();
    let n = midi;
    const allowed = scales[scale];
    while (!allowed.includes(n % 12)) n++;
    return Tone.Frequency(n, "midi").toNote();
  };

  const toggleSustain = () => {
    setSustainPedal((s) => {
      if (s) {
        sustained.current.forEach((n) => noteRef.current?.triggerRelease(n));
        sustained.current.clear();
      }
      return !s;
    });
  };

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
          muted: false,
          pattern: {
            id: `kb-${Date.now()}`,
            name: "Keyboard",
            instrument: "chord",
            steps,
            velocities,
            pitches,
            note: "C4",
            sustain: release,
            attack,
            glide,
            pan,
            reverb: space,
            delay: space,
            distortion: grit,
            bitcrusher: lofi,
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
    void e;
    setPressed((p) => ({ ...p, [note]: true }));
    const playNote = lockToScale(note);
    activeNotes.current[note] = playNote;
    noteRef.current?.triggerAttack(playNote);
    const t = nextGridTime(subdiv);

    if (record) {
      const pitch =
        Tone.Frequency(playNote).toMidi() - Tone.Frequency("C4").toMidi();
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
              muted: false,
              pattern: {
                id: `kb-${Date.now()}`,
                name: "Keyboard",
                instrument: "chord",
                steps,
                velocities,
                pitches,
                note: "C4",
                sustain: release,
                attack,
                glide,
                pan,
                reverb: space,
                delay: space,
                distortion: grit,
                bitcrusher: lofi,
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
              sustain: release,
              attack,
              glide,
              pan,
              reverb: space,
              delay: space,
              distortion: grit,
              bitcrusher: lofi,
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
            pattern: {
              ...pattern,
              steps,
              velocities,
              pitches,
              sustain: release,
              attack,
              glide,
              pan,
              reverb: space,
              delay: space,
              distortion: grit,
              bitcrusher: lofi,
            },
          };
        });
      });
    }
  };

  const handleUp = (note: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setPressed((p) => ({ ...p, [note]: false }));
    const playNote = activeNotes.current[note];
    if (playNote) {
      if (sustainPedal) {
        sustained.current.add(playNote);
      } else {
        noteRef.current?.triggerRelease(playNote);
      }
      delete activeNotes.current[note];
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
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
      <div style={{ display: "flex", gap: 8 }}>
        <div
          style={{
            flex: 1,
            position: "relative",
            height: 160,
            touchAction: "pan-y",
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
                onPointerLeave={handleUp(note)}
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
                  touchAction: "pan-y",
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
                onPointerLeave={handleUp(note)}
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
                  touchAction: "pan-y",
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
              touchAction: "pan-y",
            }}
          />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div style={{ flex: "1 0 45%" }}>
          <label>Fade In</label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={attack}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setAttack(val);
              noteRef.current?.set({ envelope: { attack: val } });
            }}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ flex: "1 0 45%" }}>
          <label>Fade Out</label>
          <input
            type="range"
            min={0}
            max={5}
            step={0.05}
            value={release}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setRelease(val);
              noteRef.current?.set({ envelope: { release: val } });
            }}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ flex: "1 0 45%" }}>
          <label>Glide</label>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={glide}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setGlide(val);
              noteRef.current?.set({ portamento: val });
            }}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ flex: "1 0 45%" }}>
          <label>Pan</label>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={pan}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setPan(val);
              fxRef.current?.panner.pan.rampTo(val, 0.1);
            }}
            style={{ width: "100%" }}
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: 24,
            flex: "1 0 100%",
            justifyContent: "space-around",
            marginTop: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <label>Space</label>
            <Knob
              min={0}
              max={1}
              step={0.01}
              value={space}
              onChange={(val) => {
                setSpace(val);
                if (fxRef.current) {
                  fxRef.current.reverb.wet.value = val;
                  fxRef.current.delay.wet.value = val;
                }
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <label>Grit</label>
            <Knob
              min={0}
              max={1}
              step={0.01}
              value={grit}
              onChange={(val) => {
                setGrit(val);
                if (fxRef.current) fxRef.current.distortion.distortion = val;
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <label>Lo-fi</label>
            <Knob
              min={0}
              max={1}
              step={0.01}
              value={lofi}
              onChange={(val) => {
                setLofi(val);
                if (fxRef.current) fxRef.current.bitCrusher.wet.value = val;
              }}
            />
          </div>
        </div>
        <div style={{ flex: "1 0 45%" }}>
          <button
            onClick={toggleSustain}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #333",
              background: sustainPedal ? "#27E0B0" : "#1f2532",
              color: sustainPedal ? "#1F2532" : "#e6f2ff",
            }}
          >
            Sustain
          </button>
        </div>
        <div style={{ flex: "1 0 45%" }}>
          <label>Scale</label>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value as Scale)}
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 8,
              background: "#121827",
              color: "white",
            }}
          >
            <option value="Major">Major</option>
            <option value="Minor">Minor</option>
            <option value="Pentatonic">Pentatonic</option>
            <option value="Chromatic">Chromatic</option>
          </select>
        </div>
        <div style={{ flex: "1 0 45%" }}>
          <label>Preset</label>
          <select
            value={preset}
            onChange={(e) => {
              const name = e.target.value;
              setPreset(name);
              const p = presets.find((pr) => pr.name === name);
              if (p) {
                if (p.attack !== undefined) {
                  setAttack(p.attack);
                  noteRef.current?.set({ envelope: { attack: p.attack } });
                }
                if (p.release !== undefined) {
                  setRelease(p.release);
                  noteRef.current?.set({ envelope: { release: p.release } });
                }
                if (p.reverb !== undefined) {
                  setSpace(p.reverb);
                  if (fxRef.current) fxRef.current.reverb.wet.value = p.reverb;
                }
                if (p.delay !== undefined) {
                  if (fxRef.current) fxRef.current.delay.wet.value = p.delay;
                } else if (p.reverb !== undefined) {
                  if (fxRef.current) fxRef.current.delay.wet.value = p.reverb;
                }
                if (p.distortion !== undefined) {
                  setGrit(p.distortion);
                  if (fxRef.current) fxRef.current.distortion.distortion = p.distortion;
                }
                if (p.bitcrusher !== undefined) {
                  setLofi(p.bitcrusher);
                  if (fxRef.current) fxRef.current.bitCrusher.wet.value = p.bitcrusher;
                }
                if (p.chorus !== undefined) {
                  if (fxRef.current) fxRef.current.chorus.wet.value = p.chorus;
                }
                if (p.tremolo !== undefined) {
                  if (fxRef.current) fxRef.current.tremolo.wet.value = p.tremolo;
                }
                if (p.filterCutoff !== undefined) {
                  if (fxRef.current) fxRef.current.filter.frequency.value = p.filterCutoff;
                }
              }
            }}
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 8,
              background: "#121827",
              color: "white",
            }}
          >
            <option value="Custom">Custom</option>
            {presets.map((pr) => (
              <option key={pr.name} value={pr.name}>
                {pr.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}


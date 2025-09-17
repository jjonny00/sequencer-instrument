import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import * as Tone from "tone";
import presets from "./keyboardPresets.json";
import type { Track } from "./tracks";
import type { Chunk } from "./chunks";
import {
  filterValueToFrequency,
  frequencyToFilterValue,
} from "./utils/audio";

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
type ArpMode = "off" | "up" | "down" | "up-down" | "random";
type ArpRate = "1/4" | "1/8" | "1/16" | "1/32";

interface SectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function Section({ title, isOpen, onToggle, children }: SectionProps) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid #2a3344",
        background: "#121827",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          color: "#e6f2ff",
          fontWeight: 600,
          letterSpacing: 0.4,
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          {isOpen ? "▴" : "▾"}
        </span>
      </button>
      {isOpen ? (
        <div
          style={{
            padding: "0 16px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  disabled?: boolean;
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  disabled,
}: SliderFieldProps) {
  const display = formatValue
    ? formatValue(value)
    : value % 1 === 0
      ? value.toFixed(0)
      : value.toFixed(2);
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(event.target.value));
  };
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
        color: disabled ? "#475569" : "#e6f2ff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 600,
        }}
      >
        <span>{label}</span>
        <span style={{ color: "#94a3b8" }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        style={{
          width: "100%",
          accentColor: "#27E0B0",
          opacity: disabled ? 0.5 : 1,
        }}
      />
    </label>
  );
}

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
  const MIN_OCTAVE = 1;
  const MAX_OCTAVE = 7;

  const [octave, setOctave] = useState(4);
  const rootNote = useMemo(() => `C${octave}`, [octave]);
  const notes = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) =>
        Tone.Frequency(rootNote).transpose(i).toNote()
      ),
    [rootNote]
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
  const [reverb, setReverb] = useState(0);
  const [delay, setDelay] = useState(0);
  const [drive, setDrive] = useState(0);
  const [lofi, setLofi] = useState(0);
  const [chorus, setChorus] = useState(0);
  const [filter, setFilter] = useState(1);
  const [pan, setPan] = useState(0);
  const [sustainPedal, setSustainPedal] = useState(false);
  const [scale, setScale] = useState<Scale>("Chromatic");
  const [preset, setPreset] = useState("Custom");
  const [record, setRecord] = useState(false);
  const [sections, setSections] = useState({
    main: true,
    fx: false,
    arp: false,
  });
  const [isKeyboardExpanded, setKeyboardExpanded] = useState(false);
  const [arpMode, setArpMode] = useState<ArpMode>("off");
  const [arpRate, setArpRate] = useState<ArpRate>("1/16");
  const [arpGate, setArpGate] = useState(0.6);
  const [arpLatch, setArpLatch] = useState(false);
  const [arpOctaveRange, setArpOctaveRange] = useState(1);

  const trackIdRef = useRef<number | null>(null);
  const activeNotes = useRef<Record<string, string>>({});
  const sustained = useRef<Set<string>>(new Set());

  const scales: Record<Scale, number[]> = {
    Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    Major: [0, 2, 4, 5, 7, 9, 11],
    Minor: [0, 2, 3, 5, 7, 8, 10],
    Pentatonic: [0, 2, 4, 7, 9],
  };

  const toggleSection = (key: keyof typeof sections) => {
    setSections((prev) => {
      const nextValue = !prev[key];
      if (nextValue) {
        return { main: key === "main", fx: key === "fx", arp: key === "arp" };
      }
      return { ...prev, [key]: nextValue };
    });
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
    setSustainPedal((previous) => {
      if (previous) {
        sustained.current.forEach((noteName) =>
          noteRef.current?.triggerRelease(noteName)
        );
        sustained.current.clear();
      }
      return !previous;
    });
  };

  const incrementOctave = () => {
    setOctave((value) => Math.min(MAX_OCTAVE, value + 1));
  };

  const decrementOctave = () => {
    setOctave((value) => Math.max(MIN_OCTAVE, value - 1));
  };

  useEffect(() => {
    if (!record) {
      trackIdRef.current = null;
    }
  }, [record]);

  useEffect(() => {
    const active = Object.values(activeNotes.current);
    if (active.length === 0 && sustained.current.size === 0) {
      return;
    }
    active.forEach((noteName) => noteRef.current?.triggerRelease(noteName));
    activeNotes.current = {};
    sustained.current.forEach((noteName) =>
      noteRef.current?.triggerRelease(noteName)
    );
    sustained.current.clear();
    setPressed({});
  }, [rootNote, noteRef]);

  useEffect(() => {
    if (!isKeyboardExpanded || typeof document === "undefined") {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isKeyboardExpanded]);

  const applySettings = (pattern: Chunk, baseNote: string): Chunk => {
    const rest = { ...pattern } as Chunk;
    delete (rest as Partial<Chunk>).style;
    const next: Chunk = {
      ...rest,
      note: baseNote,
      sustain: release,
      attack,
      glide,
      pan,
      reverb,
      delay,
      distortion: drive,
      bitcrusher: lofi,
      filter,
      chorus,
      arpRate,
      arpGate,
      arpLatch,
      arpOctaves: arpOctaveRange,
      mode: arpLatch ? "continuous" : "manual",
    };
    const styleValue = arpMode === "off" ? undefined : arpMode;
    if (styleValue) {
      next.style = styleValue;
    }
    return next;
  };

  const addTrack = () => {
    setTracks((tracks) => {
      const nextId = tracks.length
        ? Math.max(...tracks.map((track) => track.id)) + 1
        : 1;
      const steps = Array(16).fill(0);
      const velocities = Array(16).fill(1);
      const pitches = Array(16).fill(0);
      const label = (tracks.length + 1).toString().padStart(2, "0");
      trackIdRef.current = nextId;
      const basePattern: Chunk = {
        id: `kb-${Date.now()}`,
        name: `Track ${label} Pattern`,
        instrument: "chord",
        steps,
        velocities,
        pitches,
      };
      const pattern = applySettings(basePattern, rootNote);
      return [
        ...tracks,
        {
          id: nextId,
          name: label,
          instrument: "chord",
          muted: false,
          pattern,
        },
      ];
    });
  };

  const handleDown = (note: string) => (
    event: PointerEvent<HTMLDivElement>
  ) => {
    void event;
    setPressed((previous) => ({ ...previous, [note]: true }));
    const playNote = lockToScale(note);
    activeNotes.current[note] = playNote;
    noteRef.current?.triggerAttack(playNote);
    const targetTime = nextGridTime(subdiv);

    if (record) {
      const pitch =
        Tone.Frequency(playNote).toMidi() -
        Tone.Frequency(rootNote).toMidi();
      const ticks = Tone.Transport.getTicksAtTime(targetTime);
      const stepIndex =
        Math.floor(ticks / (Tone.Transport.PPQ / 4)) % 16;

      setTracks((tracks) => {
        let trackId = trackIdRef.current;
        if (trackId === null) {
          trackId = tracks.length
            ? Math.max(...tracks.map((track) => track.id)) + 1
            : 1;
          trackIdRef.current = trackId;
          const steps = Array(16).fill(0);
          const velocities = Array(16).fill(1);
          const pitches = Array(16).fill(0);
          steps[stepIndex] = 1;
          velocities[stepIndex] = 1;
          pitches[stepIndex] = pitch;
          const label = (tracks.length + 1).toString().padStart(2, "0");
          const basePattern: Chunk = {
            id: `kb-${Date.now()}`,
            name: `Track ${label} Pattern`,
            instrument: "chord",
            steps,
            velocities,
            pitches,
          };
          const pattern = applySettings(basePattern, rootNote);
          return [
            ...tracks,
            {
              id: trackId,
              name: label,
              instrument: "chord",
              muted: false,
              pattern,
            },
          ];
        }

        return tracks.map((track) => {
          if (track.id !== trackId) return track;
          const label = /^\d+$/.test(track.name)
            ? track.name
            : (() => {
                const index = tracks.findIndex(
                  (candidate) => candidate.id === track.id
                );
                const number = index >= 0 ? index + 1 : track.id;
                return number.toString().padStart(2, "0");
              })();
          const basePattern: Chunk =
            track.pattern ??
            {
              id: `kb-${Date.now()}`,
              name: `Track ${label} Pattern`,
              instrument: "chord",
              steps: Array(16).fill(0),
              velocities: Array(16).fill(1),
              pitches: Array(16).fill(0),
            };
          const steps = basePattern.steps.slice();
          const velocities = (basePattern.velocities ?? Array(16).fill(1)).slice();
          const pitches = (basePattern.pitches ?? Array(16).fill(0)).slice();
          steps[stepIndex] = 1;
          velocities[stepIndex] = 1;
          pitches[stepIndex] = pitch;
          const patternWithoutStyle = { ...basePattern } as Chunk;
          delete (patternWithoutStyle as Partial<Chunk>).style;
          const patternWithSteps: Chunk = {
            ...patternWithoutStyle,
            steps,
            velocities,
            pitches,
          };
          const pattern = applySettings(patternWithSteps, rootNote);
          return {
            ...track,
            pattern,
          };
        });
      });
    }
  };

  const handleUp = (note: string) => (
    event: PointerEvent<HTMLDivElement>
  ) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setPressed((previous) => ({ ...previous, [note]: false }));
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

  const renderKeyboardSurface = (height: number | string) => {
    const resolvedHeight =
      typeof height === "number" ? `${height}px` : height;
    return (
      <div
        style={{
          display: "flex",
          gap: 8,
          height: resolvedHeight,
        }}
      >
        <div
          style={{
            flex: 1,
            position: "relative",
            height: resolvedHeight,
            touchAction: "pan-y",
            userSelect: "none",
            minWidth: 0,
            background: "#fff",
            borderRadius: 8,
            boxShadow: "inset 0 0 0 1px #1f2532",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", height: "100%" }}>
            {whiteNotes.map((noteName, index) => (
              <div
                key={noteName}
                onPointerDown={handleDown(noteName)}
                onPointerUp={handleUp(noteName)}
                onPointerCancel={handleUp(noteName)}
                onPointerLeave={handleUp(noteName)}
                style={{
                  flex: 1,
                  borderRight: "1px solid #333",
                  borderLeft: index === 0 ? "1px solid #333" : "none",
                  borderBottom: "1px solid #333",
                  background: pressed[noteName] ? "#e2e8f0" : "#fff",
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  touchAction: "pan-y",
                }}
              >
                {noteName}
              </div>
            ))}
          </div>
          {notes.map((noteName, index) => {
            if (!isSharp(noteName)) return null;
            const whiteCount = notes
              .slice(0, index)
              .filter((candidate) => !isSharp(candidate)).length;
            const left = whiteCount * whiteWidth - blackWidth / 2;
            return (
              <div
                key={noteName}
                onPointerDown={handleDown(noteName)}
                onPointerUp={handleUp(noteName)}
                onPointerCancel={handleUp(noteName)}
                onPointerLeave={handleUp(noteName)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: `${left}%`,
                  width: `${blackWidth}%`,
                  height: "60%",
                  background: pressed[noteName] ? "#64748b" : "#1f2532",
                  color: "#fff",
                  border: "1px solid #111827",
                  borderRadius: "0 0 4px 4px",
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  touchAction: "pan-y",
                }}
              >
                {noteName}
              </div>
            );
          })}
        </div>
        <div
          style={{
            width: 48,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            height: resolvedHeight,
          }}
        >
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Pitch</span>
          <input
            type="range"
            min={-1200}
            max={1200}
            step={1}
            value={bend}
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              setBend(value);
              const synth = noteRef.current as unknown as {
                detune: Tone.Signal;
              };
              synth?.detune.rampTo(value, 0.05);
            }}
            onInput={(event) => {
              const value = parseInt((event.target as HTMLInputElement).value, 10);
              setBend(value);
              const synth = noteRef.current as unknown as {
                detune: Tone.Signal;
              };
              synth?.detune.rampTo(value, 0.05);
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
              height: "100%",
              writingMode: "vertical-rl",
              WebkitAppearance: "slider-vertical",
              touchAction: "pan-y",
            }}
          />
        </div>
      </div>
    );
  };

  const expandedKeyboard =
    isKeyboardExpanded && typeof document !== "undefined"
      ? createPortal(
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(8, 12, 20, 0.95)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                padding: 16,
              }}
            >
              <button
                type="button"
                onClick={() => setKeyboardExpanded(false)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: "1px solid #333",
                  background: "#1f2532",
                  color: "#e6f2ff",
                  fontWeight: 600,
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "min(100vh, 720px)",
                  height: "min(100vw, 420px)",
                  transform: "rotate(90deg)",
                  transformOrigin: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    padding: 16,
                  }}
                >
                  {renderKeyboardSurface("100%")}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <button
          type="button"
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
          New Track
        </button>
        <button
          type="button"
          onClick={() => setRecord((value) => !value)}
          aria-pressed={record}
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
        <button
          type="button"
          onClick={() => setKeyboardExpanded(true)}
          disabled={isKeyboardExpanded}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #333",
            background: isKeyboardExpanded ? "#1b2332" : "#1f2532",
            color: isKeyboardExpanded ? "#475569" : "#e6f2ff",
            cursor: isKeyboardExpanded ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Expand Keyboard
        </button>
        <button
          type="button"
          onClick={toggleSustain}
          aria-pressed={sustainPedal}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #333",
            background: sustainPedal ? "#27E0B0" : "#1f2532",
            color: sustainPedal ? "#1F2532" : "#e6f2ff",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Sustain
        </button>
      </div>

      <div style={{ display: isKeyboardExpanded ? "none" : "block" }}>
        {renderKeyboardSurface(160)}
      </div>

      <Section
        title="Main"
        isOpen={sections.main}
        onToggle={() => toggleSection("main")}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <label
            style={{
              flex: "1 1 160px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>Preset</span>
            <select
              value={preset}
              onChange={(event) => {
                const name = event.target.value;
                setPreset(name);
                if (name === "Custom") return;
                const presetDefinition = presets.find(
                  (entry) => entry.name === name
                );
                if (!presetDefinition) return;
                if (presetDefinition.attack !== undefined) {
                  setAttack(presetDefinition.attack);
                  noteRef.current?.set({
                    envelope: { attack: presetDefinition.attack },
                  });
                }
                if (presetDefinition.release !== undefined) {
                  setRelease(presetDefinition.release);
                  noteRef.current?.set({
                    envelope: { release: presetDefinition.release },
                  });
                }
                if (presetDefinition.reverb !== undefined) {
                  setReverb(presetDefinition.reverb);
                  fxRef.current?.reverb.wet.value = presetDefinition.reverb;
                }
                const nextDelay =
                  presetDefinition.delay !== undefined
                    ? presetDefinition.delay
                    : presetDefinition.reverb ?? 0;
                setDelay(nextDelay);
                if (fxRef.current) {
                  fxRef.current.delay.wet.value = nextDelay;
                }
                if (presetDefinition.distortion !== undefined) {
                  setDrive(presetDefinition.distortion);
                  if (fxRef.current) {
                    fxRef.current.distortion.distortion =
                      presetDefinition.distortion;
                  }
                }
                if (presetDefinition.bitcrusher !== undefined) {
                  setLofi(presetDefinition.bitcrusher);
                  if (fxRef.current) {
                    fxRef.current.bitCrusher.wet.value =
                      presetDefinition.bitcrusher;
                  }
                }
                if (presetDefinition.chorus !== undefined) {
                  setChorus(presetDefinition.chorus);
                  if (fxRef.current) {
                    fxRef.current.chorus.wet.value = presetDefinition.chorus;
                  }
                }
                if (presetDefinition.filterCutoff !== undefined) {
                  const normalized = frequencyToFilterValue(
                    presetDefinition.filterCutoff
                  );
                  setFilter(normalized);
                  fxRef.current?.filter.frequency.rampTo(
                    presetDefinition.filterCutoff,
                    0.1
                  );
                }
              }}
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 8,
                border: "1px solid #333",
                background: "#121827",
                color: "#e6f2ff",
              }}
            >
              <option value="Custom">Custom</option>
              {presets.map((presetOption) => (
                <option key={presetOption.name} value={presetOption.name}>
                  {presetOption.name}
                </option>
              ))}
            </select>
          </label>
          <label
            style={{
              flex: "1 1 160px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>Scale</span>
            <select
              value={scale}
              onChange={(event) =>
                setScale(event.target.value as Scale)
              }
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 8,
                border: "1px solid #333",
                background: "#121827",
                color: "#e6f2ff",
              }}
            >
              <option value="Major">Major</option>
              <option value="Minor">Minor</option>
              <option value="Pentatonic">Pentatonic</option>
              <option value="Chromatic">Chromatic</option>
            </select>
          </label>
          <div
            style={{
              flex: "1 1 140px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              color: "#e6f2ff",
            }}
          >
            <span style={{ fontWeight: 600 }}>Octave</span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={decrementOctave}
                disabled={octave <= MIN_OCTAVE}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: octave <= MIN_OCTAVE ? "#1b2332" : "#1f2532",
                  color: octave <= MIN_OCTAVE ? "#475569" : "#e6f2ff",
                  cursor: octave <= MIN_OCTAVE ? "default" : "pointer",
                  fontSize: 18,
                }}
              >
                –
              </button>
              <div
                style={{
                  minWidth: 52,
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                {rootNote}
              </div>
              <button
                type="button"
                onClick={incrementOctave}
                disabled={octave >= MAX_OCTAVE}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: octave >= MAX_OCTAVE ? "#1b2332" : "#1f2532",
                  color: octave >= MAX_OCTAVE ? "#475569" : "#e6f2ff",
                  cursor: octave >= MAX_OCTAVE ? "default" : "pointer",
                  fontSize: 18,
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="FX"
        isOpen={sections.fx}
        onToggle={() => toggleSection("fx")}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <SliderField
            label="Filter"
            value={filter}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => {
              setFilter(value);
              const frequency = filterValueToFrequency(value);
              fxRef.current?.filter.frequency.rampTo(frequency, 0.1);
            }}
            formatValue={(value) =>
              `${Math.round(filterValueToFrequency(value))} Hz`
            }
          />
          <SliderField
            label="Reverb"
            value={reverb}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => {
              setReverb(value);
              if (fxRef.current) {
                fxRef.current.reverb.wet.value = value;
              }
            }}
            formatValue={(value) => `${Math.round(value * 100)}%`}
          />
          <SliderField
            label="Delay"
            value={delay}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => {
              setDelay(value);
              if (fxRef.current) {
                fxRef.current.delay.wet.value = value;
              }
            }}
            formatValue={(value) => `${Math.round(value * 100)}%`}
          />
          <SliderField
            label="Glide"
            value={glide}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(value) => {
              setGlide(value);
              noteRef.current?.set({ portamento: value });
            }}
            formatValue={(value) => `${value.toFixed(2)}s`}
          />
          <SliderField
            label="Chorus"
            value={chorus}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => {
              setChorus(value);
              if (fxRef.current) {
                fxRef.current.chorus.wet.value = value;
              }
            }}
            formatValue={(value) => `${Math.round(value * 100)}%`}
          />
          <SliderField
            label="Drive"
            value={drive}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => {
              setDrive(value);
              if (fxRef.current) {
                fxRef.current.distortion.distortion = value;
              }
            }}
            formatValue={(value) => `${Math.round(value * 100)}%`}
          />
          <SliderField
            label="Fade In"
            value={attack}
            min={0}
            max={2}
            step={0.01}
            onChange={(value) => {
              setAttack(value);
              noteRef.current?.set({ envelope: { attack: value } });
            }}
            formatValue={(value) => `${value.toFixed(2)}s`}
          />
          <SliderField
            label="Fade Out"
            value={release}
            min={0}
            max={5}
            step={0.05}
            onChange={(value) => {
              setRelease(value);
              noteRef.current?.set({ envelope: { release: value } });
            }}
            formatValue={(value) => `${value.toFixed(2)}s`}
          />
          <SliderField
            label="Pan"
            value={pan}
            min={-1}
            max={1}
            step={0.01}
            onChange={(value) => {
              setPan(value);
              fxRef.current?.panner.pan.rampTo(value, 0.1);
            }}
            formatValue={(value) => value.toFixed(2)}
          />
          <SliderField
            label="Lo-fi"
            value={lofi}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => {
              setLofi(value);
              if (fxRef.current) {
                fxRef.current.bitCrusher.wet.value = value;
              }
            }}
            formatValue={(value) => `${Math.round(value * 100)}%`}
          />
        </div>
      </Section>

      <Section
        title="Arp"
        isOpen={sections.arp}
        onToggle={() => toggleSection("arp")}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <label
            style={{
              flex: "1 1 140px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>Mode</span>
            <select
              value={arpMode}
              onChange={(event) =>
                setArpMode(event.target.value as ArpMode)
              }
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 8,
                border: "1px solid #333",
                background: "#121827",
                color: "#e6f2ff",
              }}
            >
              <option value="off">Off</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="up-down">Up & Down</option>
              <option value="random">Random</option>
            </select>
          </label>
          <label
            style={{
              flex: "1 1 140px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 600 }}>Rate</span>
            <select
              value={arpRate}
              onChange={(event) =>
                setArpRate(event.target.value as ArpRate)
              }
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 8,
                border: "1px solid #333",
                background: "#121827",
                color: "#e6f2ff",
              }}
            >
              <option value="1/4">1/4</option>
              <option value="1/8">1/8</option>
              <option value="1/16">1/16</option>
              <option value="1/32">1/32</option>
            </select>
          </label>
          <SliderField
            label="Gate"
            value={arpGate}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(value) => setArpGate(value)}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            disabled={arpMode === "off"}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              color: arpMode === "off" ? "#475569" : "#e6f2ff",
            }}
          >
            <span style={{ fontWeight: 600 }}>Latch</span>
            <button
              type="button"
              onClick={() => setArpLatch((value) => !value)}
              disabled={arpMode === "off"}
              aria-pressed={arpLatch}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #333",
                background:
                  arpLatch && arpMode !== "off" ? "#27E0B0" : "#1f2532",
                color:
                  arpLatch && arpMode !== "off" ? "#1F2532" : "#e6f2ff",
                cursor: arpMode === "off" ? "not-allowed" : "pointer",
              }}
            >
              {arpLatch ? "Enabled" : "Disabled"}
            </button>
          </div>
          <SliderField
            label="Octave Range"
            value={arpOctaveRange}
            min={1}
            max={4}
            step={1}
            onChange={(value) => setArpOctaveRange(Math.round(value))}
            formatValue={(value) => `${Math.round(value)}`}
            disabled={arpMode === "off"}
          />
        </div>
      </Section>

      {expandedKeyboard}
    </div>
  );
}

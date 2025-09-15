import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";

import { LoopStrip } from "./LoopStrip";
import type { Track, TriggerMap } from "./tracks";
import { getNote } from "./notes";
import { packs } from "./packs";
import { Arpeggiator } from "./Arpeggiator";
import { Keyboard } from "./Keyboard";

type Subdivision = "16n" | "8n" | "4n";

function nextGridTime(subdivision: Subdivision): number {
  // Current musical time → next grid boundary in seconds
  const now = Tone.now();
  const pos = Tone.Transport.seconds; // current transport time in seconds
  const dur = Tone.Time(subdivision).toSeconds();
  const next = Math.ceil(pos / dur) * dur;
  // If we're extremely close to the boundary, hop one more grid to avoid double-firing
  const epsilon = 0.001;
  const target = next - pos < epsilon ? next + dur : next;
  // Return *absolute* time (audio clock), not transport time
  return now + (target - pos);
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [subdiv, setSubdiv] = useState<Subdivision>("16n");
  const [isPlaying, setIsPlaying] = useState(false);
  const [packIndex, setPackIndex] = useState(0);

  // Instruments (kept across renders)
  type ToneInstrument = {
    triggerAttackRelease: (...args: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    dispose?: () => void;
    toDestination: () => ToneInstrument;
  };
  const instrumentRefs = useRef<Record<string, ToneInstrument>>({});
  const noteRef = useRef<Tone.PolySynth<Tone.Synth> | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [triggers, setTriggers] = useState<TriggerMap>({});
  const [tab, setTab] = useState<"arp" | "keyboard">("arp");

  useEffect(() => {
    if (started) Tone.Transport.bpm.value = bpm;
  }, [bpm, started]);

  useEffect(() => {
    const pack = packs[packIndex];
    setTracks(
      Object.keys(pack.instruments).map((name, i) => ({
        id: i + 1,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        instrument: name as keyof TriggerMap,
        pattern: null,
      }))
    );
    setEditing(null);
    if (!started) return;
    Object.values(instrumentRefs.current).forEach((inst) => inst.dispose?.());
    instrumentRefs.current = {};
    const newTriggers: TriggerMap = {};
    Object.entries(pack.instruments).forEach(([name, spec]) => {
      const Ctor = (Tone as unknown as Record<string, new () => ToneInstrument>)[
        spec.type
      ];
      const inst = new Ctor().toDestination();
      instrumentRefs.current[name] = inst;
      newTriggers[name] = (
        time: number,
        velocity = 1,
        pitch = 0,
      ) => {
        if (inst instanceof Tone.NoiseSynth) {
          inst.triggerAttackRelease(spec.note ?? "8n", time, velocity);
        } else {
          const base = spec.note ?? "C2";
          const note = Tone.Frequency(base).transpose(pitch).toNote();
          inst.triggerAttackRelease(note, "8n", time, velocity);
        }
      };
    });
    const chord = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.4 },
    }).toDestination();
    instrumentRefs.current["chord"] = chord;
    newTriggers["chord"] = (
      time: number,
      velocity = 1,
      pitch = 0,
      note = "C4",
      sustain = 0.1
    ) => {
      const n = Tone.Frequency(note).transpose(pitch).toNote();
      chord.triggerAttackRelease(n, sustain, time, velocity);
    };
    setTriggers(newTriggers);
  }, [packIndex, started]);

  const initAudioGraph = async () => {
    await Tone.start(); // iOS unlock
    noteRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.4 },
    }).toDestination();

    Tone.Transport.bpm.value = bpm;
    Tone.Transport.start(); // start clock; we’ll schedule to it
    setStarted(true);
    setIsPlaying(true);
  };

  const scheduleNote = (note: string) => {
    const t = nextGridTime(subdiv);
    noteRef.current?.triggerAttackRelease(note, "8n", t);
    flashAt(t);
  };

  // Simple visual feedback: briefly highlight the page when a scheduled note fires
  const [flash, setFlash] = useState(false);
  const flashAt = (absTime: number) => {
    const now = Tone.now();
    const ms = Math.max(0, (absTime - now) * 1000);
    window.setTimeout(() => {
      setFlash(true);
      window.setTimeout(() => setFlash(false), 60);
    }, ms);
  };

  const Pad = (props: { label: string; onTap: () => void }) => {
    const [pressed, setPressed] = useState(false);
    return (
      <button
        onPointerDown={() => {
          setPressed(true);
          props.onTap();
        }}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 16,
          fontSize: "1.1rem",
          border: "1px solid #333",
          background: pressed ? "#30394f" : "#1f2532",
          color: "#e6f2ff"
        }}
      >
        {props.label}
      </button>
    );
  };

  return (
    <div
      style={{
        height: "100dvh",
        minHeight: "100dvh",
        paddingBottom: "env(safe-area-inset-bottom)",
        boxSizing: "border-box",
        background: flash ? "#202a40" : "#0f1420",
        transition: "background 80ms linear",
        color: "#e6f2ff",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        display: "flex",
        flexDirection: "column"
      }}
    >
      {!started ? (
        <div style={{ display: "grid", placeItems: "center", flex: 1 }}>
          <button
            onClick={initAudioGraph}
            style={{
              padding: "16px 24px",
              fontSize: "1.25rem",
              borderRadius: 9999,
              border: "1px solid #333",
              background: "#27E0B0",
              color: "#1F2532"
            }}
          >
            Start Jam
          </button>
        </div>
      ) : (
        <>
          <LoopStrip
            started={started}
            isPlaying={isPlaying}
            tracks={tracks}
            triggers={triggers}
            editing={editing}
            setEditing={setEditing}
            setTracks={setTracks}
            packIndex={packIndex}
            setPackIndex={setPackIndex}
          />
          <div style={{ padding: 16, paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flex: 1,
                }}
              >
                {editing !== null ? (
                  <button
                    onClick={() => setEditing(null)}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 4,
                      border: "1px solid #333",
                      background: "#27E0B0",
                      color: "#1F2532",
                      cursor: "pointer",
                    }}
                  >
                    Done
                  </button>
                ) : (
                  <>
                    <label>BPM</label>
                    <select
                      value={bpm}
                      onChange={(e) => setBpm(parseInt(e.target.value, 10))}
                      style={{
                        padding: 8,
                        borderRadius: 8,
                        background: "#121827",
                        color: "white",
                      }}
                    >
                      {[90, 100, 110, 120, 130].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <label style={{ marginLeft: 12 }}>Quantize</label>
                    <select
                      value={subdiv}
                      onChange={(e) =>
                        setSubdiv(e.target.value as Subdivision)
                      }
                      style={{
                        padding: 8,
                        borderRadius: 8,
                        background: "#121827",
                        color: "white",
                      }}
                    >
                      <option value="16n">1/16</option>
                      <option value="8n">1/8</option>
                      <option value="4n">1/4</option>
                    </select>
                  </>
                )}
              </div>
              <div
                style={{
                  width: 1,
                  height: 24,
                  background: "#333",
                  margin: "0 12px",
                }}
              />
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  aria-label={isPlaying ? "Pause" : "Play"}
                  onPointerDown={() => {
                    if (isPlaying) {
                      Tone.Transport.pause();
                    } else {
                      Tone.Transport.start();
                    }
                    setIsPlaying(!isPlaying);
                  }}
                  onPointerUp={(e) => e.currentTarget.blur()}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#27E0B0",
                    color: "#1F2532",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                  }}
                >
                  <span className="material-symbols-outlined">
                    {isPlaying ? "pause" : "play_arrow"}
                  </span>
                </button>
                <button
                  aria-label="Stop"
                  onPointerDown={() => {
                    Tone.Transport.stop();
                    setIsPlaying(false);
                  }}
                  onPointerUp={(e) => e.currentTarget.blur()}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#E02749",
                    color: "#e6f2ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 40,
                    padding: 0,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ lineHeight: 1, width: "100%", height: "100%" }}
                  >
                    stop
                  </span>
                </button>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                  maxWidth: 600,
                  margin: "0 auto",
                }}
              >
                <Pad label="Low" onTap={() => scheduleNote(getNote("low"))} />
                <Pad label="Mid" onTap={() => scheduleNote(getNote("mid"))} />
                <Pad label="High" onTap={() => scheduleNote(getNote("high"))} />
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => setTab("arp")}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 8,
                      border: "1px solid #333",
                      background: tab === "arp" ? "#27E0B0" : "#1f2532",
                      color: tab === "arp" ? "#1F2532" : "#e6f2ff",
                    }}
                  >
                    Arp
                  </button>
                  <button
                    onClick={() => setTab("keyboard")}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 8,
                      border: "1px solid #333",
                      background: tab === "keyboard" ? "#27E0B0" : "#1f2532",
                      color: tab === "keyboard" ? "#1F2532" : "#e6f2ff",
                    }}
                  >
                    Keyboard
                  </button>
                </div>
                {tab === "arp" ? (
                  <Arpeggiator
                    started={started}
                    subdiv={subdiv}
                    setTracks={setTracks}
                  />
                ) : (
                  <Keyboard subdiv={subdiv} noteRef={noteRef} />
                )}
              </div>
          </div>
        </>
      )}
    </div>
  );
}

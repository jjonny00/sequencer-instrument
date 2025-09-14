import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";

import { LoopStrip } from "./LoopStrip";
import type { Track, TriggerMap } from "./tracks";
import { getNote, type NoteName } from "./notes";
import { packs } from "./packs";

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
    triggerAttackRelease: (...args: unknown[]) => void;
    dispose?: () => void;
    toDestination: () => ToneInstrument;
  };
  const instrumentRefs = useRef<Record<string, ToneInstrument>>({});
  const noteRef = useRef<Tone.Synth | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [triggers, setTriggers] = useState<TriggerMap>({});

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
      newTriggers[name] = (time: number) => {
        if (inst instanceof Tone.NoiseSynth) {
          inst.triggerAttackRelease(spec.note ?? "8n", time);
        } else {
          inst.triggerAttackRelease(spec.note ?? "C2", "8n", time);
        }
      };
    });
    setTriggers(newTriggers);
  }, [packIndex, started]);

  const initAudioGraph = async () => {
    await Tone.start(); // iOS unlock
    noteRef.current = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.4 }
    }).toDestination();

    Tone.Transport.bpm.value = bpm;
    Tone.Transport.start(); // start clock; we’ll schedule to it
    setStarted(true);
    setIsPlaying(true);
  };

  const scheduleNote = (name: NoteName) => {
    const t = nextGridTime(subdiv);
    const note = getNote(name);
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
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <label>BPM</label>
              <select
                value={bpm}
                onChange={(e) => setBpm(parseInt(e.target.value, 10))}
                style={{ padding: 8, borderRadius: 8, background: "#121827", color: "white" }}
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
                onChange={(e) => setSubdiv(e.target.value as Subdivision)}
                style={{ padding: 8, borderRadius: 8, background: "#121827", color: "white" }}
              >
                <option value="16n">1/16</option>
                <option value="8n">1/8</option>
                <option value="4n">1/4</option>
              </select>
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
                  fontSize: 20
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
                  padding: 0
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

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
                maxWidth: 600,
                margin: "0 auto"
              }}
            >
              <Pad label="Low" onTap={() => scheduleNote("low")} />
              <Pad label="Mid" onTap={() => scheduleNote("mid")} />
              <Pad label="High" onTap={() => scheduleNote("high")} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

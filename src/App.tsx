import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";

import { LoopStrip } from "./LoopStrip";
import type { Track, TriggerMap } from "./tracks";

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

  // Instruments (kept across renders)
  const kickRef = useRef<Tone.MembraneSynth | null>(null);
  const snareRef = useRef<Tone.NoiseSynth | null>(null);
  const hatRef = useRef<Tone.MetalSynth | null>(null);
  const chordRef = useRef<Tone.PolySynth<Tone.Synth> | null>(null);

  const [tracks, setTracks] = useState<Track[]>([
    { id: 1, name: "Kick", instrument: "kick", pattern: null },
    { id: 2, name: "Snare", instrument: "snare", pattern: null },
  ]);
  const [editing, setEditing] = useState<number | null>(null);

  const triggers: TriggerMap = {
    kick: (time) =>
      kickRef.current?.triggerAttackRelease("C2", "8n", time),
    snare: (time) =>
      snareRef.current?.triggerAttackRelease("16n", time),
    hat: (time) => hatRef.current?.triggerAttackRelease("32n", time),
  };

  useEffect(() => {
    if (started) Tone.Transport.bpm.value = bpm;
  }, [bpm, started]);

  const initAudioGraph = async () => {
    await Tone.start(); // iOS unlock
    // Create instruments
    kickRef.current = new Tone.MembraneSynth({ pitchDecay: 0.02 }).toDestination();
    snareRef.current = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0 }
    }).toDestination();
    const hat = new Tone.MetalSynth().toDestination();
    hat.frequency.value = 350;                 // Signal
    hat.envelope.attack = 0.001;
    hat.envelope.decay = 0.1;
    hat.envelope.release = 0.01;
    hat.harmonicity = 5.1;
    hat.modulationIndex = 32;
    hat.resonance = 4000;
    hat.octaves = 1.5;
    hatRef.current = hat
  chordRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.4 }
    }).toDestination();

    Tone.Transport.bpm.value = bpm;
    Tone.Transport.start(); // start clock; we’ll schedule to it
    setStarted(true);
    setIsPlaying(true);
  };

  const scheduleKick = () => {
    const t = nextGridTime(subdiv);
    kickRef.current?.triggerAttackRelease("C2", "8n", t);
    flashAt(t);
  };
  const scheduleSnare = () => {
    const t = nextGridTime(subdiv);
    // short envelope for a snappy “snare”
    snareRef.current?.triggerAttackRelease("16n", t);
    flashAt(t);
  };
  const scheduleHat = () => {
    const t = nextGridTime(subdiv);
    hatRef.current?.triggerAttackRelease("32n", t);
    flashAt(t);
  };
  const scheduleChord = () => {
    const t = nextGridTime(subdiv);
    // Cmaj7 (C E G B) – simple, pleasant
    chordRef.current?.triggerAttackRelease(["C4", "E4", "G4", "B4"], "4n", t, 0.6);
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
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                maxWidth: 600,
                margin: "0 auto"
              }}
            >
              <Pad label="Kick" onTap={scheduleKick} />
              <Pad label="Snare" onTap={scheduleSnare} />
              <Pad label="Hat" onTap={scheduleHat} />
              <Pad label="Chord" onTap={scheduleChord} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

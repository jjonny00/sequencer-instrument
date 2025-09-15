import { useEffect, useRef, useState } from "react";
import * as Tone from "tone";

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
}: {
  started: boolean;
  subdiv: Subdivision;
}) {
  const [root, setRoot] = useState("C4");
  const [style, setStyle] = useState<ArpStyle>("up");
  const synthRef = useRef<Tone.Synth | null>(null);
  const loopRef = useRef<Tone.Loop | null>(null);
  const indexRef = useRef(0);
  const directionRef = useRef(1);

  useEffect(() => {
    if (!started) return;
    if (!synthRef.current) {
      synthRef.current = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.2, release: 0.4 },
      }).toDestination();
    }
    loopRef.current?.dispose();
    const intervals = [0, 4, 7, 12];
    const notes = intervals.map((i) =>
      Tone.Frequency(root).transpose(i).toNote()
    );
    indexRef.current = style === "down" ? notes.length - 1 : 0;
    directionRef.current = 1;
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
    }, subdiv).start(nextGridTime(subdiv));
    return () => {
      loopRef.current?.dispose();
    };
  }, [root, style, subdiv, started]);

  return (
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
    </div>
  );
}

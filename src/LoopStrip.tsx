import { useEffect, useState } from "react";
import * as Tone from "tone";
import type { Track } from "./Tracks";

/**
 * Top strip visualizing a 16-step loop.
 * - Occupies 25% of viewport height and full width.
 * - Displays 16 horizontal steps.
 * - Highlights the current step in sync with Tone.Transport.
 */
export function LoopStrip({
  started,
  isPlaying,
  tracks,
  editing,
  onSelectTrack,
}: {
  started: boolean;
  isPlaying: boolean;
  tracks: Track[];
  editing: number | null;
  onSelectTrack: (id: number) => void;
}) {
  const [step, setStep] = useState(0);

  // Schedule a step advance on each 16th note when audio has started.
  useEffect(() => {
    if (!started) return;
    const id = Tone.Transport.scheduleRepeat((time) => {
      Tone.Draw.schedule(() => {
        setStep((s) => (s + 1) % 16);
      }, time);
    }, "16n");
    return () => {
      Tone.Transport.clear(id);
    };
  }, [started]);

  // Reset playhead when transport stops or is paused.
  useEffect(() => {
    if (!isPlaying) setStep(0);
  }, [isPlaying]);

  return (
    <div
      style={{
        height: "25vh",
        width: "100%",
        background: "#2a2f3a",
        display: "flex",
        flexDirection: "column",
        padding: "8px",
        boxSizing: "border-box",
        gap: 4
      }}
    >
      {tracks.map((t) => (
        <div
          key={t.id}
          onClick={() => onSelectTrack(t.id)}
          style={{
            display: "flex",
            flex: 1,
            cursor: "pointer",
            opacity: editing !== null && editing !== t.id ? 0.3 : 1,
            border: editing === t.id ? "2px solid #27E0B0" : "1px solid #555"
          }}
        >
          <div
            style={{
              width: 60,
              borderRight: "1px solid #555",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 12
            }}
          >
            {t.name}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(16, 1fr)",
              gap: 2,
              flex: 1
            }}
          >
            {Array.from({ length: 16 }).map((_, i) => {
              const active = t.pattern?.steps[i] ?? 0;
              const isCurrent = i === step;
              return (
                <div
                  key={i}
                  style={{
                    border: "1px solid #555",
                    background: active ? "#27E0B0" : "#1f2532",
                    opacity: isCurrent ? 1 : 0.5,
                    transition: "opacity 60ms linear"
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

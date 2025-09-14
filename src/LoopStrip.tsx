import { useEffect, useState } from "react";
import * as Tone from "tone";

/**
 * Top strip visualizing a 16-step loop.
 * - Occupies 25% of viewport height and full width.
 * - Displays 16 horizontal steps.
 * - Highlights the current step in sync with Tone.Transport.
 */
export function LoopStrip({ started, isPlaying }: { started: boolean; isPlaying: boolean }) {
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
        alignItems: "center",
        padding: "0 8px",
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(16, 1fr)",
          gap: 4,
          width: "100%",
          height: "60%"
        }}
      >
        {Array.from({ length: 16 }).map((_, i) => (
          <div
            key={i}
            style={{
              border: "1px solid #555",
              background: i === step ? "#27E0B0" : "#1f2532",
              transition: "background 60ms linear"
            }}
          />
        ))}
      </div>
    </div>
  );
}

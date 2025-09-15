import { useEffect, useRef } from "react";
import * as Tone from "tone";

import type { Chunk } from "./chunks";
import type { Track, TriggerMap } from "./tracks";

interface PatternPlaybackManagerProps {
  tracks: Track[];
  triggers: TriggerMap;
  started: boolean;
  viewMode: "track" | "song";
  songSequence: number[];
  currentSequenceIndex: number;
}

export function PatternPlaybackManager({
  tracks,
  triggers,
  started,
  viewMode,
  songSequence,
  currentSequenceIndex,
}: PatternPlaybackManagerProps) {
  const shouldGate = viewMode === "song" && songSequence.length > 0;
  const activeTrackId = shouldGate ? songSequence[currentSequenceIndex] : null;

  return (
    <>
      {tracks.map((track) => {
        if (!track.pattern) return null;
        const trigger = triggers[track.instrument];
        if (!trigger) return null;
        const isTrackActive = () =>
          !shouldGate || (activeTrackId !== null && activeTrackId === track.id);
        return (
          <PatternPlayer
            key={track.id}
            pattern={track.pattern}
            trigger={trigger}
            started={started}
            isTrackActive={isTrackActive}
          />
        );
      })}
    </>
  );
}

interface PatternPlayerProps {
  pattern: Chunk;
  trigger: (
    time: number,
    velocity?: number,
    pitch?: number,
    note?: string,
    sustain?: number,
    chunk?: Chunk
  ) => void;
  started: boolean;
  isTrackActive: () => boolean;
}

function PatternPlayer({
  pattern,
  trigger,
  started,
  isTrackActive,
}: PatternPlayerProps) {
  const isTrackActiveRef = useRef(isTrackActive);

  useEffect(() => {
    isTrackActiveRef.current = isTrackActive;
  }, [isTrackActive]);

  useEffect(() => {
    if (!started) return;
    const seq = new Tone.Sequence(
      (time, index: number) => {
        const active = pattern.steps[index] ?? 0;
        if (active && isTrackActiveRef.current()) {
          const velocity = pattern.velocities?.[index];
          const pitch = pattern.pitches?.[index];
          trigger(time, velocity, pitch, pattern.note, pattern.sustain, pattern);
        }
      },
      Array.from({ length: 16 }, (_, i) => i),
      "16n"
    ).start(0);
    return () => {
      seq.dispose();
    };
  }, [
    pattern.steps,
    pattern.velocities,
    pattern.pitches,
    pattern.note,
    pattern.sustain,
    pattern.attack,
    pattern.glide,
    pattern.pan,
    pattern.reverb,
    pattern.delay,
    pattern.distortion,
    pattern.bitcrusher,
    trigger,
    started,
    pattern,
  ]);
  return null;
}

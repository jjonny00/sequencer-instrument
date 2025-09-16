import { useEffect, useRef } from "react";
import * as Tone from "tone";

import type { Chunk } from "./chunks";
import type { Track, TriggerMap } from "./tracks";
import type { PatternGroup } from "./song";

interface PatternPlaybackManagerProps {
  tracks: Track[];
  triggers: TriggerMap;
  started: boolean;
  viewMode: "track" | "song";
  patternGroups: PatternGroup[];
  songRows: (string | null)[][];
  currentSectionIndex: number;
}

export function PatternPlaybackManager({
  tracks,
  triggers,
  started,
  viewMode,
  patternGroups,
  songRows,
  currentSectionIndex,
}: PatternPlaybackManagerProps) {
  const shouldGate = viewMode === "song";
  const activeTrackIds = new Set<number>();

  if (shouldGate) {
    const activeGroupIds = new Set<string>();
    songRows.forEach((row) => {
      if (currentSectionIndex >= row.length) return;
      const groupId = row[currentSectionIndex];
      if (groupId) {
        activeGroupIds.add(groupId);
      }
    });

    if (activeGroupIds.size > 0) {
      patternGroups.forEach((group) => {
        if (activeGroupIds.has(group.id)) {
          group.trackIds.forEach((trackId) => activeTrackIds.add(trackId));
        }
      });
    }
  }

  return (
    <>
      {tracks.map((track) => {
        if (!track.pattern) return null;
        const instrument = track.instrument;
        if (!instrument) return null;
        const trigger = triggers[instrument];
        if (!trigger) return null;
        const isTrackActive = () => {
          if (track.muted) return false;
          if (!shouldGate) return true;
          return activeTrackIds.has(track.id);
        };
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

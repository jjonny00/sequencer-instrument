import { useEffect, useRef } from "react";
import type { JSX } from "react";
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
  if (viewMode === "song") {
    const activeGroupIds = new Set<string>();
    songRows.forEach((row) => {
      if (currentSectionIndex >= row.length) return;
      const groupId = row[currentSectionIndex];
      if (groupId) {
        activeGroupIds.add(groupId);
      }
    });

    const players: JSX.Element[] = [];
    patternGroups
      .filter((group) => activeGroupIds.has(group.id))
      .forEach((group) => {
        group.tracks.forEach((track, index) => {
          if (!track.pattern) return;
          const instrument = track.instrument;
          if (!instrument) return;
          const trigger = triggers[instrument];
          if (!trigger) return;
          if (track.muted) return;
          players.push(
            <PatternPlayer
              key={`${group.id}-${track.id}-${index}`}
              pattern={track.pattern}
              trigger={trigger}
              started={started}
              isTrackActive={() => true}
            />
          );
        });
      });

    return <>{players}</>;
  }

  return (
    <>
      {tracks.map((track) => {
        if (!track.pattern) return null;
        const instrument = track.instrument;
        if (!instrument) return null;
        const trigger = triggers[instrument];
        if (!trigger) return null;
        const isTrackActive = () => !track.muted;
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

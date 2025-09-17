import { useEffect, useMemo, useRef } from "react";
import type { JSX } from "react";
import * as Tone from "tone";

import type { Chunk } from "./chunks";
import type { Track, TriggerMap } from "./tracks";
import type { PatternGroup, SongRow } from "./song";

interface PatternPlaybackManagerProps {
  tracks: Track[];
  triggers: TriggerMap;
  started: boolean;
  viewMode: "track" | "song";
  patternGroups: PatternGroup[];
  songRows: SongRow[];
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
  const patternGroupMap = useMemo(
    () => new Map(patternGroups.map((group) => [group.id, group])),
    [patternGroups]
  );

  if (viewMode === "song") {
    const players: JSX.Element[] = [];
    songRows.forEach((row, rowIndex) => {
      if (currentSectionIndex >= row.slots.length) return;
      const groupId = row.slots[currentSectionIndex];
      if (!groupId) return;
      const group = patternGroupMap.get(groupId);
      if (!group) return;
      const velocityFactor = Math.max(0, Math.min(1, row.velocity ?? 1));

      group.tracks.forEach((track, trackIndex) => {
        if (!track.pattern) return;
        const instrument = track.instrument;
        if (!instrument) return;
        const trigger = triggers[instrument];
        if (!trigger) return;
        const scaledTrigger = (
          time: number,
          velocity = 1,
          pitch?: number,
          note?: string,
          sustain?: number,
          chunk?: Chunk
        ) => {
          const combinedVelocity = Math.max(
            0,
            Math.min(1, velocity * velocityFactor)
          );
          trigger(time, combinedVelocity, pitch, note, sustain, chunk);
        };
        const isTrackActive = () => !row.muted && !track.muted;
        players.push(
          <PatternPlayer
            key={`${rowIndex}-${group.id}-${track.id}-${trackIndex}`}
            pattern={track.pattern}
            trigger={scaledTrigger}
            started={started}
            isTrackActive={isTrackActive}
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
    pattern.filter,
    pattern.chorus,
    pattern.arpRate,
    pattern.arpGate,
    pattern.arpLatch,
    pattern.arpOctaves,
    pattern.style,
    pattern.mode,
    trigger,
    started,
    pattern,
  ]);
  return null;
}

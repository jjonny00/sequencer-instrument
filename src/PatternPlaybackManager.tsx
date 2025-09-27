import { useEffect, useMemo, useRef } from "react";
import type { JSX } from "react";
import * as Tone from "tone";

import { createKick, extractKickOverrides } from "@/instruments/kickInstrument";

import type { Chunk } from "./chunks";
import {
  HARMONIA_DEFAULT_CONTROLS,
  resolveHarmoniaChord,
} from "./instruments/harmonia";
import type {
  HarmoniaComplexity,
  HarmoniaScaleDegree,
} from "./instruments/harmonia";
import { isScaleName, type ScaleName } from "./music/scales";
import { createTriggerKey, type Track, type TriggerMap } from "./tracks";
import { packs } from "./packs";
import type { PatternGroup, SongRow } from "./song";

type TriggerFn = TriggerMap[string];

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

  const resolveTrigger = (instrument: string, packId?: string | null) => {
    const resolvedPackId =
      packId ??
      packs.find((candidate) => candidate.instruments[instrument])?.id ??
      null;
    if (!resolvedPackId) return undefined;
    return triggers[createTriggerKey(resolvedPackId, instrument)];
  };

  const makePlaybackTrigger = (track: Track, trigger?: TriggerFn) => {
    const { instrument, source } = track;
    return (
      time: number,
      velocity?: number,
      pitch?: number,
      note?: string,
      sustain?: number,
      chunk?: Chunk
    ) => {
      if (instrument === "kick") {
        if (!source) return;
        const { packId, characterId } = source;
        const overrides = extractKickOverrides(chunk);
        if (import.meta.env.DEV) {
          console.info("[kick:play]", {
            packId,
            characterId,
            trackId: track.id,
            overrides: overrides ?? null,
          });
        }
        const voice = createKick(packId, characterId, { overrides });
        const resolvedVelocity = velocity ?? 0.9;
        const duration = sustain ?? "8n";
        voice.triggerAttackRelease(duration, time, resolvedVelocity);
        setTimeout(() => voice.dispose(), 600);
        return;
      }
      if (!trigger) return;
      trigger(time, velocity, pitch, note, sustain, chunk, source?.characterId);
    };
  };

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
        const trigger = resolveTrigger(instrument, track.source?.packId);
        if (!trigger && instrument !== "kick") return;
        if (instrument === "kick" && !track.source) return;
        const playbackTrigger = makePlaybackTrigger(track, trigger);
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
          playbackTrigger(
            time,
            combinedVelocity,
            pitch,
            note,
            sustain,
            chunk
          );
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
        const trigger = resolveTrigger(instrument, track.source?.packId);
        if (!trigger && instrument !== "kick") return null;
        if (instrument === "kick" && !track.source) return null;
        const playbackTrigger = makePlaybackTrigger(track, trigger);
        const isTrackActive = () => !track.muted;
        return (
          <PatternPlayer
            key={track.id}
            pattern={track.pattern}
            trigger={playbackTrigger}
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

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

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
    const timingMode = pattern.timingMode === "free" ? "free" : "sync";
    const velocityFactor = pattern.velocityFactor ?? 1;
    const pitchOffset = pattern.pitchOffset ?? 0;
    const swingAmount = pattern.swing ?? 0;
    const swingOffsetSeconds = swingAmount
      ? Tone.Time("16n").toSeconds() * 0.5 * swingAmount
      : 0;
    const humanizeAmount = pattern.humanize ?? 0;

    if (timingMode === "free" && pattern.noteEvents && pattern.noteEvents.length) {
      const events = pattern.noteEvents
        .slice()
        .sort((a, b) => a.time - b.time);
      const loopLength = pattern.noteLoopLength ?? 0;
      const computedLoop =
        loopLength > 0
          ? loopLength
          : events[events.length - 1].time + events[events.length - 1].duration;
      if (computedLoop > 0) {
        const loopId = Tone.Transport.scheduleRepeat(
          (time) => {
            if (!isTrackActiveRef.current()) return;
            events.forEach((event) => {
              const scheduledTime = time + event.time;
              const velocity = clamp(event.velocity * velocityFactor, 0, 1);
              trigger(
                scheduledTime,
                velocity,
                undefined,
                event.note,
                event.duration,
                pattern
              );
            });
          },
          computedLoop,
          0
        );
        return () => {
          Tone.Transport.clear(loopId);
        };
      }
    }

    const stepsArray =
      pattern.steps && pattern.steps.length
        ? pattern.steps.slice()
        : Array(16).fill(0);
    const stepCount = stepsArray.length || 16;
    const stepDurationSeconds = Tone.Time("16n").toSeconds();

    const seq = new Tone.Sequence(
      (time, index: number) => {
        const active = stepsArray[index] ?? 0;
        if (active && isTrackActiveRef.current()) {
          const baseVelocity = pattern.velocities?.[index] ?? 1;
          const velocity = Math.max(
            0,
            Math.min(1, baseVelocity * velocityFactor)
          );
          const basePitch = pattern.pitches?.[index] ?? 0;
          const combinedPitch = basePitch + pitchOffset;
          const scheduledTime =
            swingOffsetSeconds && index % 2 === 1
              ? time + swingOffsetSeconds
              : time;
          let holdSteps = 0;
          for (let offset = 1; offset < stepCount; offset += 1) {
            const nextIndex = (index + offset) % stepCount;
            if (stepsArray[nextIndex]) {
              break;
            }
            holdSteps += 1;
          }
          const holdDurationSeconds = (holdSteps + 1) * stepDurationSeconds;
          const releaseControl = pattern.sustain;
          const sustainSeconds =
            releaseControl === undefined
              ? holdDurationSeconds
              : Math.min(
                  Math.max(releaseControl, 0),
                  holdDurationSeconds
                );
          let noteArgument = pattern.note;
          let chunkPayload: Chunk = pattern;
          if (
            pattern.instrument === "harmonia" &&
            pattern.harmoniaStepDegrees &&
            pattern.harmoniaStepDegrees.length
          ) {
            const rawDegree = pattern.harmoniaStepDegrees[index];
            const baseDegree =
              typeof rawDegree === "number"
                ? rawDegree
                : pattern.degree ?? 0;
            const harmoniaDegree = Math.max(0, Math.min(6, Math.round(baseDegree))) as HarmoniaScaleDegree;
            const tonalCenter = pattern.tonalCenter ?? pattern.note ?? "C4";
            const scaleName = isScaleName(pattern.scale)
              ? (pattern.scale as ScaleName)
              : "Major";
            const complexity = (
              pattern.harmoniaComplexity ?? HARMONIA_DEFAULT_CONTROLS.complexity
            ) as HarmoniaComplexity;
            const allowBorrowed =
              pattern.characterId === "borrowed" || Boolean(pattern.harmoniaBorrowedLabel);
            const resolution = resolveHarmoniaChord({
              tonalCenter,
              scale: scaleName,
              degree: harmoniaDegree,
              complexity,
              allowBorrowed,
            });
            chunkPayload = {
              ...pattern,
              note: resolution.root,
              notes: resolution.notes.slice(),
              degrees: resolution.intervals.slice(),
              degree: harmoniaDegree,
              harmoniaBorrowedLabel: resolution.borrowed
                ? resolution.voicingLabel
                : undefined,
            };
            noteArgument = resolution.root;
          }

          trigger(
            scheduledTime,
            velocity,
            combinedPitch,
            noteArgument,
            sustainSeconds,
            chunkPayload
          );
        }
      },
      Array.from({ length: stepCount }, (_, i) => i),
      "16n"
    ).start(0);
    seq.humanize = humanizeAmount
      ? Tone.Time("32n").toSeconds() * humanizeAmount
      : false;
    return () => {
      seq.dispose();
    };
  }, [
    pattern.steps,
    pattern.velocities,
    pattern.pitches,
    pattern.instrument,
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
    pattern.velocityFactor,
    pattern.pitchOffset,
    pattern.swing,
    pattern.humanize,
    pattern.arpRate,
    pattern.arpGate,
    pattern.arpLatch,
    pattern.arpOctaves,
    pattern.style,
    pattern.mode,
    pattern.noteEvents,
    pattern.noteLoopLength,
    pattern.timingMode,
    pattern.arpFreeRate,
    pattern.harmoniaStepDegrees,
    pattern.tonalCenter,
    pattern.scale,
    pattern.harmoniaComplexity,
    pattern.harmoniaBorrowedLabel,
    pattern.degree,
    trigger,
    started,
    pattern,
  ]);
  return null;
}

import { useEffect, useMemo, useRef } from "react";
import type { JSX } from "react";
import * as Tone from "tone";

import { createKick } from "@/instruments/kickInstrument";

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
import type { PatternGroup, PerformanceTrack, SongRow } from "./song";
import { getPerformanceTracksSpanMeasures, performanceSettingsToChunk } from "./song";

const TICKS_PER_QUARTER = Tone.Transport.PPQ;
const TICKS_PER_SIXTEENTH = TICKS_PER_QUARTER / 4;
const TICKS_PER_MEASURE = TICKS_PER_SIXTEENTH * 16;

const toTicks = (value: string | number | undefined | null): number => {
  if (value === undefined || value === null) {
    return 0;
  }
  if (typeof value === "number") {
    return value * TICKS_PER_MEASURE;
  }
  try {
    return Tone.Time(value).toTicks();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("Failed to convert time to ticks", value, error);
    }
    return 0;
  }
};

const ensurePositiveTicks = (ticks: number, fallback: number) =>
  Number.isFinite(ticks) && ticks > 0 ? ticks : fallback;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const BASS_DEFAULT_MAX_SUSTAIN_SECONDS = Tone.Time("8n").toSeconds();

interface PatternPlaybackManagerProps {
  tracks: Track[];
  triggers: TriggerMap;
  started: boolean;
  viewMode: "track" | "song";
  patternGroups: PatternGroup[];
  songRows: SongRow[];
  currentSectionIndex: number;
  performanceTracks: PerformanceTrack[];
}

export function PatternPlaybackManager({
  tracks,
  triggers,
  started,
  viewMode,
  patternGroups,
  songRows,
  currentSectionIndex,
  performanceTracks,
}: PatternPlaybackManagerProps) {
  const patternGroupMap = useMemo(
    () => new Map(patternGroups.map((group) => [group.id, group])),
    [patternGroups]
  );

  const performanceTrackMap = useMemo(
    () => new Map(performanceTracks.map((track) => [track.id, track])),
    [performanceTracks]
  );

  const resolveTrigger = (instrument: string, packId?: string | null) => {
    const resolvedPackId =
      packId ??
      packs.find((candidate) => candidate.instruments[instrument])?.id ??
      null;
    if (!resolvedPackId) return undefined;
    return triggers[createTriggerKey(resolvedPackId, instrument)];
  };

  const resolveKickTrigger = (track: Track): TriggerMap[string] | undefined => {
    const instrumentId = track.instrument;
    if (instrumentId !== "kick") {
      return undefined;
    }
    const resolvedPackId =
      track.source?.packId ??
      packs.find((candidate) => candidate.instruments[instrumentId])?.id ??
      null;
    if (!resolvedPackId) {
      return undefined;
    }
    const sourceCharacterId = track.source?.characterId;
    const trackId = track.id;
    return ((time: number, velocity?: number) => {
      const resolvedVelocity = velocity ?? 0.9;
      if (resolvedVelocity <= 0) {
        return;
      }
      try {
        const voice = createKick(resolvedPackId, sourceCharacterId);
        voice.triggerAttackRelease("8n", time, resolvedVelocity);
        if (import.meta.env.DEV) {
          console.info("[kick:play]", {
            packId: resolvedPackId,
            characterId: sourceCharacterId,
            trackId,
          });
        }
        const disposeDelayMs = Math.max(
          0,
          (time - Tone.now()) * 1000 + 600
        );
        if (Number.isFinite(disposeDelayMs)) {
          window.setTimeout(() => {
            voice.dispose();
          }, disposeDelayMs);
        } else {
          voice.dispose();
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.info("[kick:play:error]", error);
        }
      }
    }) as TriggerMap[string];
  };

  if (viewMode === "song") {
    const players: JSX.Element[] = [];
    const rowColumnCount = songRows.reduce(
      (max, row) => Math.max(max, row.slots.length),
      0
    );
    const performanceColumnCount = getPerformanceTracksSpanMeasures(
      performanceTracks
    );
    const arrangementColumns = Math.max(
      rowColumnCount,
      performanceColumnCount
    );
    const arrangementLoopTicks = arrangementColumns * TICKS_PER_MEASURE;
    const hasSoloRow = songRows.some((row) => row.solo);

    songRows.forEach((row, rowIndex) => {
      const rowVelocity = clamp(row.velocity ?? 1, 0, 1);
      const isRowActive = () => {
        if (row.muted) return false;
        if (hasSoloRow) {
          return Boolean(row.solo);
        }
        return true;
      };

      if (row.performanceTrackId) {
        const performanceTrack = performanceTrackMap.get(row.performanceTrackId);
        if (!performanceTrack) return;
        const trigger = resolveTrigger(
          performanceTrack.instrument,
          performanceTrack.packId ?? null
        );
        if (!trigger) return;
        players.push(
          <PerformancePlayer
            key={`perf-${rowIndex}-${performanceTrack.id}`}
            track={performanceTrack}
            trigger={trigger}
            started={started}
            isRowActive={isRowActive}
            rowVelocity={rowVelocity}
            loopTicks={arrangementLoopTicks}
          />
        );
        return;
      }

      if (currentSectionIndex >= row.slots.length) return;
      const groupId = row.slots[currentSectionIndex];
      if (!groupId) return;
      const group = patternGroupMap.get(groupId);
      if (!group) return;

      group.tracks.forEach((track, trackIndex) => {
        if (!track.pattern) return;
        const instrument = track.instrument;
        if (!instrument) return;
        const trigger =
          instrument === "kick"
            ? resolveKickTrigger(track) ??
              resolveTrigger(instrument, track.source?.packId)
            : resolveTrigger(instrument, track.source?.packId);
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
            Math.min(1, velocity * rowVelocity)
          );
          trigger(
            time,
            combinedVelocity,
            pitch,
            note,
            sustain,
            chunk,
            track.source?.characterId
          );
        };
        const isTrackActive = () => isRowActive() && !track.muted;
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
        const trigger =
          instrument === "kick"
            ? resolveKickTrigger(track) ??
              resolveTrigger(instrument, track.source?.packId)
            : resolveTrigger(instrument, track.source?.packId);
        if (!trigger) return null;
        const isTrackActive = () => !track.muted;
        return (
          <PatternPlayer
            key={track.id}
            pattern={track.pattern}
            trigger={(time, velocity, pitch, note, sustain, chunk) =>
              trigger(
                time,
                velocity,
                pitch,
                note,
                sustain,
                chunk,
                track.source?.characterId
              )
            }
            started={started}
            isTrackActive={isTrackActive}
          />
        );
      })}
    </>
  );
}

interface NormalizedPerformanceNote {
  time: string;
  startTicks: number;
  endTicks: number;
  velocity: number;
  note: string;
  durationSeconds: number;
}

interface PerformancePlayerProps {
  track: PerformanceTrack;
  trigger: (
    time: number,
    velocity?: number,
    pitch?: number,
    note?: string,
    sustain?: number,
    chunk?: Chunk,
    characterId?: string
  ) => void;
  started: boolean;
  isRowActive: () => boolean;
  rowVelocity: number;
  loopTicks: number;
}

function PerformancePlayer({
  track,
  trigger,
  started,
  isRowActive,
  rowVelocity,
  loopTicks,
}: PerformancePlayerProps) {
  const isRowActiveRef = useRef(isRowActive);
  const rowVelocityRef = useRef(rowVelocity);

  useEffect(() => {
    isRowActiveRef.current = isRowActive;
  }, [isRowActive]);

  useEffect(() => {
    rowVelocityRef.current = rowVelocity;
  }, [rowVelocity]);

  const notes = useMemo<NormalizedPerformanceNote[]>(() => {
    if (!track.notes || track.notes.length === 0) {
      return [];
    }

    const normalized: NormalizedPerformanceNote[] = [];
    track.notes.forEach((note) => {
      const startTicks = toTicks(note.time);
      if (!Number.isFinite(startTicks)) {
        return;
      }
      const clampedStart = Math.max(0, startTicks);
      const durationTicks = ensurePositiveTicks(
        toTicks(note.duration),
        TICKS_PER_SIXTEENTH
      );
      const endTicks = clampedStart + durationTicks;
      const velocity = clamp(note.velocity ?? 1, 0, 1);
      const durationSeconds = Tone.Ticks(durationTicks).toSeconds();
      const timeString = Tone.Ticks(clampedStart).toBarsBeatsSixteenths();
      normalized.push({
        time: timeString,
        startTicks: clampedStart,
        endTicks,
        velocity,
        note: note.note,
        durationSeconds,
      });
    });

    return normalized.sort((a, b) => a.startTicks - b.startTicks);
  }, [track.notes]);

  const loopEndTicks = useMemo(() => {
    const lastNoteEnd = notes.length
      ? notes[notes.length - 1].endTicks
      : 0;
    return Math.max(loopTicks, lastNoteEnd);
  }, [loopTicks, notes]);

  const settingsChunk = useMemo(
    () =>
      performanceSettingsToChunk(track.instrument, track.settings, {
        id: `${track.id}-performance-settings`,
        name: `${track.instrument}-performance-settings`,
        characterId: track.characterId ?? null,
      }),
    [track.id, track.instrument, track.settings, track.characterId]
  );

  useEffect(() => {
    if (!started) return;
    if (notes.length === 0) return;

    const part = new Tone.Part(
      (time, value: NormalizedPerformanceNote) => {
        if (!isRowActiveRef.current()) return;
        const combinedVelocity = clamp(
          value.velocity * rowVelocityRef.current,
          0,
          1
        );
        trigger(
          time,
          combinedVelocity,
          undefined,
          value.note,
          value.durationSeconds,
          settingsChunk,
          track.characterId ?? undefined
        );
      },
      notes.map((value) => [value.time, value] as const)
    ).start(0);

    if (loopEndTicks > 0) {
      part.loop = true;
      part.loopEnd = Tone.Ticks(loopEndTicks).toSeconds();
    } else {
      part.loop = false;
    }

    return () => {
      part.dispose();
    };
  }, [
    notes,
    trigger,
    started,
    loopEndTicks,
    settingsChunk,
    track.characterId,
  ]);

  return null;
}

interface PatternPlayerProps {
  pattern: Chunk;
  trigger: (
    time: number,
    velocity?: number,
    pitch?: number,
    note?: string,
    sustain?: number,
    chunk?: Chunk,
    characterId?: string
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
          const isBassPattern = pattern.instrument === "bass";
          const defaultSustainSeconds = isBassPattern
            ? Math.min(holdDurationSeconds, BASS_DEFAULT_MAX_SUSTAIN_SECONDS)
            : holdDurationSeconds;
          const sustainSeconds =
            releaseControl === undefined
              ? defaultSustainSeconds
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

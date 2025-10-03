import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";

import type { Chunk } from "../chunks";
import type { PerformanceNote, PerformanceTrack } from "../song";
import { createPerformanceSettingsSnapshot } from "../song";
import type { TrackInstrument } from "../tracks";

type EnsurePerformanceRow = (
  instrument: TrackInstrument,
  existingId?: string | null
) => string | null;

type PerformanceUpdater = (
  trackId: string,
  updater: (track: PerformanceTrack) => PerformanceTrack
) => void;

type UsePerformanceCaptureOptions = {
  performanceTracks: PerformanceTrack[];
  activePerformanceTrackId: string | null;
  onPlayInstrumentOpenChange?: (open: boolean) => void;
  onSelectPerformanceTrack?: (trackId: string | null) => void;
  onUpdatePerformanceTrack?: PerformanceUpdater;
  onEnsurePerformanceRow: EnsurePerformanceRow;
  createPerformancePattern: (
    instrument: TrackInstrument,
    timingMode?: "sync" | "free"
  ) => Chunk;
  sortPerformanceNotes: (a: PerformanceNote, b: PerformanceNote) => number;
  ticksToTransportString: (ticks: number) => string;
  ticksToDurationString: (ticks: number) => string;
  ticksPerSixteenth: number;
  ticksPerQuarter: number;
  initialInstrument?: TrackInstrument;
};

export function usePerformanceCapture({
  performanceTracks,
  activePerformanceTrackId,
  onPlayInstrumentOpenChange,
  onSelectPerformanceTrack,
  onUpdatePerformanceTrack,
  onEnsurePerformanceRow,
  createPerformancePattern,
  sortPerformanceNotes,
  ticksToTransportString,
  ticksToDurationString,
  ticksPerSixteenth,
  ticksPerQuarter,
  initialInstrument = "keyboard",
}: UsePerformanceCaptureOptions) {
  const performanceTrackMap = useMemo(
    () =>
      new Map(
        performanceTracks.map((track) => [track.id, track] as const)
      ),
    [performanceTracks]
  );

  const [isPlayInstrumentOpen, setPlayInstrumentOpen] = useState(false);
  const [playInstrument, setPlayInstrument] = useState<TrackInstrument>(
    initialInstrument
  );
  const [playInstrumentPattern, setPlayInstrumentPattern] = useState<Chunk>(() =>
    createPerformancePattern(initialInstrument)
  );
  const latestPlayPatternRef = useRef(playInstrumentPattern);
  const [playInstrumentRowTrackId, setPlayInstrumentRowTrackId] = useState<
    string | null
  >(activePerformanceTrackId);
  const [isQuantizedRecording, setIsQuantizedRecording] = useState(true);
  const [isRecordEnabled, setIsRecordEnabled] = useState(false);
  const [liveGhostNotes, setLiveGhostNotes] = useState<PerformanceNote[]>([]);
  const wasRecordingRef = useRef(false);

  const hasPerformanceTarget = Boolean(playInstrumentRowTrackId);
  const recordingActive = Boolean(
    isRecordEnabled && isPlayInstrumentOpen && hasPerformanceTarget
  );
  const isRecordArmed = Boolean(
    isRecordEnabled && !isPlayInstrumentOpen && hasPerformanceTarget
  );

  useEffect(() => {
    onPlayInstrumentOpenChange?.(isPlayInstrumentOpen);
  }, [isPlayInstrumentOpen, onPlayInstrumentOpenChange]);

  const applyPerformanceSettings = useCallback(
    (pattern: Chunk) => {
      if (!onUpdatePerformanceTrack) {
        return;
      }
      if (!playInstrumentRowTrackId) {
        return;
      }
      const snapshot = createPerformanceSettingsSnapshot(pattern);
      onUpdatePerformanceTrack(playInstrumentRowTrackId, (track) => ({
        ...track,
        settings: snapshot,
      }));
    },
    [onUpdatePerformanceTrack, playInstrumentRowTrackId]
  );

  const handlePlayInstrumentPatternUpdate = useCallback(
    (updater: (chunk: Chunk) => Chunk) => {
      setPlayInstrumentPattern((prev) => {
        const draft: Chunk = {
          ...prev,
          steps: prev.steps.slice(),
          velocities: prev.velocities ? prev.velocities.slice() : undefined,
          pitches: prev.pitches ? prev.pitches.slice() : undefined,
          notes: prev.notes ? prev.notes.slice() : undefined,
          degrees: prev.degrees ? prev.degrees.slice() : undefined,
          noteEvents: prev.noteEvents
            ? prev.noteEvents.map((event) => ({ ...event }))
            : undefined,
          harmoniaStepDegrees: prev.harmoniaStepDegrees
            ? prev.harmoniaStepDegrees.slice()
            : undefined,
        };
        const next = updater(draft);
        const nextPattern = { ...next, instrument: playInstrument };
        applyPerformanceSettings(nextPattern);
        return nextPattern;
      });
    },
    [playInstrument, applyPerformanceSettings]
  );

  const clearLiveRecording = useCallback(() => {
    setLiveGhostNotes([]);
  }, []);

  const handleCloseInstrumentPanel = useCallback(() => {
    setPlayInstrumentOpen(false);
    setPlayInstrumentRowTrackId(null);
    setIsRecordEnabled(false);
    clearLiveRecording();
    onSelectPerformanceTrack?.(null);
  }, [clearLiveRecording, onSelectPerformanceTrack]);

  const handleSelectPerformanceTrackRow = useCallback(
    (trackId: string | null) => {
      if (!trackId) {
        handleCloseInstrumentPanel();
        return;
      }
      const track = performanceTrackMap.get(trackId);
      if (track?.instrument) {
        setPlayInstrument(track.instrument);
      }
      setPlayInstrumentRowTrackId(trackId);
      setPlayInstrumentOpen(true);
      setIsRecordEnabled(false);
      clearLiveRecording();
      onSelectPerformanceTrack?.(trackId);
    },
    [
      clearLiveRecording,
      handleCloseInstrumentPanel,
      onSelectPerformanceTrack,
      performanceTrackMap,
    ]
  );

  const handleClearRecording = useCallback(() => {
    if (!playInstrumentRowTrackId) return;
    clearLiveRecording();
    onUpdatePerformanceTrack?.(playInstrumentRowTrackId, (track) => ({
      ...track,
      notes: [],
    }));
  }, [clearLiveRecording, onUpdatePerformanceTrack, playInstrumentRowTrackId]);

  const handlePerformanceNoteRecorded = useCallback(
    ({
      eventTime,
      noteName,
      velocity,
      durationSeconds,
      mode,
    }: {
      eventTime: number;
      noteName: string;
      velocity: number;
      durationSeconds?: number;
      mode: "sync" | "free";
    }) => {
      if (!recordingActive || !playInstrumentRowTrackId) {
        return;
      }

      const resolvedVelocity = Math.max(0, Math.min(1, velocity));
      const fallbackNote = playInstrumentPattern.note ?? "C4";
      const resolvedNote = noteName || fallbackNote;

      let startTicks = Tone.Transport.getTicksAtTime(eventTime);
      if (!Number.isFinite(startTicks) || startTicks < 0) {
        startTicks = Math.max(0, Tone.Transport.ticks);
      }

      const shouldQuantize = mode === "sync" || isQuantizedRecording;
      if (shouldQuantize) {
        startTicks =
          Math.round(startTicks / ticksPerSixteenth) * ticksPerSixteenth;
      }

      let durationTicks =
        durationSeconds !== undefined
          ? Tone.Time(Math.max(0.02, durationSeconds)).toTicks()
          : Tone.Time(playInstrumentPattern.sustain ?? 0.5).toTicks();

      if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
        durationTicks = ticksPerQuarter;
      }

      if (shouldQuantize) {
        durationTicks = Math.max(
          ticksPerSixteenth,
          Math.round(durationTicks / ticksPerSixteenth) * ticksPerSixteenth
        );
      }

      const noteEntry: PerformanceNote = {
        time: ticksToTransportString(startTicks),
        note: resolvedNote,
        duration: ticksToDurationString(durationTicks),
        velocity: resolvedVelocity,
      };

      setLiveGhostNotes((prev) => [...prev, noteEntry]);
      if (onUpdatePerformanceTrack) {
        const settingsSnapshot = createPerformanceSettingsSnapshot(
          playInstrumentPattern
        );
        onUpdatePerformanceTrack(
          playInstrumentRowTrackId,
          (track: PerformanceTrack) => {
            const nextNotes = [...track.notes, noteEntry];
            nextNotes.sort(sortPerformanceNotes);
            return {
              ...track,
              notes: nextNotes,
              settings: settingsSnapshot,
            };
          }
        );
      }
    },
    [
      recordingActive,
      playInstrumentRowTrackId,
      playInstrumentPattern,
      onUpdatePerformanceTrack,
      isQuantizedRecording,
      ticksPerSixteenth,
      ticksPerQuarter,
      ticksToTransportString,
      ticksToDurationString,
      sortPerformanceNotes,
    ]
  );

  useEffect(() => {
    if (!isPlayInstrumentOpen) return;
    setPlayInstrumentRowTrackId((currentId) => {
      const ensuredId = onEnsurePerformanceRow(playInstrument, currentId);
      if (ensuredId) {
        return ensuredId;
      }
      if (currentId && !performanceTrackMap.has(currentId)) {
        return null;
      }
      return currentId;
    });
  }, [
    isPlayInstrumentOpen,
    playInstrument,
    onEnsurePerformanceRow,
    performanceTrackMap,
  ]);

  useEffect(() => {
    if (!activePerformanceTrackId) {
      setPlayInstrumentRowTrackId(null);
      setPlayInstrumentOpen(false);
      return;
    }
    setPlayInstrumentRowTrackId(activePerformanceTrackId);
    const track = performanceTrackMap.get(activePerformanceTrackId);
    if (track?.instrument) {
      setPlayInstrument((prev) =>
        prev === track.instrument ? prev : track.instrument
      );
    }
    setPlayInstrumentOpen(true);
  }, [activePerformanceTrackId, performanceTrackMap]);

  useEffect(() => {
    const pattern = createPerformancePattern(playInstrument);
    setPlayInstrumentPattern(pattern);
    applyPerformanceSettings(pattern);
  }, [playInstrument, applyPerformanceSettings, createPerformancePattern]);

  useEffect(() => {
    latestPlayPatternRef.current = playInstrumentPattern;
  }, [playInstrumentPattern]);

  useEffect(() => {
    if (!playInstrumentRowTrackId) return;
    applyPerformanceSettings(latestPlayPatternRef.current);
  }, [playInstrumentRowTrackId, applyPerformanceSettings]);

  useEffect(() => {
    setPlayInstrumentPattern((prev) => {
      const nextMode = isQuantizedRecording ? "sync" : "free";
      if (prev.timingMode === nextMode) {
        return prev;
      }
      return { ...prev, timingMode: nextMode };
    });
  }, [isQuantizedRecording]);

  useEffect(() => {
    if (recordingActive && !wasRecordingRef.current) {
      wasRecordingRef.current = true;
      setLiveGhostNotes([]);
    } else if (!recordingActive && wasRecordingRef.current) {
      wasRecordingRef.current = false;
      clearLiveRecording();
    }
  }, [recordingActive, clearLiveRecording]);

  useEffect(() => {
    return () => {
      clearLiveRecording();
    };
  }, [clearLiveRecording]);

  useEffect(() => {
    if (wasRecordingRef.current) return;
    setLiveGhostNotes([]);
  }, [playInstrument, playInstrumentRowTrackId]);

  const activePerformanceTrack = useMemo(() => {
    if (playInstrumentRowTrackId) {
      return performanceTrackMap.get(playInstrumentRowTrackId) ?? null;
    }
    if (activePerformanceTrackId) {
      return performanceTrackMap.get(activePerformanceTrackId) ?? null;
    }
    return null;
  }, [
    performanceTrackMap,
    playInstrumentRowTrackId,
    activePerformanceTrackId,
  ]);

  useEffect(() => {
    const targetInstrument = activePerformanceTrack?.instrument;
    if (!targetInstrument) {
      return;
    }
    setPlayInstrument((prev) =>
      prev === targetInstrument ? prev : targetInstrument
    );
  }, [activePerformanceTrack?.instrument]);

  return {
    performanceTrackMap,
    isPlayInstrumentOpen,
    playInstrument,
    playInstrumentPattern,
    playInstrumentRowTrackId,
    isQuantizedRecording,
    setIsQuantizedRecording,
    isRecordEnabled,
    setIsRecordEnabled,
    liveGhostNotes,
    hasPerformanceTarget,
    recordingActive,
    isRecordArmed,
    handlePlayInstrumentPatternUpdate,
    handleCloseInstrumentPanel,
    handleSelectPerformanceTrackRow,
    handleClearRecording,
    handlePerformanceNoteRecorded,
    activePerformanceTrack,
  };
}

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import * as Tone from "tone";
import { createTriggerKey, type Track, type TriggerMap } from "./tracks";
import type { Chunk } from "./chunks";
import {
  distributeHarmoniaPatternDegrees,
  HARMONIA_CHARACTER_PRESETS,
  HARMONIA_DEFAULT_CONTROLS,
  resolveHarmoniaChord,
} from "./instruments/harmonia";
import type {
  HarmoniaCharacterId,
  HarmoniaScaleDegree,
  HarmoniaComplexity,
} from "./instruments/harmonia";
import { isScaleName, type ScaleName } from "./music/scales";
import { packs, type InstrumentDefinition } from "./packs";
import { IconButton } from "./components/IconButton";
import { StepModal } from "./StepModal";
import type { PatternGroup } from "./song";
import { createPatternGroupId } from "./song";
import { isUserPresetId, loadInstrumentPreset, stripUserPresetPrefix } from "./presets";
import { resolveInstrumentCharacterId } from "./instrumentCharacters";
import { initAudioContext, isIOSPWA } from "./utils/audio";
import { getInstrumentColor, lightenColor, withAlpha } from "./utils/color";
import { formatInstrumentLabel } from "./utils/instrument";
import { InstrumentSettingsPanel } from "./components/InstrumentSettingsPanel";

const getTrackNumberLabel = (tracks: Track[], trackId: number) => {
  const index = tracks.findIndex((track) => track.id === trackId);
  const number = index >= 0 ? index + 1 : trackId;
  return number.toString().padStart(2, "0");
};

const getHarmoniaCharacterPreset = (id: string | null | undefined) =>
  id
    ? HARMONIA_CHARACTER_PRESETS.find(
        (preset) => preset.id === (id as HarmoniaCharacterId)
      ) ?? null
    : null;

const initializeHarmoniaPattern = (
  pattern: Chunk,
  characterId: string | null,
  instrumentDefinition?: InstrumentDefinition
): Chunk => {
  if (pattern.instrument !== "harmonia") return pattern;

  const availablePatterns = instrumentDefinition?.patterns ?? [];
  const providedPresetId = pattern.harmoniaPatternId ?? null;
  const presetId = providedPresetId &&
    availablePatterns.some((candidate) => candidate.id === providedPresetId)
      ? providedPresetId
      : instrumentDefinition?.defaultPatternId ?? availablePatterns[0]?.id ?? null;
  const preset = presetId
    ? availablePatterns.find((candidate) => candidate.id === presetId) ?? null
    : null;

  const resolvedCharacterId = resolveInstrumentCharacterId(
    instrumentDefinition,
    characterId,
    null,
    pattern.characterId ?? null
  );

  const tonalCenter = pattern.tonalCenter ?? pattern.note ?? "C4";
  const scaleName = isScaleName(pattern.scale)
    ? (pattern.scale as ScaleName)
    : "Major";

  if (!preset) {
    return {
      ...pattern,
      tonalCenter,
      scale: scaleName,
      characterId: resolvedCharacterId,
    };
  }

  const stepCount = pattern.steps.length || 16;
  const patternDegrees = (preset.degrees ?? []).map((degree) =>
      Math.max(0, Math.min(6, Math.round(degree))) as HarmoniaScaleDegree
  );
  const { steps, stepDegrees } = distributeHarmoniaPatternDegrees(
    patternDegrees,
    stepCount
  );
  const velocities = steps.map((value) => (value ? 1 : 0));
  const firstDegreeIndex = stepDegrees.findIndex((value) => value !== null);
  const fallbackDegree = Math.min(6, Math.max(0, pattern.degree ?? 0)) as HarmoniaScaleDegree;
  const firstDegree =
    firstDegreeIndex >= 0
      ? (stepDegrees[firstDegreeIndex] as HarmoniaScaleDegree)
      : fallbackDegree;

  const characterPreset = getHarmoniaCharacterPreset(resolvedCharacterId);
  const complexity = (characterPreset?.complexity ??
    HARMONIA_DEFAULT_CONTROLS.complexity) as HarmoniaComplexity;
  const allowBorrowed = characterPreset?.allowBorrowed ?? false;
  const resolution = resolveHarmoniaChord({
    tonalCenter,
    scale: scaleName,
    degree: firstDegree,
    complexity,
    allowBorrowed,
  });

  return {
    ...pattern,
    steps,
    velocities,
    harmoniaStepDegrees: stepDegrees.map((value) => value as number | null),
    harmoniaPatternId: preset.id,
    tonalCenter,
    scale: scaleName,
    degree: firstDegree,
    note: resolution.root,
    notes: resolution.notes.slice(),
    degrees: resolution.intervals.slice(),
    harmoniaComplexity: complexity,
    harmoniaBorrowedLabel: resolution.borrowed ? resolution.voicingLabel : undefined,
    useExtensions: complexity !== "simple",
    characterId: resolvedCharacterId,
  };
};

const LABEL_WIDTH = 60;
const ROW_HEIGHT = 40;

interface TrackEditingContext {
  track: Track;
  pattern: Chunk;
  trackLabel: string;
  color: string;
  instrumentName: string;
  characterName: string | null;
  hoverLabel: string;
  velocityFactor: number;
  pitchOffset: number;
  swingValue: number;
  hasActiveSteps: boolean;
}

const cloneChunk = (chunk: Chunk): Chunk => ({
  ...chunk,
  steps: chunk.steps.slice(),
  velocities: chunk.velocities ? chunk.velocities.slice() : undefined,
  pitches: chunk.pitches ? chunk.pitches.slice() : undefined,
  notes: chunk.notes ? chunk.notes.slice() : undefined,
  degrees: chunk.degrees ? chunk.degrees.slice() : undefined,
  noteEvents: chunk.noteEvents ? chunk.noteEvents.map((event) => ({ ...event })) : undefined,
  harmoniaStepDegrees: chunk.harmoniaStepDegrees
    ? chunk.harmoniaStepDegrees.slice()
    : undefined,
});

const cloneTrack = (track: Track): Track => ({
  ...track,
  pattern: track.pattern ? cloneChunk(track.pattern) : null,
  source: track.source ? { ...track.source } : undefined,
});

export interface AddTrackRequest {
  packId: string;
  instrumentId: string;
  characterId: string;
  presetId?: string | null;
}

type GroupEditorState =
  | {
      mode: "create";
      name: string;
    }
  | {
      mode: "edit";
      groupId: string;
      name: string;
    };

export interface LoopStripHandle {
  openLoopsLibrary: () => void;
  addTrack: () => void;
  addTrackWithOptions: (options: AddTrackRequest) => void;
  updateTrackWithOptions: (trackId: number, options: AddTrackRequest) => void;
  removeTrack: (trackId: number) => void;
}

interface LoopStripProps {
  started: boolean;
  isPlaying: boolean;
  tracks: Track[];
  editing: number | null;
  setEditing: Dispatch<SetStateAction<number | null>>;
  setTracks: Dispatch<SetStateAction<Track[]>>;
  packIndex: number;
  triggers: TriggerMap;
  patternGroups: PatternGroup[];
  setPatternGroups: Dispatch<SetStateAction<PatternGroup[]>>;
  selectedGroupId: string | null;
  setSelectedGroupId: Dispatch<SetStateAction<string | null>>;
  onRequestTrackModal: (track: Track) => void;
}

/**
 * Top strip visualizing a 16-step loop.
 * - Displays each track's 16-step pattern.
 * - Highlights the current step in sync with Tone.Transport.
 * - Allows editing a track's pattern inline.
 */
export const LoopStrip = forwardRef<LoopStripHandle, LoopStripProps>(
  function LoopStrip(
    {
      started,
      isPlaying,
      tracks,
      editing,
      setEditing,
      setTracks,
      packIndex,
      triggers,
      patternGroups,
      setPatternGroups,
      selectedGroupId,
      setSelectedGroupId,
      onRequestTrackModal,
    },
    ref
  ) {
  const [step, setStep] = useState(-1);
  const [groupEditor, setGroupEditor] = useState<GroupEditorState | null>(null);
  const [stepEditing, setStepEditing] = useState<
    { trackId: number; index: number } | null
  >(null);
  const [isLoopsLibraryOpen, setIsLoopsLibraryOpen] = useState(false);
  const swipeRef = useRef(0);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const labelLongPressRef = useRef<Map<number, boolean>>(new Map());
  const pack = packs[packIndex];
  const canAddTrack = packs.some(
    (candidate) => Object.keys(candidate.instruments).length > 0
  );
  const addTrackEnabled = canAddTrack;

  useEffect(() => {
    console.log("Track view mounted");
    if (isIOSPWA()) {
      void Tone.start()
        .then(() => {
          console.log("Tone.js audio started successfully");
        })
        .catch((err) => {
          console.warn("Tone.js failed to start:", err);
        });
    }
  }, []);
  const selectedGroup = useMemo(() => {
    if (!selectedGroupId) return null;
    return patternGroups.find((group) => group.id === selectedGroupId) ?? null;
  }, [patternGroups, selectedGroupId]);

  const getNextGroupName = (groups: PatternGroup[] = patternGroups) => {
    const existingNames = new Set(
      groups.map((group) => group.name.toLowerCase())
    );
    let index = 1;
    while (true) {
      const candidate = `Loop ${String(index).padStart(2, "0")}`;
      if (!existingNames.has(candidate.toLowerCase())) {
        return candidate;
      }
      index += 1;
    }
  };

  const captureCurrentTracks = () => tracks.map((track) => cloneTrack(track));

  const applyGroupTracks = useCallback(
    (group: PatternGroup | null) => {
      const cloned = group ? group.tracks.map((track) => cloneTrack(track)) : [];
      setTracks(cloned);
      setEditing(null);
      setStepEditing(null);
    },
    [setTracks, setEditing, setStepEditing]
  );

  const isCreatingGroup = groupEditor?.mode === "create";
  const isEditingCurrentGroup =
    groupEditor?.mode === "edit" && groupEditor.groupId === selectedGroupId;

  useEffect(() => {
    if (patternGroups.length === 0) {
      if (selectedGroupId !== null) {
        setSelectedGroupId(null);
      }
      setGroupEditor(null);
      setIsLoopsLibraryOpen(false);
      return;
    }
    const exists = selectedGroupId
      ? patternGroups.some((group) => group.id === selectedGroupId)
      : false;
    if (exists) return;
    const fallbackGroup = patternGroups[0] ?? null;
    setSelectedGroupId(fallbackGroup?.id ?? null);
  }, [patternGroups, selectedGroupId, setSelectedGroupId]);

  useEffect(() => {
    const group = selectedGroupId
      ? patternGroups.find((g) => g.id === selectedGroupId) ?? null
      : null;
    applyGroupTracks(group ?? null);
  }, [selectedGroupId, patternGroups, applyGroupTracks]);

  useEffect(() => {
    setGroupEditor(null);
  }, [packIndex]);

  useEffect(() => {
    if (!groupEditor) return;
    if (groupEditor.mode === "edit") {
      const exists = patternGroups.some(
        (group) => group.id === groupEditor.groupId
      );
      if (!exists) {
        setGroupEditor(null);
      }
    }
  }, [groupEditor, patternGroups]);

  // Schedule a step advance on each 16th note when audio has started.
  useEffect(() => {
    if (!started) return;
    let current = 0;
    const id = Tone.Transport.scheduleRepeat((time) => {
      Tone.Draw.schedule(() => {
        setStep(current);
        current = (current + 1) % 16;
      }, time);
    }, "16n");
    return () => {
      Tone.Transport.clear(id);
    };
  }, [started]);

  // Reset playhead when transport stops or is paused.
  useEffect(() => {
    if (!isPlaying) setStep(-1);
  }, [isPlaying]);

  const addPattern = (trackId: number) => {
    let created = false;
    setTracks((ts) =>
      ts.map((t) => {
        if (t.id !== trackId) return t;
        if (!t.instrument) return t;
        const label = getTrackNumberLabel(ts, trackId);
        created = true;
        return {
          ...t,
          pattern: {
            id: `track-${trackId}-${Date.now()}`,
            name: `Track ${label} Pattern`,
            instrument: t.instrument,
            steps: Array(16).fill(0),
            velocities: Array(16).fill(1),
            pitches: Array(16).fill(0),
            velocityFactor: 1,
            pitchOffset: 0,
            swing: 0,
          },
        };
      })
    );
    if (created) {
      setEditing(trackId);
    }
  };

  const handleAddTrack = useCallback(() => {
    if (!addTrackEnabled) return;
    let createdId: number | null = null;
    setTracks((ts) => {
      const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
      const label = (ts.length + 1).toString().padStart(2, "0");
      createdId = nextId;
      return [
        ...ts,
        {
          id: nextId,
          name: label,
          instrument: "",
          pattern: null,
          muted: false,
        },
      ];
    });
    if (createdId !== null) {
      setEditing(createdId);
    }
  }, [
    addTrackEnabled,
    setTracks,
    setEditing,
  ]);

  const handleAddTrackWithOptions = useCallback(
    ({ packId, instrumentId, characterId, presetId }: AddTrackRequest) => {
      if (!addTrackEnabled) return;
      if (!instrumentId) return;
      const activePack = pack.id === packId ? pack : packs.find((p) => p.id === packId);
      if (!activePack) {
        return;
      }
      const resolvePreset = () => {
        if (!presetId) return null;
        if (isUserPresetId(presetId)) {
          const stored = loadInstrumentPreset(
            packId,
            instrumentId,
            stripUserPresetPrefix(presetId)
          );
          if (!stored) return null;
          const cloned = cloneChunk(stored.pattern);
          return {
            pattern: {
              ...cloned,
              id: `${stored.id}-${Date.now()}`,
              instrument: instrumentId,
              name: stored.name || cloned.name,
            },
            name: stored.name || cloned.name,
            characterId: stored.characterId,
          };
        }
        const preset = activePack.chunks.find((chunk) => chunk.id === presetId);
        if (!preset) return null;
        const cloned = cloneChunk(preset);
        return {
          pattern: {
            ...cloned,
            id: `${preset.id}-${Date.now()}`,
            instrument: instrumentId,
            name: preset.name,
          },
          name: preset.name,
          characterId: preset.characterId ?? null,
        };
      };
      let createdId: number | null = null;
      setTracks((ts) => {
        const nextId = ts.length ? Math.max(...ts.map((t) => t.id)) + 1 : 1;
        const label = (ts.length + 1).toString().padStart(2, "0");
        const presetPayload = resolvePreset();
        const basePattern: Chunk = presetPayload
          ? presetPayload.pattern
          : {
              id: `track-${nextId}-${Date.now()}`,
              name: `Track ${label} Pattern`,
              instrument: instrumentId,
              steps: Array(16).fill(0),
              velocities: Array(16).fill(1),
              pitches: Array(16).fill(0),
              velocityFactor: 1,
              pitchOffset: 0,
              swing: 0,
            };
        const instrumentDefinition = activePack.instruments[
          instrumentId
        ] as InstrumentDefinition | undefined;
        const resolvedCharacterId = resolveInstrumentCharacterId(
          instrumentDefinition,
          characterId,
          presetPayload?.characterId ?? null,
          basePattern.characterId ?? null
        );
        let pattern: Chunk = {
          ...basePattern,
          characterId: resolvedCharacterId,
        };
        if (pattern.velocityFactor === undefined) {
          pattern.velocityFactor = 1;
        }
        if (pattern.pitchOffset === undefined) {
          pattern.pitchOffset = 0;
        }
        if (pattern.swing === undefined) {
          pattern.swing = 0;
        }
        if (instrumentId === "harmonia") {
          pattern = initializeHarmoniaPattern(
            pattern,
            resolvedCharacterId,
            instrumentDefinition
          );
        }
        createdId = nextId;
        return [
          ...ts,
          {
            id: nextId,
            name: presetPayload?.name ?? label,
            instrument: instrumentId as keyof TriggerMap,
            pattern,
            muted: false,
            source: {
              packId,
              instrumentId,
              characterId: resolvedCharacterId,
              presetId: presetId ?? null,
            },
          },
        ];
      });
      if (createdId !== null) {
        setEditing(createdId);
      }
    },
    [
      addTrackEnabled,
      pack,
      setTracks,
      setEditing,
    ]
  );

  const handleUpdateTrackWithOptions = useCallback(
    (
      trackId: number,
      { packId, instrumentId, characterId, presetId }: AddTrackRequest
    ) => {
      if (!instrumentId) return;
      const activePack = pack.id === packId ? pack : packs.find((p) => p.id === packId);
      if (!activePack) {
        return;
      }
      const resolvePreset = () => {
        if (!presetId) return null;
        if (isUserPresetId(presetId)) {
          const stored = loadInstrumentPreset(
            packId,
            instrumentId,
            stripUserPresetPrefix(presetId)
          );
          if (!stored) return null;
          const cloned = cloneChunk(stored.pattern);
          return {
            pattern: {
              ...cloned,
              id: `${stored.id}-${Date.now()}`,
              instrument: instrumentId,
              name: stored.name || cloned.name,
            },
            name: stored.name || cloned.name,
            characterId: stored.characterId,
          };
        }
        const preset = presetId
          ? activePack.chunks.find((chunk) => chunk.id === presetId)
          : null;
        if (!preset) return null;
        const cloned = cloneChunk(preset);
        return {
          pattern: {
            ...cloned,
            id: `${preset.id}-${Date.now()}`,
            instrument: instrumentId,
            name: preset.name,
          },
          name: preset.name,
          characterId: preset.characterId ?? null,
        };
      };
      setTracks((ts) =>
        ts.map((t) => {
          if (t.id !== trackId) return t;
          const presetPayload = resolvePreset();
          const basePattern: Chunk | null = presetPayload
            ? presetPayload.pattern
            : t.pattern
            ? { ...cloneChunk(t.pattern), instrument: instrumentId }
            : {
                id: `track-${trackId}-${Date.now()}`,
                name: t.name,
                instrument: instrumentId,
                steps: Array(16).fill(0),
                velocities: Array(16).fill(1),
                pitches: Array(16).fill(0),
                velocityFactor: 1,
                pitchOffset: 0,
                swing: 0,
              };
          const instrumentDefinition = activePack.instruments[
            instrumentId
          ] as InstrumentDefinition | undefined;
          const previousCharacterId = basePattern?.characterId ?? null;
          const resolvedCharacterId = resolveInstrumentCharacterId(
            instrumentDefinition,
            characterId,
            presetPayload?.characterId ?? null,
            previousCharacterId
          );
          let nextPattern: Chunk | null = basePattern
            ? { ...basePattern, characterId: resolvedCharacterId }
            : null;
          if (nextPattern) {
            if (nextPattern.velocityFactor === undefined) {
              nextPattern.velocityFactor = 1;
            }
            if (nextPattern.pitchOffset === undefined) {
              nextPattern.pitchOffset = 0;
            }
            if (nextPattern.swing === undefined) {
              nextPattern.swing = 0;
            }
          }
          if (instrumentId === "harmonia" && nextPattern && !presetPayload) {
            nextPattern = initializeHarmoniaPattern(
              nextPattern,
              resolvedCharacterId,
              instrumentDefinition
            );
          }
          const nextName = presetPayload ? presetPayload.name : t.name;
          return {
            ...t,
            name: nextName,
            instrument: instrumentId as keyof TriggerMap,
            pattern: nextPattern,
            source: {
              packId,
              instrumentId,
              characterId: resolvedCharacterId,
              presetId: presetId ?? null,
            },
          };
        })
      );
      setEditing(trackId);
    },
    [pack, setTracks, setEditing]
  );

  const removeTrack = useCallback(
    (trackId: number) => {
      setTracks((ts) => ts.filter((t) => t.id !== trackId));
      setEditing((current) => (current === trackId ? null : current));
      setStepEditing((current) =>
        current && current.trackId === trackId ? null : current
      );
    },
    [setTracks, setEditing, setStepEditing]
  );

  useImperativeHandle(
    ref,
    () => ({
      openLoopsLibrary: () => setIsLoopsLibraryOpen(true),
      addTrack: () => handleAddTrack(),
      addTrackWithOptions: (options: AddTrackRequest) =>
        handleAddTrackWithOptions(options),
      updateTrackWithOptions: (trackId: number, options: AddTrackRequest) =>
        handleUpdateTrackWithOptions(trackId, options),
      removeTrack: (trackId: number) => removeTrack(trackId),
    }),
    [
      handleAddTrack,
      handleAddTrackWithOptions,
      handleUpdateTrackWithOptions,
      removeTrack,
    ]
  );

  const handleToggleMute = (trackId: number) => {
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId
          ? {
              ...t,
              muted: !t.muted,
            }
          : t
      )
    );
  };

  const openCreateGroup = () => {
    setGroupEditor({
      mode: "create",
      name: getNextGroupName(),
    });
  };

  const handleCreateLoop = () => {
    const newId = createPatternGroupId();
    let created: PatternGroup | null = null;
    setPatternGroups((groups) => {
      const name = getNextGroupName(groups);
      created = {
        id: newId,
        name,
        tracks: [],
      };
      return [...groups, created];
    });
    setGroupEditor(null);
    setIsLoopsLibraryOpen(false);
    if (created) {
      setSelectedGroupId(newId);
      applyGroupTracks(created);
    } else {
      setSelectedGroupId(newId);
      applyGroupTracks(null);
    }
  };

  const openEditGroup = () => {
    if (!selectedGroup) return;
    setGroupEditor({
      mode: "edit",
      groupId: selectedGroup.id,
      name: selectedGroup.name,
    });
  };

  const handleEditorNameChange = (value: string) => {
    setGroupEditor((state) => (state ? { ...state, name: value } : state));
  };

  const handleSaveGroup = () => {
    if (!groupEditor) return;
    if (groupEditor.mode === "edit") {
      setPatternGroups((groups) =>
        groups.map((group) => {
          if (group.id !== groupEditor.groupId) return group;
          const trimmed = groupEditor.name.trim();
          return {
            ...group,
            name: trimmed || group.name,
          };
        })
      );
      setGroupEditor(null);
      return;
    }
    const newId = createPatternGroupId();
    const trimmed = groupEditor.name.trim();
    let created: PatternGroup | null = null;
    setPatternGroups((groups) => {
      const name = trimmed || getNextGroupName(groups);
      created = {
        id: newId,
        name,
        tracks: [],
      };
      return [...groups, created];
    });
    if (created) {
      setSelectedGroupId(newId);
      applyGroupTracks(created);
    } else {
      setSelectedGroupId(newId);
      applyGroupTracks(null);
    }
    setGroupEditor(null);
  };

  const handleDuplicateGroup = () => {
    if (!selectedGroupId) return;
    let created: PatternGroup | null = null;
    const newId = createPatternGroupId();
    setPatternGroups((groups) => {
      const source = groups.find((group) => group.id === selectedGroupId);
      if (!source) return groups;
      const existingNames = new Set(
        groups.map((group) => group.name.toLowerCase())
      );
      let candidate = `${source.name} copy`;
      let suffix = 2;
      while (existingNames.has(candidate.toLowerCase())) {
        candidate = `${source.name} copy ${suffix}`;
        suffix += 1;
      }
      const duplicatedTracks =
        source.id === selectedGroupId
          ? captureCurrentTracks()
          : source.tracks.map((track) => cloneTrack(track));
      created = {
        id: newId,
        name: candidate,
        tracks: duplicatedTracks,
      };
      return [...groups, created];
    });
    if (created) {
      setSelectedGroupId(newId);
      applyGroupTracks(created);
    }
    setGroupEditor(null);
  };

  const handleSnapshotSelectedGroup = () => {
    if (!selectedGroupId) return;
    setPatternGroups((groups) =>
      groups.map((group) => {
        if (group.id !== selectedGroupId) return group;
        return {
          ...group,
          tracks: captureCurrentTracks(),
        };
      })
    );
  };

  const handleDeleteGroup = () => {
    if (!selectedGroupId) return;
    if (patternGroups.length <= 1) return;
    const confirmed = window.confirm(
      "Delete this loop? This action cannot be undone."
    );
    if (!confirmed) return;
    setPatternGroups((groups) => {
      const filtered = groups.filter((group) => group.id !== selectedGroupId);
      if (filtered.length === 0) {
        const fallbackGroup: PatternGroup = {
          id: createPatternGroupId(),
          name: getNextGroupName([]),
          tracks: [],
        };
        setSelectedGroupId(fallbackGroup.id);
        applyGroupTracks(fallbackGroup);
        return [fallbackGroup];
      }
      const nextGroup = filtered[0] ?? null;
      if (nextGroup) {
        setSelectedGroupId(nextGroup.id);
        applyGroupTracks(nextGroup);
      } else {
        setSelectedGroupId(null);
        applyGroupTracks(null);
      }
      return filtered;
    });
    setGroupEditor(null);
  };

  const handleCancelGroupEdit = () => {
    setGroupEditor(null);
  };

  const previewTrackPattern = useCallback(
    async (track: Track, patternOverride?: Chunk | null) => {
      const pattern = patternOverride ?? track.pattern;
      if (!pattern || !track.instrument) return;

      const packId = track.source?.packId ?? pack.id;
      const triggerKey = createTriggerKey(packId, track.instrument);
      const trigger = triggers[triggerKey];
      if (!trigger) return;

      try {
        await initAudioContext();
      } catch {
        return;
      }

      const start = Tone.now() + 0.05;
      const sixteenth = Tone.Time("16n").toSeconds();
      const velocityFactor = pattern.velocityFactor ?? 1;
      const pitchOffset = pattern.pitchOffset ?? 0;
      const swing = Math.max(0, Math.min(1, pattern.swing ?? 0));
      const sustain = pattern.sustain ?? 0.5;
      const note = pattern.note;
      const characterId = pattern.characterId ?? track.source?.characterId ?? null;

      const hasActiveSteps = pattern.steps.some(Boolean);
      if (!hasActiveSteps) {
        const velocity = Math.max(0, Math.min(1, velocityFactor));
        trigger(
          start,
          velocity,
          pitchOffset,
          note,
          sustain,
          pattern,
          characterId ?? undefined
        );
        return;
      }

      pattern.steps.forEach((stepValue, index) => {
        if (!stepValue) return;
        const baseTime = start + index * sixteenth;
        const swingDelay = swing > 0 && index % 2 === 1 ? swing * (sixteenth / 2) : 0;
        const time = baseTime + swingDelay;
        const velocity = Math.max(
          0,
          Math.min(1, (pattern.velocities?.[index] ?? 1) * velocityFactor)
        );
        const pitch = (pattern.pitches?.[index] ?? 0) + pitchOffset;
        trigger(
          time,
          velocity,
          pitch,
          note,
          sustain,
          pattern,
          characterId ?? undefined
        );
      });
    },
    [pack.id, triggers]
  );

  const mutatePattern = useCallback(
    (
      trackId: number,
      updater: (pattern: Chunk) => Chunk,
      options: { preview?: boolean } = {}
    ) => {
      let previewTrack: Track | null = null;
      let previewPattern: Chunk | null = null;
      setTracks((ts) =>
        ts.map((t) => {
          if (t.id !== trackId || !t.pattern) {
            return t;
          }
          const updatedPattern = updater(t.pattern);
          previewTrack = { ...t, pattern: updatedPattern };
          previewPattern = updatedPattern;
          return { ...t, pattern: updatedPattern };
        })
      );
      if (options.preview && previewTrack && previewPattern) {
        void previewTrackPattern(previewTrack, previewPattern);
      }
    },
    [previewTrackPattern, setTracks]
  );

  const updatePattern = (trackId: number, steps: number[]) => {
    mutatePattern(trackId, (pattern) => ({ ...pattern, steps }));
  };

  const updateStep = (
    trackId: number,
    index: number,
    props: { velocity?: number; pitch?: number }
  ) => {
    mutatePattern(trackId, (pattern) => {
      const velocities = pattern.velocities
        ? pattern.velocities.slice()
        : Array(16).fill(1);
      const pitches = pattern.pitches
        ? pattern.pitches.slice()
        : Array(16).fill(0);
      if (props.velocity !== undefined) velocities[index] = props.velocity;
      if (props.pitch !== undefined) pitches[index] = props.pitch;
      return { ...pattern, velocities, pitches };
    });
  };

  const handleClearTrackPattern = (trackId: number) => {
    mutatePattern(trackId, (pattern) => {
      const clearedSteps = pattern.steps.map(() => 0);
      const cleared = { ...pattern, steps: clearedSteps };
      if (pattern.velocities) {
        cleared.velocities = pattern.velocities.map(() => 0);
      }
      return cleared;
    });
  };

  let activeEditingContext: TrackEditingContext | null = null;

  return (
    <div
      style={{
        height: "32vh",
        width: "100%",
        background: "#2a2f3a",
        display: "flex",
        flexDirection: "column",
        padding: "8px",
        boxSizing: "border-box",
        gap: 4,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: "1 1 260px",
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          <IconButton
            icon="add"
            label="Create new loop"
            onClick={handleCreateLoop}
            title="Create new loop"
            style={{
              minWidth: 40,
              minHeight: 40,
              borderRadius: 999,
              background: "#1f2532",
            }}
          />
          <select
            aria-label="Current loop"
            value={selectedGroupId ?? patternGroups[0]?.id ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedGroupId(value || null);
              setGroupEditor(null);
              setIsLoopsLibraryOpen(false);
            }}
            style={{
              flex: "1 1 160px",
              minWidth: 0,
              padding: 10,
              borderRadius: 12,
              border: "1px solid #2f384a",
              background: "#111827",
              color: "#e6f2ff",
            }}
          >
            {patternGroups.map((group) => (
              <option key={group.id} value={group.id}>
                📼 {group.name}
              </option>
            ))}
          </select>
          <IconButton
            icon="save"
            label="Save loop"
            onClick={handleSnapshotSelectedGroup}
            title="Save loop"
            disabled={!selectedGroup}
            style={{
              minWidth: 40,
              minHeight: 40,
              borderRadius: 999,
              background: selectedGroup ? "#27E0B0" : "#1f2532",
              border: selectedGroup ? "1px solid #27E0B0" : "1px solid #2f384a",
              color: selectedGroup ? "#0b1220" : "#94a3b8",
            }}
          />
          <IconButton
            icon="more_horiz"
            label="Open loop options"
            onClick={() => setIsLoopsLibraryOpen(true)}
            title="Loop options"
            disabled={patternGroups.length === 0}
            style={{
              minWidth: 40,
              minHeight: 40,
              borderRadius: 999,
              background: "#1f2532",
            }}
          />
        </div>
      </div>
      <div
        ref={trackAreaRef}
        className="scrollable"
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {tracks.length === 0 && (
          <div
            style={{
              margin: "32px auto 16px",
              padding: "20px 24px",
              maxWidth: 440,
              borderRadius: 16,
              border: "1px dashed #334155",
              background: "rgba(15,23,42,0.65)",
              textAlign: "center",
              fontSize: 14,
              color: "#94a3b8",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ display: "block", marginBottom: 6, color: "#e2e8f0" }}>
              This loop is waiting for its first track.
            </strong>
            Use the green <em style={{ color: "#27E0B0", fontStyle: "normal" }}>+ Track</em>{" "}
            button beside the Play controls above to add an instrument and start building
            your beat.
          </div>
        )}
        {tracks.map((t) => {
          let labelTimer: number | null = null;
          const color = getInstrumentColor(t.instrument);
          const isMuted = t.muted;
          const isEditing = editing === t.id;
          const trackLabel = getTrackNumberLabel(tracks, t.id);
          const trackPattern = t.pattern;
          const trackPackSource = t.source
            ? packs.find((candidate) => candidate.id === t.source?.packId) ?? pack
            : pack;
          const trackInstrumentId = t.source?.instrumentId ?? t.instrument ?? "";
          const instrumentDefinition = trackInstrumentId
            ? (trackPackSource.instruments[
                trackInstrumentId
              ] as InstrumentDefinition | undefined)
            : undefined;
          const fallbackInstrumentId =
            trackInstrumentId && trackInstrumentId.length > 0
              ? trackInstrumentId
              : t.instrument && t.instrument.length > 0
                ? t.instrument
                : "instrument";
          const instrumentName =
            instrumentDefinition?.name ??
            formatInstrumentLabel(fallbackInstrumentId);
          const characterId =
            t.source?.characterId ?? trackPattern?.characterId ?? null;
          const characterName =
            characterId && instrumentDefinition
              ? instrumentDefinition.characters?.find(
                  (candidate) => candidate.id === characterId
                )?.name ?? null
              : null;
          const noteName = trackPattern?.note ?? null;
          const hoverLabel = noteName ?? characterName ?? instrumentName;
          const velocityFactor = trackPattern?.velocityFactor ?? 1;
          const pitchOffset = trackPattern?.pitchOffset ?? 0;
          const swingValue = trackPattern?.swing ?? 0;
          const hasActiveSteps = trackPattern
            ? trackPattern.steps.some(Boolean)
            : false;
          const handleLabelPointerDown = (
            event: ReactPointerEvent<HTMLDivElement>
          ) => {
            event.stopPropagation();
            labelLongPressRef.current.set(t.id, false);
            if (labelTimer) window.clearTimeout(labelTimer);
            labelTimer = window.setTimeout(() => {
              labelLongPressRef.current.set(t.id, true);
              onRequestTrackModal(t);
            }, 500);
          };

          const handleLabelPointerUp = (
            event: ReactPointerEvent<HTMLDivElement>
          ) => {
            event.stopPropagation();
            if (labelTimer) window.clearTimeout(labelTimer);
            labelTimer = null;
            const triggered = labelLongPressRef.current.get(t.id);
            labelLongPressRef.current.set(t.id, false);
            if (triggered) return;
            handleToggleMute(t.id);
          };

          const handleLabelPointerLeave = () => {
            if (labelTimer) window.clearTimeout(labelTimer);
            labelTimer = null;
            labelLongPressRef.current.set(t.id, false);
          };

          if (isEditing && trackPattern) {
            activeEditingContext = {
              track: t,
              pattern: trackPattern,
              trackLabel,
              color,
              instrumentName,
              characterName,
              hoverLabel,
              velocityFactor,
              pitchOffset,
              swingValue,
              hasActiveSteps,
            };
          }

          return (
            <div
              key={t.id}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div
                onPointerDown={(event) => {
                  swipeRef.current = event.clientX;
                }}
                onPointerUp={(event) => {
                  const dx = event.clientX - swipeRef.current;
                  if (isEditing && dx > 50) {
                    setEditing(null);
                  } else if (!isEditing && Math.abs(dx) < 10) {
                    setEditing(t.id);
                  }
                }}
                style={{
                  display: "flex",
                  height: ROW_HEIGHT,
                  minHeight: ROW_HEIGHT,
                  flex: "none",
                  boxSizing: "border-box",
                  borderRadius: 6,
                  overflow: "hidden",
                  border: isEditing ? "2px solid #27E0B0" : "1px solid #555",
                  background: "#111827",
                  opacity: editing !== null && !isEditing ? 0.4 : 1,
                  pointerEvents:
                    editing !== null && !isEditing ? "none" : "auto",
                  transition: "opacity 0.2s ease, border 0.2s ease",
                }}
              >
                <div
                  onPointerDown={handleLabelPointerDown}
                  onPointerUp={handleLabelPointerUp}
                  onPointerLeave={handleLabelPointerLeave}
                  onPointerCancel={handleLabelPointerLeave}
                  style={{
                    width: LABEL_WIDTH,
                    borderRight: "1px solid #333",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    userSelect: "none",
                    background: isMuted ? "#1b2332" : color,
                    color: isMuted ? "#94a3b8" : "#0f1420",
                    cursor: "pointer",
                    transition: "background 0.2s ease, color 0.2s ease",
                  }}
                  title={isMuted ? "Unmute track" : "Mute track"}
                >
                  {trackLabel}
                </div>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    padding: "0 8px",
                    background: isEditing ? withAlpha(color, 0.12) : "#161d2b",
                    position: "relative",
                    overflow: "hidden",
                    opacity: isMuted ? 0.3 : 1,
                    filter: isMuted ? "grayscale(0.7)" : "none",
                    transition:
                      "opacity 0.2s ease, filter 0.2s ease, background 0.2s ease",
                  }}
                >
                  {trackPattern ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(16, 1fr)",
                        gap: 3,
                        width: "100%",
                        height: "100%",
                        padding: "8px 10px",
                        background: withAlpha(color, isEditing ? 0.12 : 0.08),
                        borderRadius: 10,
                      }}
                    >
                      {Array.from({ length: 16 }).map((_, i) => {
                        const active = trackPattern.steps[i] ?? 0;
                        const isCurrentColumn = step === i;
                        const playing = isCurrentColumn && active;
                        const accentColor = lightenColor(color, 0.25);
                        const measureIndex = Math.floor(i / 4);
                        const isEvenMeasure = measureIndex % 2 === 0;
                        const baseBackground = isEvenMeasure
                          ? withAlpha(color, 0.16)
                          : withAlpha(color, 0.1);
                        const background = active
                          ? isCurrentColumn
                            ? accentColor
                            : lightenColor(color, 0.05)
                          : baseBackground;
                        const borderColor = isCurrentColumn
                          ? lightenColor(color, 0.4)
                          : withAlpha("#ffffff", 0.06);
                        return (
                          <div
                            key={i}
                            style={{
                              position: "relative",
                              border: `1px solid ${borderColor}`,
                              borderLeft:
                                i % 4 === 0
                                  ? `2px solid ${withAlpha("#ffffff", 0.18)}`
                                  : undefined,
                              background,
                              opacity: active
                                ? 1
                                : isCurrentColumn
                                  ? 0.45
                                  : 0.25,
                              borderRadius: 6,
                              boxShadow: playing
                                ? `0 0 12px ${accentColor}, 0 0 22px ${color}`
                                : "none",
                              transition:
                                "background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease",
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      onClick={() => addPattern(t.id)}
                      disabled={!t.instrument}
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: 10,
                        border: t.instrument
                          ? "1px dashed #3b4252"
                          : "1px dashed #242c3c",
                        background: t.instrument ? "#1d2432" : "#161b27",
                        color: t.instrument ? "#e6f2ff" : "#475569",
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        fontWeight: 600,
                        cursor: t.instrument ? "pointer" : "not-allowed",
                      }}
                    >
                      New Pattern
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {activeEditingContext
          ? ((context: TrackEditingContext) => (
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  padding: 16,
                  borderRadius: 12,
                  background: withAlpha(context.color, 0.12),
                  border: `1px solid ${withAlpha(context.color, 0.35)}`,
                  boxShadow: "0 12px 24px rgba(8, 12, 20, 0.45)",
                }}
              >
                <PatternEditor
                  label={context.trackLabel}
                  steps={context.pattern.steps}
                  onToggle={(index) => {
                    const next = context.pattern.steps.slice();
                    next[index] = next[index] ? 0 : 1;
                    updatePattern(context.track.id, next);
                  }}
                  onStepLongPress={(index) =>
                    setStepEditing({
                      trackId: context.track.id,
                      index,
                    })
                  }
                  color={context.color}
                  currentStep={step}
                  instrumentLabel={context.instrumentName}
                  noteLabel={context.hoverLabel}
                />
                <InstrumentSettingsPanel
                  instrumentName={context.instrumentName}
                  styleName={context.characterName}
                  color={context.color}
                  velocity={context.velocityFactor}
                  pitch={context.pitchOffset}
                  swing={context.swingValue}
                  onVelocityChange={(value) =>
                    mutatePattern(
                      context.track.id,
                      (pattern) => ({
                        ...pattern,
                        velocityFactor: value,
                      }),
                      { preview: true }
                    )
                  }
                  onPitchChange={(value) =>
                    mutatePattern(
                      context.track.id,
                      (pattern) => ({
                        ...pattern,
                        pitchOffset: value,
                      }),
                      { preview: true }
                    )
                  }
                  onSwingChange={(value) =>
                    mutatePattern(
                      context.track.id,
                      (pattern) => ({
                        ...pattern,
                        swing: value,
                      }),
                      { preview: true }
                    )
                  }
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <IconButton
                      icon="check"
                      label="Apply pattern"
                      tone="accent"
                      onClick={() => setEditing(null)}
                      style={{ minWidth: 40, minHeight: 40 }}
                    />
                    <IconButton
                      icon="backspace"
                      label="Clear pattern"
                      onClick={() => handleClearTrackPattern(context.track.id)}
                      disabled={!context.hasActiveSteps}
                      style={{ minWidth: 40, minHeight: 40 }}
                    />
                  </div>
                  <IconButton
                    icon="play_arrow"
                    label="Play pattern"
                    onClick={() =>
                      void previewTrackPattern(context.track, context.pattern)
                    }
                    disabled={!context.pattern || !context.track.instrument}
                    style={{ minWidth: 40, minHeight: 40 }}
                  />
                </div>
              </div>
            ))(activeEditingContext)
          : null}
      </div>
      {isLoopsLibraryOpen && (
        <div
          onClick={() => setIsLoopsLibraryOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(8, 12, 20, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#111827",
              border: "1px solid #2a3344",
              borderRadius: 12,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "0 18px 40px rgba(8, 12, 20, 0.6)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 600,
                  color: "#e6f2ff",
                }}
              >
                Loop options
              </h3>
              <button
                type="button"
                onClick={() => setIsLoopsLibraryOpen(false)}
                style={{
                  marginLeft: "auto",
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #333",
                  background: "#1f2532",
                  color: "#e6f2ff",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                lineHeight: 1.6,
                color: "#94a3b8",
              }}
            >
              Rename, duplicate, or remove loops. Use the plus button in Tracks view to
              spin up new ideas quickly.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={openCreateGroup}
                aria-label="Create new loop"
                title="Create new loop"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: isCreatingGroup ? "#27E0B0" : "#1f2532",
                  color: isCreatingGroup ? "#1F2532" : "#e6f2ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 22 }}
                >
                  add
                </span>
              </button>
              <select
                aria-label="Current loop"
                value={selectedGroupId ?? patternGroups[0]?.id ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedGroupId(value || null);
                  setGroupEditor(null);
                  setIsLoopsLibraryOpen(false);
                }}
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#1f2532",
                  color: "#e6f2ff",
                }}
              >
                {patternGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    📼 {group.name}
                  </option>
                ))}
              </select>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              <button
                type="button"
                onClick={handleSnapshotSelectedGroup}
                disabled={!selectedGroup}
                aria-label="Save loop"
                title="Save loop"
                style={{
                  flex: "1 1 100px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: selectedGroup ? "#27E0B0" : "#1f2532",
                  color: selectedGroup ? "#1F2532" : "#64748b",
                  cursor: selectedGroup ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                }}
              >
                <span className="material-symbols-outlined">save</span>
                Save
              </button>
              <button
                type="button"
                onClick={openEditGroup}
                disabled={!selectedGroup}
                aria-label="Edit loop"
                style={{
                  flex: "1 1 100px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: isEditingCurrentGroup ? "#27E0B0" : "#1f2532",
                  color: selectedGroup
                    ? isEditingCurrentGroup
                      ? "#1F2532"
                      : "#e6f2ff"
                    : "#64748b",
                  cursor: selectedGroup ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                }}
              >
                <span className="material-symbols-outlined">edit</span>
                Edit
              </button>
              <button
                type="button"
                onClick={handleDuplicateGroup}
                disabled={!selectedGroup}
                aria-label="Duplicate loop"
                style={{
                  flex: "1 1 110px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#1f2532",
                  color: selectedGroup ? "#e6f2ff" : "#64748b",
                  cursor: selectedGroup ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                }}
              >
                <span className="material-symbols-outlined">content_copy</span>
                Duplicate
              </button>
              <button
                type="button"
                onClick={handleDeleteGroup}
                disabled={!selectedGroup || patternGroups.length <= 1}
                aria-label="Delete loop"
                style={{
                  flex: "1 1 110px",
                  minWidth: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#1f2532",
                  color:
                    selectedGroup && patternGroups.length > 1
                      ? "#fca5a5"
                      : "#64748b",
                  cursor:
                    selectedGroup && patternGroups.length > 1
                      ? "pointer"
                      : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                }}
              >
                <span className="material-symbols-outlined">delete</span>
                Delete
              </button>
            </div>
            {groupEditor ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <input
                  value={groupEditor.name}
                  onChange={(event) =>
                    handleEditorNameChange(event.target.value)
                  }
                  placeholder={getNextGroupName()}
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#1f2532",
                    color: "#e6f2ff",
                  }}
                />
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  {groupEditor.mode === "create"
                    ? "New loops start blank. Name it to keep things organized."
                    : "Rename this loop."}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      handleSaveGroup();
                      setIsLoopsLibraryOpen(false);
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #333",
                      background: "#27E0B0",
                      color: "#1F2532",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {groupEditor.mode === "create"
                      ? "Create New Loop"
                      : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelGroupEdit}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #333",
                      background: "#1f2532",
                      color: "#e6f2ff",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : selectedGroup ? (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {selectedGroup.tracks.length === 0
                  ? "Save this beat to use again later!"
                  : `${selectedGroup.tracks.length} saved track${
                      selectedGroup.tracks.length === 1 ? "" : "s"
                    } including mute states.`}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                Create a loop to capture the current track mix.
              </span>
            )}
          </div>
        </div>
      )}
      {stepEditing && (() => {
        const track = tracks.find((tr) => tr.id === stepEditing.trackId);
        if (!track || !track.pattern) return null;
        const velocity =
          track.pattern.velocities?.[stepEditing.index] ?? 1;
        const pitch = track.pattern.pitches?.[stepEditing.index] ?? 0;
        return (
          <StepModal
            velocity={velocity}
            pitch={pitch}
            onChange={(p) => updateStep(track.id, stepEditing.index, p)}
            onClose={() => setStepEditing(null)}
          />
        );
      })()}
    </div>
  );
}
);

function PatternEditor({
  label,
  steps,
  onToggle,
  onStepLongPress,
  color,
  currentStep,
  instrumentLabel,
  noteLabel,
}: {
  label: string;
  steps: number[];
  onToggle: (index: number) => void;
  onStepLongPress: (index: number) => void;
  color: string;
  currentStep: number;
  instrumentLabel: string;
  noteLabel?: string | null;
}) {
  const longPressRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (hoverTimeoutRef.current) window.clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const hideHoverSoon = () => {
    if (hoverTimeoutRef.current) window.clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredIndex(null);
    }, 200);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 12,
        width: "100%",
        alignItems: "center",
      }}
    >
      <div
        style={{
          minWidth: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "6px 12px",
          borderRadius: 12,
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          background: withAlpha(color, 0.35),
          color: "#0b1220",
          boxShadow: `0 6px 14px ${withAlpha(color, 0.35)}`,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(16, minmax(0, 1fr))",
          gap: 4,
          padding: "12px 14px",
          borderRadius: 14,
          background: withAlpha(color, 0.1),
          border: `1px solid ${withAlpha(color, 0.35)}`,
          boxShadow: "inset 0 0 0 1px rgba(12, 18, 32, 0.4)",
        }}
      >
        {steps.map((value, index) => {
          const isActive = Boolean(value);
          const isCurrent = currentStep === index;
          const playing = isCurrent && isActive;
          const measureIndex = Math.floor(index / 4);
          const isEvenMeasure = measureIndex % 2 === 0;
          const baseBackground = isEvenMeasure
            ? withAlpha(color, 0.16)
            : withAlpha(color, 0.1);
          const activeBackground = isCurrent
            ? lightenColor(color, 0.2)
            : lightenColor(color, 0.06);
          const background = isActive ? activeBackground : baseBackground;
          const borderColor = isCurrent
            ? lightenColor(color, 0.4)
            : withAlpha(color, 0.25);
          const stepNumber = (index + 1).toString().padStart(2, "0");
          const hoverVisible = hoveredIndex === index || playing;
          const tooltip = noteLabel ?? instrumentLabel;
          return (
            <div
              key={index}
              title={`${tooltip} — Step ${stepNumber}`}
              onPointerDown={() => {
                if (hoverTimeoutRef.current)
                  window.clearTimeout(hoverTimeoutRef.current);
                setHoveredIndex(index);
                longPressRef.current = false;
                timerRef.current = window.setTimeout(() => {
                  longPressRef.current = true;
                  onStepLongPress(index);
                }, 500);
              }}
              onPointerEnter={() => {
                if (hoverTimeoutRef.current)
                  window.clearTimeout(hoverTimeoutRef.current);
                setHoveredIndex(index);
              }}
              onPointerUp={() => {
                if (timerRef.current) window.clearTimeout(timerRef.current);
                timerRef.current = null;
                if (longPressRef.current) {
                  longPressRef.current = false;
                  hideHoverSoon();
                  return;
                }
                onToggle(index);
                hideHoverSoon();
              }}
              onPointerLeave={() => {
                if (timerRef.current) window.clearTimeout(timerRef.current);
                timerRef.current = null;
                longPressRef.current = false;
                hideHoverSoon();
              }}
              onPointerCancel={() => {
                if (timerRef.current) window.clearTimeout(timerRef.current);
                timerRef.current = null;
                longPressRef.current = false;
                hideHoverSoon();
              }}
              style={{
                position: "relative",
                border: `1px solid ${borderColor}`,
                borderLeft:
                  index % 4 === 0
                    ? `2px solid ${withAlpha(color, 0.5)}`
                    : undefined,
                background,
                borderRadius: 8,
                cursor: "pointer",
                boxShadow: playing
                  ? `0 0 12px ${lightenColor(color, 0.25)}`
                  : "inset 0 0 0 1px rgba(12, 18, 32, 0.35)",
                minHeight: 44,
                transition:
                  "background 0.15s ease, box-shadow 0.15s ease, border 0.15s ease",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  left: 8,
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgba(148, 163, 184, 0.85)",
                  letterSpacing: 0.4,
                }}
              >
                {stepNumber}
              </span>
              <span
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: "50%",
                  transform: "translateX(-50%)",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: "rgba(10, 14, 22, 0.82)",
                  color: "#e2e8f0",
                  opacity: hoverVisible ? 1 : 0,
                  pointerEvents: "none",
                  transition: "opacity 0.15s ease",
                  whiteSpace: "nowrap",
                }}
              >
                {tooltip}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

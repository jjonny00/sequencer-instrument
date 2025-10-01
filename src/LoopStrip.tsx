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
import type { Track, TriggerMap } from "./tracks";
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
import { StepModal } from "./StepModal";
import type { PatternGroup } from "./song";
import { createPatternGroupId } from "./song";
import { isUserPresetId, loadInstrumentPreset, stripUserPresetPrefix } from "./presets";
import { resolveInstrumentCharacterId } from "./instrumentCharacters";
import { isIOSPWA } from "./utils/audio";
import { getInstrumentColor, lightenColor } from "./utils/color";

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
  patternGroups: PatternGroup[];
  setPatternGroups: Dispatch<SetStateAction<PatternGroup[]>>;
  selectedGroupId: string | null;
  setSelectedGroupId: Dispatch<SetStateAction<string | null>>;
  onAddTrack: () => void;
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
      patternGroups,
      setPatternGroups,
      selectedGroupId,
      setSelectedGroupId,
      onAddTrack,
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
  const [isLoopPreviewExpanded, setIsLoopPreviewExpanded] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const swipeRef = useRef(0);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const trackAreaRef = useRef<HTMLDivElement>(null);
  const labelLongPressRef = useRef<Map<number, boolean>>(new Map());
  const pack = packs[packIndex];
  const canAddTrack = packs.some(
    (candidate) => Object.keys(candidate.instruments).length > 0
  );
  const addTrackEnabled = canAddTrack;
  const isHeroAddTrack = tracks.length === 0;

  useEffect(() => {
    if (tracks.length === 0) {
      setIsLoopPreviewExpanded(true);
    }
  }, [tracks.length]);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!moreMenuRef.current) return;
      if (!moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isMoreMenuOpen]);

  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMoreMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMoreMenuOpen]);

  useEffect(() => {
    console.log("Loop view mounted");
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

  const loopLabel = selectedGroup?.name ?? getNextGroupName();

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
      showToast("Loop duplicated.");
    }
    setGroupEditor(null);
  };

  const handleQuickRename = () => {
    if (!selectedGroup) return;
    const nextName = window.prompt("Rename loop", selectedGroup.name);
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === selectedGroup.name) return;
    setPatternGroups((groups) =>
      groups.map((group) =>
        group.id === selectedGroup.id ? { ...group, name: trimmed } : group
      )
    );
    showToast("Loop renamed.");
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
    showToast("Loop saved.");
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
    showToast("Loop deleted.");
  };

  const handleCancelGroupEdit = () => {
    setGroupEditor(null);
  };

  const updatePattern = (trackId: number, steps: number[]) => {
    setTracks((ts) =>
      ts.map((t) =>
        t.id === trackId && t.pattern
          ? { ...t, pattern: { ...t.pattern, steps } }
          : t
      )
    );
  };

  const updateStep = (
    trackId: number,
    index: number,
    props: { velocity?: number; pitch?: number }
  ) => {
    setTracks((ts) =>
      ts.map((t) => {
        if (t.id === trackId && t.pattern) {
          const velocities = t.pattern.velocities
            ? t.pattern.velocities.slice()
            : Array(16).fill(1);
          const pitches = t.pattern.pitches
            ? t.pattern.pitches.slice()
            : Array(16).fill(0);
          if (props.velocity !== undefined) velocities[index] = props.velocity;
          if (props.pitch !== undefined) pitches[index] = props.pitch;
          return {
            ...t,
            pattern: { ...t.pattern, velocities, pitches },
          };
        }
        return t;
      })
    );
  };

  const hasSelectedGroup = Boolean(selectedGroup);
  const isMobileLibraryLayout =
    typeof window !== "undefined" ? window.innerWidth <= 640 : false;

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
          flexDirection: "column",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            rowGap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => {
              openCreateGroup();
              setIsMoreMenuOpen(false);
              setIsLoopsLibraryOpen(true);
            }}
            aria-label="Add loop"
            title="Add loop"
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1px solid #2a3344",
              background: "#111827",
              color: "#e6f2ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <span
              className="material-symbols-outlined"
              aria-hidden="true"
              style={{ fontSize: 22 }}
            >
              add
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsLoopsLibraryOpen(true);
              setIsMoreMenuOpen(false);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "10px 16px",
              borderRadius: 999,
              border: "1px solid #2a3344",
              background: "#111827",
              color: "#e6f2ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              cursor: "pointer",
            }}
            aria-label="Open loops library"
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: 600,
                letterSpacing: 0.3,
              }}
            >
              {loopLabel}
            </span>
            <span
              className="material-symbols-outlined"
              aria-hidden="true"
              style={{ fontSize: 20 }}
            >
              expand_more
            </span>
          </button>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (!hasSelectedGroup) return;
                handleSnapshotSelectedGroup();
              }}
              disabled={!hasSelectedGroup}
              aria-label="Save loop"
              title="Save loop"
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                border: "1px solid #2a3344",
                background: hasSelectedGroup ? "#111827" : "#1f2532",
                color: hasSelectedGroup ? "#e6f2ff" : "#475569",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: hasSelectedGroup ? "pointer" : "not-allowed",
              }}
            >
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
                style={{ fontSize: 22 }}
              >
                save
              </span>
            </button>
            <div
              ref={moreMenuRef}
              style={{
                position: "relative",
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (!hasSelectedGroup) return;
                  setIsMoreMenuOpen((open) => !open);
                }}
                disabled={!hasSelectedGroup}
                aria-label="More loop actions"
                title="More loop actions"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 999,
                  border: "1px solid #2a3344",
                  background: hasSelectedGroup ? "#111827" : "#1f2532",
                  color: hasSelectedGroup ? "#e6f2ff" : "#475569",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: hasSelectedGroup ? "pointer" : "not-allowed",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 24 }}
                >
                  more_horiz
                </span>
              </button>
              {isMoreMenuOpen && hasSelectedGroup && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 6px)",
                    minWidth: 200,
                    borderRadius: 12,
                    border: "1px solid #1f2937",
                    background: "#0f172a",
                    boxShadow: "0 20px 40px rgba(8, 12, 20, 0.55)",
                    padding: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    zIndex: 5,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      openEditGroup();
                      setIsLoopsLibraryOpen(true);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: "#e6f2ff",
                      cursor: "pointer",
                      fontWeight: 600,
                      letterSpacing: 0.2,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      aria-hidden="true"
                      style={{ fontSize: 20 }}
                    >
                      tune
                    </span>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      handleDuplicateGroup();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: "#e6f2ff",
                      cursor: "pointer",
                      fontWeight: 600,
                      letterSpacing: 0.2,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      aria-hidden="true"
                      style={{ fontSize: 20 }}
                    >
                      content_copy
                    </span>
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      handleDeleteGroup();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: "#fca5a5",
                      cursor: "pointer",
                      fontWeight: 600,
                      letterSpacing: 0.2,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      aria-hidden="true"
                      style={{ fontSize: 20 }}
                    >
                      delete
                    </span>
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      handleQuickRename();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: "#e6f2ff",
                      cursor: "pointer",
                      fontWeight: 600,
                      letterSpacing: 0.2,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      aria-hidden="true"
                      style={{ fontSize: 20 }}
                    >
                      drive_file_rename_outline
                    </span>
                    Rename
                  </button>
                </div>
              )}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
              marginLeft: "auto",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 1,
                height: 32,
                background: "#1f2937",
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (!addTrackEnabled) return;
                onAddTrack();
              }}
              disabled={!addTrackEnabled}
              style={{
                padding: isHeroAddTrack ? "14px 32px" : "10px 24px",
                borderRadius: 999,
                border: "none",
                background: addTrackEnabled
                  ? isHeroAddTrack
                    ? "linear-gradient(135deg, #27E0B0, #6AE0FF)"
                    : "#27E0B0"
                  : "#1f2532",
                color: addTrackEnabled ? "#0b1220" : "#475569",
                fontSize: isHeroAddTrack ? 16 : 14,
                fontWeight: 700,
                letterSpacing: 0.3,
                cursor: addTrackEnabled ? "pointer" : "not-allowed",
                boxShadow: addTrackEnabled
                  ? isHeroAddTrack
                    ? "0 16px 30px rgba(39,224,176,0.35)"
                    : "0 6px 18px rgba(39,224,176,0.25)"
                  : "none",
                transition: "transform 0.2s ease, box-shadow 0.2s ease",
                flexShrink: 0,
              }}
            >
              + Track
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsLoopPreviewExpanded((expanded) => !expanded)}
          aria-expanded={isLoopPreviewExpanded}
          style={{
            alignSelf: "flex-start",
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid #2a3344",
            background: "#111827",
            color: "#94a3b8",
            fontSize: 12,
            letterSpacing: 0.3,
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <span>
            Preview loops from {pack?.name ?? "this pack"}
          </span>
          <span
            className="material-symbols-outlined"
            aria-hidden="true"
            style={{ fontSize: 18 }}
          >
            {isLoopPreviewExpanded ? "expand_less" : "expand_more"}
          </span>
        </button>
        {isLoopPreviewExpanded && (
          <div
            style={{
              background: "#111827",
              borderRadius: 12,
              border: "1px solid #2a3344",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
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
                  color: "#cbd5f5",
                  fontSize: 13,
                }}
              >
                Sample patterns from
                {" "}
                <span
                  style={{
                    color: "#e6f2ff",
                    fontWeight: 600,
                  }}
                >
                  {pack?.name ?? "your current pack"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsLoopsLibraryOpen(true);
                  setIsMoreMenuOpen(false);
                }}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  border: "1px solid #2a3344",
                  background: "#1f2532",
                  color: "#e6f2ff",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  cursor: "pointer",
                }}
              >
                Open Loops Library
              </button>
            </div>
            <div
              className="scrollable"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {patternGroups.length > 0 ? (
                patternGroups.map((group) => {
                  const instrumentLabels = Array.from(
                    new Set(
                      group.tracks
                        .map((track) => track.instrument)
                        .filter((instrument): instrument is string => Boolean(instrument))
                    )
                  ).map((instrumentId) => {
                    const definition = pack?.instruments[instrumentId];
                    return definition?.name ?? instrumentId;
                  });
                  const description = instrumentLabels.length
                    ? instrumentLabels.join(" · ")
                    : "Empty loop — add instruments to this preset.";
                  const isActive = selectedGroup?.id === group.id;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => setSelectedGroupId(group.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `1px solid ${isActive ? "#27E0B0" : "#2a3344"}`,
                        background: isActive ? "#1f2532" : "#0f172a",
                        color: "#e6f2ff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 600,
                            letterSpacing: 0.3,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span aria-hidden="true">📼</span>
                          {group.name}
                        </span>
                        <span
                          style={{
                            color: "#94a3b8",
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        >
                          {description}
                        </span>
                      </div>
                      <span
                        className="material-symbols-outlined"
                        aria-hidden="true"
                        style={{
                          fontSize: 20,
                          color: "#27E0B0",
                        }}
                      >
                        play_arrow
                      </span>
                    </button>
                  );
                })
              ) : (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    border: "1px dashed #2a3344",
                    color: "#94a3b8",
                    textAlign: "center",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  No loops yet. Tap <strong>+</strong> to create one and start
                  building your library.
                </div>
              )}
            </div>
          </div>
        )}
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
              padding: 20,
              textAlign: "center",
              fontSize: 14,
              color: "#94a3b8",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "#e6f2ff" }}>This loop is empty.</strong>
            <br />
            Tap <strong style={{ color: "#27E0B0" }}>+ Track</strong> above to
            choose an instrument and start building your groove.
            <br />
            Need ideas? Browse the loop presets to preview ready-made patterns
            before committing.
          </div>
        )}
        {tracks.map((t) => {
          let labelTimer: number | null = null;
          const color = getInstrumentColor(t.instrument);
          const isMuted = t.muted;
          const isEditing = editing === t.id;
          const trackLabel = getTrackNumberLabel(tracks, t.id);
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
                    background: "#161d2b",
                    position: "relative",
                    overflow: "hidden",
                    opacity: isMuted ? 0.3 : 1,
                    filter: isMuted ? "grayscale(0.7)" : "none",
                    transition: "opacity 0.2s ease, filter 0.2s ease",
                  }}
                >
                  {t.pattern ? (
                    isEditing ? (
                      <PatternEditor
                        steps={t.pattern.steps}
                        onToggle={(i) => {
                          const next = t.pattern!.steps.slice();
                          next[i] = next[i] ? 0 : 1;
                          updatePattern(t.id, next);
                        }}
                        onStepLongPress={(i) =>
                          setStepEditing({ trackId: t.id, index: i })
                        }
                        color={color}
                        currentStep={step}
                      />
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(16, 1fr)",
                          gap: 2,
                          width: "100%",
                          height: "100%",
                        }}
                      >
                        {Array.from({ length: 16 }).map((_, i) => {
                          const active = t.pattern?.steps[i] ?? 0;
                          const isCurrentColumn = step === i;
                          const playing = isCurrentColumn && active;
                          const accentColor = lightenColor(color, 0.25);
                          const background = active
                            ? isCurrentColumn
                              ? accentColor
                              : color
                            : "#1f2532";
                          const borderColor = isCurrentColumn
                            ? lightenColor("#555555", 0.2)
                            : "#555";
                          return (
                            <div
                              key={i}
                              style={{
                                border: `1px solid ${borderColor}`,
                                background,
                                opacity: active ? 1 : isCurrentColumn ? 0.35 : 0.2,
                                boxShadow: playing
                                  ? `0 0 12px ${accentColor}, 0 0 22px ${color}`
                                  : "none",
                                transition: "background 0.15s ease, opacity 0.15s ease, box-shadow 0.15s ease",
                              }}
                            />
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <button
                      onClick={() => addPattern(t.id)}
                      disabled={!t.instrument}
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: 6,
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
      </div>
      {isLoopsLibraryOpen && (
        <div
          onClick={() => {
            setIsLoopsLibraryOpen(false);
            setGroupEditor(null);
            setIsMoreMenuOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(8, 12, 20, 0.72)",
            display: "flex",
            alignItems: isMobileLibraryLayout ? "flex-end" : "center",
            justifyContent: "center",
            padding: isMobileLibraryLayout ? 0 : 24,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: isMobileLibraryLayout ? "100%" : 520,
              maxHeight: isMobileLibraryLayout ? "100%" : "min(80vh, 640px)",
              height: isMobileLibraryLayout ? "100%" : "auto",
              background: "#0b1220",
              border: "1px solid #1f2937",
              borderRadius: isMobileLibraryLayout ? "24px 24px 0 0" : 16,
              padding: isMobileLibraryLayout ? "24px 20px 32px" : 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "0 24px 48px rgba(8, 12, 20, 0.65)",
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
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#e6f2ff",
                }}
              >
                Loops Library
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsLoopsLibraryOpen(false);
                  setGroupEditor(null);
                  setIsMoreMenuOpen(false);
                }}
                aria-label="Close loops library"
                style={{
                  marginLeft: "auto",
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  border: "1px solid #1f2937",
                  background: "#111827",
                  color: "#e6f2ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 20 }}
                >
                  close
                </span>
              </button>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  openCreateGroup();
                  setIsMoreMenuOpen(false);
                }}
                aria-label="Create a new loop"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  borderRadius: 999,
                  border: "1px solid #1f2937",
                  background: isCreatingGroup ? "#27E0B0" : "#111827",
                  color: isCreatingGroup ? "#0b1220" : "#e6f2ff",
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  cursor: "pointer",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  aria-hidden="true"
                  style={{ fontSize: 18 }}
                >
                  add
                </span>
                New Loop
              </button>
              <span
                style={{
                  color: "#94a3b8",
                  fontSize: 13,
                  lineHeight: 1.4,
                  flex: "1 1 220px",
                  minWidth: 0,
                }}
              >
                Saved loops remember track patterns and mute states so you can
                reuse ideas quickly.
              </span>
            </div>
            <div
              className="scrollable"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {patternGroups.length > 0 ? (
                patternGroups.map((group) => {
                  const instrumentLabels = Array.from(
                    new Set(
                      group.tracks
                        .map((track) => track.instrument)
                        .filter((instrument): instrument is string => Boolean(instrument))
                    )
                  ).map((instrumentId) => {
                    const definition = pack?.instruments[instrumentId];
                    return definition?.name ?? instrumentId;
                  });
                  const description = instrumentLabels.length
                    ? instrumentLabels.join(" · ")
                    : "Empty loop — add instruments to this preset.";
                  const isActive = selectedGroup?.id === group.id;
                  const trackCount = group.tracks.length;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        setGroupEditor(null);
                        setIsLoopsLibraryOpen(false);
                        setIsMoreMenuOpen(false);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "12px 16px",
                        borderRadius: 12,
                        border: `1px solid ${isActive ? "#27E0B0" : "#1f2937"}` ,
                        background: isActive ? "#111f2f" : "#0f172a",
                        color: "#e6f2ff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        cursor: "pointer",
                        transition: "border 0.2s ease, background 0.2s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontWeight: 600,
                            letterSpacing: 0.3,
                          }}
                        >
                          <span aria-hidden="true">📼</span>
                          {group.name}
                        </span>
                        <span
                          style={{
                            color: "#94a3b8",
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        >
                          {description}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          color: "#94a3b8",
                          fontSize: 12,
                        }}
                      >
                        <span>{trackCount} track{trackCount === 1 ? "" : "s"}</span>
                        <span
                          className="material-symbols-outlined"
                          aria-hidden="true"
                          style={{ fontSize: 20, color: "#27E0B0" }}
                        >
                          play_arrow
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div
                  style={{
                    padding: 20,
                    borderRadius: 12,
                    border: "1px dashed #1f2937",
                    color: "#94a3b8",
                    textAlign: "center",
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                >
                  No loops yet. Tap <strong>New Loop</strong> to capture your
                  first idea.
                </div>
              )}
            </div>
            {groupEditor && (
              <div
                style={{
                  borderTop: "1px solid #1f2937",
                  paddingTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: 0.3,
                      color: "#cbd5f5",
                    }}
                  >
                    Loop name
                  </label>
                  <input
                    value={groupEditor.name}
                    onChange={(event) =>
                      handleEditorNameChange(event.target.value)
                    }
                    placeholder={getNextGroupName()}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #1f2937",
                      background: "#111827",
                      color: "#e6f2ff",
                    }}
                  />
                </div>
                <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>
                  {groupEditor.mode === "create"
                    ? "Give your loop a memorable name so it's easy to spot later."
                    : "Update the loop name to keep your library organized."}
                </span>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      handleCancelGroupEdit();
                    }}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: "1px solid #1f2937",
                      background: "#111827",
                      color: "#e6f2ff",
                      fontWeight: 600,
                      letterSpacing: 0.3,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleSaveGroup();
                      setIsLoopsLibraryOpen(false);
                    }}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 999,
                      border: "none",
                      background: "#27E0B0",
                      color: "#0b1220",
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      cursor: "pointer",
                      boxShadow: "0 10px 22px rgba(39,224,176,0.35)",
                    }}
                  >
                    {groupEditor.mode === "create"
                      ? "Create loop"
                      : "Save name"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            background: "#0f172a",
            color: "#e6f2ff",
            padding: "12px 18px",
            borderRadius: 999,
            border: "1px solid #27E0B0",
            boxShadow: "0 18px 36px rgba(15, 23, 42, 0.55)",
            fontWeight: 600,
            letterSpacing: 0.3,
            zIndex: 45,
          }}
        >
          {toastMessage}
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
  steps,
  onToggle,
  onStepLongPress,
  color,
  currentStep,
}: {
  steps: number[];
  onToggle: (index: number) => void;
  onStepLongPress: (index: number) => void;
  color: string;
  currentStep: number;
}) {
  const longPressRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        display: "grid",
        gridTemplateColumns: "repeat(16, minmax(0, 1fr))",
        gap: 2,
        height: "100%",
      }}
    >
      {steps.map((v, i) => {
        const playing = currentStep === i && v;
        return (
          <div
            key={i}
            onPointerDown={() => {
              timerRef.current = window.setTimeout(() => {
                longPressRef.current = true;
                onStepLongPress(i);
              }, 500);
            }}
            onPointerUp={() => {
              if (timerRef.current) window.clearTimeout(timerRef.current);
              if (longPressRef.current) {
                longPressRef.current = false;
                return;
              }
              onToggle(i);
            }}
            onPointerLeave={() => {
              if (timerRef.current) window.clearTimeout(timerRef.current);
            }}
            style={{
              border: "1px solid #555",
              background: v ? color : "#1f2532",
              cursor: "pointer",
              boxShadow: playing ? `0 0 6px ${color}` : "none",
            }}
          />
        );
      })}
    </div>
  );
}

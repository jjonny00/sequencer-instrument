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
  const swipeRef = useRef(0);
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
      const candidate = `sequence${String(index).padStart(2, "0")}`;
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
    const confirmed = window.confirm("Delete this sequence? This action cannot be undone.");
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
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => setIsLoopPreviewExpanded((expanded) => !expanded)}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "1px solid #2a3344",
              background: "#111827",
              color: "#e6f2ff",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.3,
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              transition: "background 0.2s ease, color 0.2s ease",
            }}
          >
            <span>Loop: {loopLabel}</span>
            <span aria-hidden="true" style={{ fontSize: 10 }}>
              {isLoopPreviewExpanded ? "▴" : "▾"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!addTrackEnabled) return;
              onAddTrack();
            }}
            disabled={!addTrackEnabled}
            style={{
              padding: isHeroAddTrack ? "14px 32px" : "8px 20px",
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
            }}
          >
            + Track
          </button>
        </div>
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
                  color: "#94a3b8",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    color: "#e6f2ff",
                    fontWeight: 600,
                    marginRight: 4,
                  }}
                >
                  {pack?.name ?? "Current pack"}
                </span>
                presets ready to explore
              </div>
              <button
                type="button"
                onClick={() => setIsLoopsLibraryOpen(true)}
                style={{
                  padding: "6px 12px",
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
                Manage loops
              </button>
            </div>
            <div
              className="scrollable"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                maxHeight: 160,
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
                  You don't have any saved loops yet. Open the loop manager to
                  capture patterns you like.
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
                Loops Library
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
                aria-label="Save sequence"
                title="Save sequence"
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
                aria-label="Edit sequence"
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
                aria-label="Duplicate sequence"
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

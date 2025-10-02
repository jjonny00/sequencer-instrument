import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";

import { LoopStrip, type LoopStripHandle } from "./LoopStrip";
import {
  createTriggerKey,
  type Track,
  type TrackInstrument,
  type TriggerMap,
} from "./tracks";
import type { Chunk } from "./chunks";
import { packs, type InstrumentCharacter, type Pack } from "./packs";
import {
  createHarmoniaNodes,
  disposeHarmoniaNodes,
  triggerHarmoniaChord,
  HARMONIA_BASE_VOLUME_DB,
  type HarmoniaNodes,
} from "./instruments/harmonia";
import { createKick } from "./instruments/kickInstrument";
import { SongView } from "./SongView";
import { PatternPlaybackManager } from "./PatternPlaybackManager";
import {
  activateAudio,
  initAudioContext,
  filterValueToFrequency,
  isIOSPWA,
  refreshAudioReadyState,
  audioReady,
} from "./utils/audio";
import type { PatternGroup, PerformanceTrack, SongRow } from "./song";
import {
  createPatternGroupId,
  createPerformanceSettingsSnapshot,
  createPerformanceTrackId,
  createSongRow,
  getNextPatternGroupName,
  getPerformanceTracksSpanMeasures,
} from "./song";
import { AddTrackModal } from "./AddTrackModal";
import { Modal } from "./components/Modal";
import { IconButton } from "./components/IconButton";
import { SavedSongsList } from "./components/SavedSongsList";
import { ViewHeader } from "./components/ViewHeader";
import { getCharacterOptions } from "./addTrackOptions";
import { InstrumentControlPanel } from "./InstrumentControlPanel";
import { exportProjectAudio, exportProjectJson } from "./exporter";
import {
  deleteLoopDraft,
  deleteProject,
  listProjects,
  loadLoopDraft,
  loadProject as loadStoredProject,
  renameProject as renameStoredProject,
  saveLoopDraft,
  saveProject as saveStoredProject,
  type ProjectSortOrder,
  type StoredProjectData,
  type StoredProjectSummary,
} from "./storage";
import {
  isUserPresetId,
  loadInstrumentPreset,
  stripUserPresetPrefix,
} from "./presets";
import { getInstrumentColor } from "./utils/color";
import { resolveInstrumentCharacterId } from "./instrumentCharacters";
import { unlockAudio } from "./utils/audioUnlock";

const isPWARestore = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const performanceWithNavigation = window.performance as Performance & {
    navigation?: PerformanceNavigation;
  };

  const navigationEntries = window.performance.getEntriesByType?.(
    "navigation"
  ) as PerformanceNavigationTiming[];

  const isReloadEntry = navigationEntries?.[0]?.type === "reload";
  const isBackForwardEntry =
    navigationEntries?.[0]?.type === "back_forward";

  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };

  const backForwardType =
    performanceWithNavigation.navigation?.TYPE_BACK_FORWARD ?? 2;
  const navigationType = performanceWithNavigation.navigation?.type;

  // Enhanced detection for PWA state restoration
  return (
    navigationType === backForwardType ||
    isBackForwardEntry ||
    (navigatorWithStandalone.standalone === true && isReloadEntry) ||
    // Additional check: if we have a persisted audio context state
    (isIOSPWA() && Tone.getContext()?.state !== "closed")
  );
};

const createInitialPatternGroup = (): PatternGroup => ({
  id: createPatternGroupId(),
  name: "Loop 01",
  tracks: [],
});

type Subdivision = "16n" | "8n" | "4n";

const CONTROL_BUTTON_SIZE = 44;

const controlButtonBaseStyle: CSSProperties = {
  width: CONTROL_BUTTON_SIZE,
  height: CONTROL_BUTTON_SIZE,
  borderRadius: CONTROL_BUTTON_SIZE / 2,
  border: "1px solid #333",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const controlIconStyle: CSSProperties = {
  fontSize: 24,
};

const transportDividerStyle: CSSProperties = {
  width: 1,
  height: 24,
  background: "#333",
};

const pickCharacterForInstrument = (
  pack: Pack | undefined,
  instrument: TrackInstrument,
  requested?: string | null
): string | null => {
  if (!pack || !instrument) {
    return null;
  }
  const definition = pack.instruments?.[instrument];
  if (!definition) {
    return null;
  }
  if (requested) {
    const existing = definition.characters.find(
      (character) => character.id === requested
    );
    if (existing) {
      return existing.id;
    }
  }
  if (definition.defaultCharacterId) {
    const preferred = definition.characters.find(
      (character) => character.id === definition.defaultCharacterId
    );
    if (preferred) {
      return preferred.id;
    }
  }
  return definition.characters[0]?.id ?? null;
};

const resolvePerformanceTrackSourceForPack = (
  pack: Pack | undefined,
  instrument: TrackInstrument,
  requestedCharacterId?: string | null
): { packId: string | null; characterId: string | null } => {
  if (!pack) {
    return { packId: null, characterId: null };
  }
  return {
    packId: pack.id ?? null,
    characterId: pickCharacterForInstrument(pack, instrument, requestedCharacterId),
  };
};

interface AddTrackModalState {
  isOpen: boolean;
  mode: "add" | "edit";
  targetTrackId: number | null;
  packId: string;
  instrumentId: string;
  characterId: string;
  presetId: string | null;
  context: "track" | "song";
}

type ProjectAction =
  | { kind: "new" }
  | { kind: "stored"; name: string }
  | { kind: "demo" };

interface PendingProjectLoad {
  action: ProjectAction;
  skipConfirmation: boolean;
}

const createDefaultAddTrackState = (): AddTrackModalState => ({
  isOpen: false,
  mode: "add",
  targetTrackId: null,
  packId: "",
  instrumentId: "",
  characterId: "",
  presetId: null,
  context: "track",
});

const cloneChunkState = (chunk: Chunk): Chunk => ({
  ...chunk,
  steps: chunk.steps.slice(),
  velocities: chunk.velocities ? chunk.velocities.slice() : undefined,
  pitches: chunk.pitches ? chunk.pitches.slice() : undefined,
  notes: chunk.notes ? chunk.notes.slice() : undefined,
  degrees: chunk.degrees ? chunk.degrees.slice() : undefined,
  noteEvents: chunk.noteEvents
    ? chunk.noteEvents.map((event) => ({ ...event }))
    : undefined,
  harmoniaStepDegrees: chunk.harmoniaStepDegrees
    ? chunk.harmoniaStepDegrees.slice()
    : undefined,
});

const cloneTrackState = (track: Track): Track => ({
  ...track,
  pattern: track.pattern ? cloneChunkState(track.pattern) : null,
  source: track.source ? { ...track.source } : undefined,
});

const clonePatternGroupState = (group: PatternGroup): PatternGroup => ({
  ...group,
  tracks: group.tracks.map((track) => cloneTrackState(track)),
});

const createDemoProjectData = (): StoredProjectData => {
  const fallbackPack = packs[0];
  const demoPack =
    packs.find((candidate) => candidate.id === "chiptune") ?? fallbackPack;
  const demoPackIndex = Math.max(
    0,
    packs.findIndex((candidate) => candidate.id === demoPack.id)
  );

  const kickPattern: Chunk = {
    id: "demo-kick-pattern",
    name: "Kick Pulse",
    instrument: "kick",
    characterId: "chip_square_thump",
    steps: [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    velocities: [
      0.95, 0, 0, 0, 0.9, 0, 0.82, 0, 0.9, 0, 0, 0, 0.88, 0, 0.8, 0,
    ],
  };

  const snarePattern: Chunk = {
    id: "demo-snare-pattern",
    name: "Backbeat",
    instrument: "snare",
    characterId: "noise-crack",
    steps: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  };

  const bassPattern: Chunk = {
    id: "demo-bass-pattern",
    name: "Drive Bass",
    instrument: "bass",
    characterId: "square-bass",
    steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    velocities: [0.9, 0, 0, 0, 0.82, 0, 0, 0, 0.86, 0, 0, 0, 0.8, 0, 0, 0],
    note: "C3",
  };

  const baseTracks: Track[] = [
    {
      id: 1,
      name: "Kick",
      instrument: "kick",
      pattern: kickPattern,
      muted: false,
      source: {
        packId: demoPack.id,
        instrumentId: "kick",
        characterId: "chip_square_thump",
        presetId: "chip-kick-sync",
      },
    },
    {
      id: 2,
      name: "Snare",
      instrument: "snare",
      pattern: snarePattern,
      muted: false,
      source: {
        packId: demoPack.id,
        instrumentId: "snare",
        characterId: "noise-crack",
        presetId: "chip-snare-backbeat",
      },
    },
    {
      id: 3,
      name: "Bass",
      instrument: "bass",
      pattern: bassPattern,
      muted: false,
      source: {
        packId: demoPack.id,
        instrumentId: "bass",
        characterId: "square-bass",
        presetId: "chip-bass-drive",
      },
    },
  ];

  const trackSnapshots = baseTracks.map((track) => cloneTrackState(track));
  const patternGroupId = "pg-demo";
  const patternGroups: PatternGroup[] = [
    {
      id: patternGroupId,
      name: "demo-loop",
      tracks: trackSnapshots.map((track) => cloneTrackState(track)),
    },
  ];

  const songRows: SongRow[] = [
    {
      slots: [patternGroupId],
      muted: false,
      velocity: 1,
      performanceTrackId: null,
    },
  ];

  return {
    packIndex: demoPackIndex,
    bpm: 110,
    subdivision: "16n",
    isPlaying: false,
    tracks: trackSnapshots,
    patternGroups,
    songRows,
    performanceTracks: [],
    selectedGroupId: patternGroupId,
    currentSectionIndex: 0,
  };
};

const createEmptyProjectData = (): StoredProjectData => {
  const group = createInitialPatternGroup();
  return {
    packIndex: 0,
    bpm: 120,
    subdivision: "16n",
    isPlaying: false,
    tracks: [],
    patternGroups: [group],
    songRows: [createSongRow()],
    performanceTracks: [],
    selectedGroupId: group.id,
    currentSectionIndex: 0,
  };
};

export default function App() {
  const [started, setStarted] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [subdiv, setSubdiv] = useState<Subdivision>("16n");
  const [isPlaying, setIsPlaying] = useState(false);
  const [packIndex, setPackIndex] = useState(0);
  const [toneGraphVersion, setToneGraphVersion] = useState(0);
  const [showAudioUnlockPrompt, setShowAudioUnlockPrompt] = useState(false);
  const [handlerVersion, setHandlerVersion] = useState(0);

  // Instruments (kept across renders)
  type ToneInstrument = Tone.ToneAudioNode & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    triggerAttackRelease: (...args: any[]) => any;
  };
  const instrumentRefs = useRef<Record<string, ToneInstrument>>({});
  const keyboardFxRefs = useRef<
    Record<
      string,
      {
        reverb: Tone.Reverb;
        delay: Tone.FeedbackDelay;
        distortion: Tone.Distortion;
        bitCrusher: Tone.BitCrusher;
        panner: Tone.Panner;
        chorus: Tone.Chorus;
        tremolo: Tone.Tremolo;
        filter: Tone.Filter;
      }
    >
  >({});
  const harmoniaNodesRef = useRef<Record<string, HarmoniaNodes>>({});

  const [tracks, setTracks] = useState<Track[]>([]);
  const [performanceTracks, setPerformanceTracks] = useState<
    PerformanceTrack[]
  >([]);
  const [activePerformanceTrackId, setActivePerformanceTrackId] = useState<
    string | null
  >(null);
  const [isRecording, setIsRecording] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [triggers, setTriggers] = useState<TriggerMap>({});
  const [viewMode, setViewMode] = useState<"track" | "song">("track");
  const [patternGroups, setPatternGroups] = useState<PatternGroup[]>(() => [
    createInitialPatternGroup(),
  ]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [songRows, setSongRows] = useState<SongRow[]>([
    createSongRow(),
  ]);
  const [isSongInstrumentPanelOpen, setIsSongInstrumentPanelOpen] =
    useState(false);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const loopStripRef = useRef<LoopStripHandle | null>(null);
  const currentLoopDraftRef = useRef<Track[] | null>(null);
  const skipLoopDraftRestoreRef = useRef(false);
  const previousViewModeRef = useRef<"track" | "song">(viewMode);
  const latestTracksRef = useRef<Track[]>(tracks);
  const lastPersistedLoopSnapshotRef = useRef<string | null>(null);
  const [pendingLoopStripAction, setPendingLoopStripAction] = useState<
    "openLibrary" | null
  >(null);
  const [addTrackModalState, setAddTrackModalState] = useState<AddTrackModalState>(
    () => createDefaultAddTrackState()
  );
  const [projectModalMode, setProjectModalMode] = useState<"save" | "load" | null>(
    null
  );
  const [projectNameInput, setProjectNameInput] = useState("");
  const [projectList, setProjectList] = useState<StoredProjectSummary[]>([]);
  const [projectSortOrder, setProjectSortOrder] =
    useState<ProjectSortOrder>("recent");
  const [projectModalError, setProjectModalError] = useState<string | null>(
    null
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth
  );

  useEffect(() => {
    const pack = packs[packIndex];
    setPerformanceTracks((prev) =>
      prev.map((track) => {
        const { packId, characterId } = resolvePerformanceTrackSourceForPack(
          pack,
          track.instrument,
          track.characterId ?? null
        );
        const nextPackId = packId ?? null;
        const nextCharacterId = characterId ?? null;
        if (
          (track.packId ?? null) === nextPackId &&
          (track.characterId ?? null) === nextCharacterId
        ) {
          return track;
        }
        return {
          ...track,
          packId: nextPackId,
          characterId: nextCharacterId,
        };
      })
    );
  }, [packIndex]);

  const [activeProjectName, setActiveProjectName] = useState("untitled");
  const [hasUnsavedLoopChanges, setHasUnsavedLoopChanges] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAudioExporting, setIsAudioExporting] = useState(false);
  const [audioExportMessage, setAudioExportMessage] = useState(
    "Preparing export…"
  );
  const [pendingProjectLoad, setPendingProjectLoad] =
    useState<PendingProjectLoad | null>(null);
  const [isUnsavedChangesModalOpen, setIsUnsavedChangesModalOpen] =
    useState(false);
  const selectedTrack = useMemo(
    () => (editing !== null ? tracks.find((track) => track.id === editing) ?? null : null),
    [editing, tracks]
  );
  const restorationRef = useRef(false);
  const previousStartedRef = useRef(started);

  useEffect(() => {
    latestTracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    if (viewMode !== "song") {
      setIsSongInstrumentPanelOpen(false);
    }
  }, [viewMode]);

  const loopStateSignature = useMemo(
    () =>
      JSON.stringify({
        tracks,
        patternGroups,
      }),
    [tracks, patternGroups]
  );

  useEffect(() => {
    const projectName = activeProjectName.trim();
    if (!projectName) return;
    if (lastPersistedLoopSnapshotRef.current === null) {
      lastPersistedLoopSnapshotRef.current = loopStateSignature;
      setHasUnsavedLoopChanges(false);
      return;
    }
    const dirty = loopStateSignature !== lastPersistedLoopSnapshotRef.current;
    setHasUnsavedLoopChanges(dirty);
    if (dirty) {
      saveLoopDraft(projectName, {
        tracks: tracks.map((track) => cloneTrackState(track)),
        patternGroups: patternGroups.map((group) =>
          clonePatternGroupState(group)
        ),
      });
    } else {
      deleteLoopDraft(projectName);
    }
  }, [
    activeProjectName,
    loopStateSignature,
    patternGroups,
    tracks,
  ]);

  useEffect(() => {
    if (previousStartedRef.current && !started) {
      setHandlerVersion((version) => version + 1);
      setShowAudioUnlockPrompt(false);
    }
    previousStartedRef.current = started;
    refreshAudioReadyState();
  }, [started]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const toneContext = Tone.getContext();
    const context =
      "rawContext" in toneContext
        ? (toneContext.rawContext as AudioContext)
        : ((toneContext as unknown) as AudioContext);

    const handleStateChange = () => {
      const running = refreshAudioReadyState();
      if (running) {
        setShowAudioUnlockPrompt(false);
      }
    };

    handleStateChange();

    if (typeof context.addEventListener === "function") {
      const listener = () => handleStateChange();
      context.addEventListener("statechange", listener);
      return () => {
        context.removeEventListener("statechange", listener);
      };
    }

    const previousHandler = context.onstatechange;
    const handlerWrapper = (event: Event) => {
      handleStateChange();
      if (typeof previousHandler === "function") {
        previousHandler.call(context, event);
      }
    };
    context.onstatechange = handlerWrapper;

    return () => {
      if (context.onstatechange === handlerWrapper) {
        context.onstatechange = previousHandler ?? null;
      }
    };
  }, []);

  const updateLoopBaseline = useCallback(
    (tracksData: Track[], patternGroupData: PatternGroup[]) => {
      lastPersistedLoopSnapshotRef.current = JSON.stringify({
        tracks: tracksData,
        patternGroups: patternGroupData,
      });
      setHasUnsavedLoopChanges(false);
    },
    []
  );

  useEffect(() => {
    const restoring = isPWARestore();
    restorationRef.current = restoring;

    console.log("App initializing:", {
      isIOSPWA: isIOSPWA(),
      restoring,
    });
  }, []);
  const pendingTransportStateRef = useRef<boolean | null>(null);

  const resolveInstrumentCharacter = useCallback(
    (
      packId: string,
      instrumentId: string,
      requestedId?: string | null
    ): InstrumentCharacter | undefined => {
      const pack = packs.find((candidate) => candidate.id === packId);
      const definition = pack?.instruments?.[instrumentId];
      if (!definition) return undefined;
      if (requestedId) {
        const specific = definition.characters.find(
          (character) => character.id === requestedId
        );
        if (specific) {
          return specific;
        }
      }
      if (definition.defaultCharacterId) {
        const preferred = definition.characters.find(
          (character) => character.id === definition.defaultCharacterId
        );
        if (preferred) {
          return preferred;
        }
      }
      return definition.characters[0];
    },
    []
  );

  const resolveHarmoniaNodeKey = useCallback(
    (packId: string, requestedId?: string | null) => {
      const character = resolveInstrumentCharacter(packId, "harmonia", requestedId);
      if (!character) return undefined;
      return `${packId}:harmonia:${character.id}`;
    },
    [resolveInstrumentCharacter]
  );

  const handleHarmoniaRealtimeChange = useCallback(
    ({
      tone,
      dynamics,
      characterId,
      packId,
    }: {
      tone: number;
      dynamics: number;
      characterId?: string | null;
      packId?: string | null;
    }) => {
      const effectivePackId =
        packId ?? packs[packIndex]?.id ?? packs[0]?.id ?? null;
      if (!effectivePackId) return;
      const key = resolveHarmoniaNodeKey(effectivePackId, characterId);
      if (!key) return;
      const nodes = harmoniaNodesRef.current[key];
      if (!nodes) return;
      const frequency = filterValueToFrequency(tone);
      nodes.filter.frequency.rampTo(frequency, 0.05);
      const clampedDynamics = Math.max(0, Math.min(1, dynamics));
      const gain = Math.max(clampedDynamics, 0.001);
      const gainDb = Tone.gainToDb(gain);
      nodes.volume.volume.rampTo(HARMONIA_BASE_VOLUME_DB + gainDb, 0.05);
    },
    [packIndex, resolveHarmoniaNodeKey]
  );

  useEffect(() => {
    const updateAppHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty(
        "--app-height",
        `${height}px`
      );
    };

    updateAppHeight();
    window.addEventListener("resize", updateAppHeight);
    window.visualViewport?.addEventListener("resize", updateAppHeight);

    return () => {
      window.removeEventListener("resize", updateAppHeight);
      window.visualViewport?.removeEventListener("resize", updateAppHeight);
    };
  }, []);

  useEffect(() => {
    setIsRecording(false);
  }, [editing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, []);

  const isCompactTransport = viewportWidth < 430;
  const canAddTrack = useMemo(
    () => packs.some((candidate) => Object.keys(candidate.instruments).length > 0),
    []
  );

  const canRecordSelectedTrack = useMemo(() => {
    if (!selectedTrack || !selectedTrack.instrument) return false;
    if (!selectedTrack.pattern) return false;
    return ["arp", "keyboard", "harmonia"].includes(selectedTrack.instrument);
  }, [selectedTrack]);

  const canClearSelectedTrack = Boolean(selectedTrack?.pattern);

  const handleToggleRecording = useCallback(() => {
    setIsRecording((prev) => !prev);
  }, []);

  const openAddTrackModal = useCallback(() => {
    setAddTrackModalState({
      ...createDefaultAddTrackState(),
      isOpen: true,
      context: "track",
    });
  }, []);

  const openAddPerformanceTrackModal = useCallback(() => {
    setAddTrackModalState({
      ...createDefaultAddTrackState(),
      isOpen: true,
      context: "song",
    });
  }, []);

  const closeAddTrackModal = useCallback(() => {
    setAddTrackModalState((state) => ({ ...state, isOpen: false }));
  }, []);

  const handleSelectAddTrackPack = useCallback(
    (packId: string) => {
      const index = packs.findIndex((p) => p.id === packId);
      if (index >= 0 && index !== packIndex) {
        setPackIndex(index);
      }
      setAddTrackModalState((state) => {
        if (state.packId === packId) {
          return state;
        }
        return {
          ...state,
          packId,
          instrumentId: "",
          characterId: "",
          presetId: null,
        };
      });
    },
    [packIndex, setPackIndex]
  );

  const handleSelectAddTrackInstrument = useCallback((instrumentId: string) => {
    setAddTrackModalState((state) => {
      if (state.instrumentId === instrumentId) {
        return state;
      }
      return {
        ...state,
        instrumentId,
        characterId: "",
        presetId: null,
      };
    });
  }, []);

  const handleSelectAddTrackCharacter = useCallback((characterId: string) => {
    setAddTrackModalState((state) => ({ ...state, characterId }));
  }, []);

  const handleSelectAddTrackPreset = useCallback((presetId: string | null) => {
    setAddTrackModalState((state) => ({ ...state, presetId }));
  }, []);

  const handleRequestTrackModal = useCallback(
    (track: Track) => {
      const preferredPackId =
        track.source?.packId ?? packs[packIndex]?.id ?? packs[0]?.id ?? "";
      const pack = packs.find((candidate) => candidate.id === preferredPackId);
      if (!pack) return;
      const packPosition = packs.findIndex((candidate) => candidate.id === pack.id);
      if (packPosition >= 0 && packPosition !== packIndex) {
        setPackIndex(packPosition);
      }
      const instrumentOptions = Object.keys(pack.instruments);
      let instrumentId =
        track.source?.instrumentId ?? (track.instrument ? track.instrument : "");
      if (!instrumentOptions.includes(instrumentId) && instrumentOptions.length > 0) {
        instrumentId = instrumentOptions[0];
      }
      if (!instrumentId && instrumentOptions.length > 0) {
        instrumentId = instrumentOptions[0];
      }
      const characters = instrumentId
        ? getCharacterOptions(pack.id, instrumentId)
        : [];
      let characterId = track.source?.characterId ?? (characters[0]?.id ?? "");
      if (
        characters.length > 0 &&
        !characters.some((character) => character.id === characterId)
      ) {
        characterId = characters[0].id;
      }
      const presetOptions = pack.chunks.filter(
        (chunk) => chunk.instrument === instrumentId
      );
      let presetId = track.source?.presetId ?? null;
      if (
        presetId &&
        !isUserPresetId(presetId) &&
        !presetOptions.some((preset) => preset.id === presetId)
      ) {
        presetId = presetOptions[0]?.id ?? null;
      }
      setAddTrackModalState({
        isOpen: true,
        mode: "edit",
        targetTrackId: track.id,
        packId: pack.id,
        instrumentId,
        characterId,
        presetId,
        context: "track",
      });
    },
    [packIndex, setPackIndex]
  );

  useEffect(() => {
    if (!addTrackModalState.isOpen) return;
    if (!addTrackModalState.packId) return;
    const pack = packs.find((p) => p.id === addTrackModalState.packId);
    if (!pack) return;

    const instrumentOptions = Object.keys(pack.instruments);
    if (instrumentOptions.length === 0) {
      if (
        addTrackModalState.instrumentId !== "" ||
        addTrackModalState.characterId !== "" ||
        addTrackModalState.presetId !== null
      ) {
        setAddTrackModalState((state) => ({
          ...state,
          instrumentId: "",
          characterId: "",
          presetId: null,
        }));
      }
      return;
    }

    if (
      addTrackModalState.instrumentId &&
      !instrumentOptions.includes(addTrackModalState.instrumentId)
    ) {
      const fallbackInstrument =
        addTrackModalState.mode === "edit" ? instrumentOptions[0] : "";
      setAddTrackModalState((state) => ({
        ...state,
        instrumentId: fallbackInstrument,
        characterId: "",
        presetId: null,
      }));
      return;
    }

    if (!addTrackModalState.instrumentId) {
      if (
        addTrackModalState.characterId !== "" ||
        addTrackModalState.presetId !== null
      ) {
        setAddTrackModalState((state) => ({
          ...state,
          characterId: "",
          presetId: null,
        }));
      }
      return;
    }

    const characters = getCharacterOptions(
      pack.id,
      addTrackModalState.instrumentId
    );

    if (
      addTrackModalState.characterId &&
      !characters.some(
        (character) => character.id === addTrackModalState.characterId
      )
    ) {
      const fallbackCharacter =
        addTrackModalState.mode === "edit" && characters.length > 0
          ? characters[0].id
          : "";
      setAddTrackModalState((state) => ({
        ...state,
        characterId: fallbackCharacter,
        presetId: null,
      }));
      return;
    }

    if (!addTrackModalState.characterId) {
      if (addTrackModalState.presetId !== null) {
        setAddTrackModalState((state) => ({
          ...state,
          presetId: null,
        }));
      }
      return;
    }

    const presetOptions = pack.chunks.filter(
      (chunk) => chunk.instrument === addTrackModalState.instrumentId
    );

    if (
      addTrackModalState.presetId &&
      !isUserPresetId(addTrackModalState.presetId) &&
      !presetOptions.some((preset) => preset.id === addTrackModalState.presetId)
    ) {
      setAddTrackModalState((state) => ({
        ...state,
        presetId:
          addTrackModalState.mode === "edit" && presetOptions.length > 0
            ? presetOptions[0].id
            : null,
      }));
    }
  }, [addTrackModalState]);

  useEffect(() => {
    if (started) Tone.Transport.bpm.value = bpm;
  }, [bpm, started]);

  useEffect(() => {
    const disposeAll = () => {
      Object.values(instrumentRefs.current).forEach((inst) => {
        inst?.dispose?.();
      });
      instrumentRefs.current = {};
      Object.values(keyboardFxRefs.current).forEach((fx) => {
        fx.reverb.dispose();
        fx.delay.dispose();
        fx.distortion.dispose();
        fx.bitCrusher.dispose();
        fx.panner.dispose();
        fx.chorus.dispose();
        fx.tremolo.dispose();
        fx.filter.dispose();
      });
      keyboardFxRefs.current = {};
      Object.values(harmoniaNodesRef.current).forEach((nodes) => {
        disposeHarmoniaNodes(nodes);
      });
      harmoniaNodesRef.current = {};
    };

    if (!started) {
      disposeAll();
      setTriggers({});
      return;
    }

    disposeAll();

    const createInstrumentInstance = (
      packId: string,
      instrumentId: string,
      character: InstrumentCharacter
    ) => {
      if (instrumentId === "kick") {
        const output = new Tone.Gain(0).toDestination();
        const instrument = output as unknown as ToneInstrument;
        instrument.triggerAttackRelease = (
          _note?: Tone.Unit.Frequency,
          duration?: Tone.Unit.Time,
          time?: Tone.Unit.Time,
          velocity?: number
        ) => {
          const voice = createKick(packId, character.id);
          const when = time ?? Tone.now();
          const playDuration = duration ?? "8n";
          voice.triggerAttackRelease(playDuration, when, velocity);
          setTimeout(() => voice.dispose(), 600);
        };
        return { instrument };
      }

      if (character.type === "Harmonia") {
        const nodes = createHarmoniaNodes(Tone, character);
        nodes.volume.connect(Tone.Destination);
        return { instrument: nodes.synth as ToneInstrument, harmoniaNodes: nodes };
      }
      if (!character.type) {
        throw new Error(`Unknown instrument type for character ${character.id}`);
      }
      const ctor = (
        Tone as unknown as Record<
          string,
          new (opts?: Record<string, unknown>) => ToneInstrument
        >
      )[character.type];
      let instrument: ToneInstrument;
      if (character.type === "PolySynth") {
        const options = (character.options ?? {}) as {
          voice?: string;
          voiceOptions?: Record<string, unknown>;
        } & Record<string, unknown>;
        const { voice, voiceOptions, ...polyOptions } = options;
        if (voice && voice in Tone) {
          const VoiceCtor = (
            Tone as unknown as Record<string, new (opts?: Record<string, unknown>) => Tone.Synth>
          )[voice];
          const PolyCtor = Tone.PolySynth as unknown as new (
            voice?: new (opts?: Record<string, unknown>) => Tone.Synth,
            options?: Record<string, unknown>
          ) => ToneInstrument;
          instrument = new PolyCtor(VoiceCtor, voiceOptions ?? {});
          (instrument as unknown as { set?: (values: Record<string, unknown>) => void }).set?.(
            polyOptions
          );
        } else {
          instrument = new ctor(character.options ?? {});
        }
      } else {
        instrument = new ctor(character.options ?? {});
      }
      let node: Tone.ToneAudioNode = instrument;
      (character.effects ?? []).forEach((effect) => {
        const EffectCtor = (
          Tone as unknown as Record<
            string,
            new (opts?: Record<string, unknown>) => Tone.ToneAudioNode
          >
        )[effect.type];
        const eff = new EffectCtor(effect.options ?? {});
        node.connect(eff);
        node = eff;
      });
      if (instrumentId === "keyboard") {
        const reverb = new Tone.Reverb({ decay: 3, wet: 0 });
        const delay = new Tone.FeedbackDelay({
          delayTime: 0.25,
          feedback: 0.3,
          wet: 0,
        });
        const distortion = new Tone.Distortion({ distortion: 0 });
        const bitCrusher = new Tone.BitCrusher(4);
        bitCrusher.wet.value = 0;
        const chorus = new Tone.Chorus(4, 2.5, 0.5).start();
        chorus.wet.value = 0;
        const tremolo = new Tone.Tremolo(9, 0.75).start();
        tremolo.wet.value = 0;
        const filter = new Tone.Filter({ type: "lowpass", frequency: 20000 });
        const panner = new Tone.Panner(0);
        node.connect(distortion);
        distortion.connect(bitCrusher);
        bitCrusher.connect(chorus);
        chorus.connect(tremolo);
        tremolo.connect(filter);
        filter.connect(reverb);
        reverb.connect(delay);
        delay.connect(panner);
        panner.connect(Tone.Destination);
        return {
          instrument,
          keyboardFx: {
            reverb,
            delay,
            distortion,
            bitCrusher,
            panner,
            chorus,
            tremolo,
            filter,
          },
        };
      }
      node.toDestination();
      return { instrument };
    };

    const newTriggers: TriggerMap = {};
    packs.forEach((pack) => {
      Object.keys(pack.instruments).forEach((instrumentId) => {
        const triggerKey = createTriggerKey(pack.id, instrumentId);
        newTriggers[triggerKey] = (
          time: number,
          velocity = 1,
          pitch = 0,
          noteArg?: string,
          sustainArg?: number,
          chunk?: Chunk,
          characterId?: string
        ) => {
          void initAudioContext();
          const character = resolveInstrumentCharacter(
            pack.id,
            instrumentId,
            characterId
          );
          if (!character) return;
          const key = `${pack.id}:${instrumentId}:${character.id}`;
          let inst = instrumentRefs.current[key];
          if (!inst) {
            const created = createInstrumentInstance(pack.id, instrumentId, character);
            inst = created.instrument;
            instrumentRefs.current[key] = inst;
            if (created.keyboardFx) {
              keyboardFxRefs.current[key] = created.keyboardFx;
            }
            if (created.harmoniaNodes) {
              harmoniaNodesRef.current[key] = created.harmoniaNodes;
            }
          }
          const sustainOverride =
            sustainArg ?? (chunk?.sustain !== undefined ? chunk.sustain : undefined);
          if (instrumentId === "harmonia") {
            const nodes = harmoniaNodesRef.current[key];
            if (!nodes) return;
            if (chunk?.attack !== undefined || chunk?.sustain !== undefined) {
              const envelope: Record<string, unknown> = {};
              if (chunk.attack !== undefined) envelope.attack = chunk.attack;
              if (chunk.sustain !== undefined) envelope.release = chunk.sustain;
              if (Object.keys(envelope).length > 0) {
                (inst as unknown as { set?: (values: Record<string, unknown>) => void }).set?.({
                  envelope,
                });
              }
            }
            triggerHarmoniaChord({
              nodes,
              time,
              velocity,
              sustain: sustainOverride,
              chunk,
              characterId: character.id,
            });
            return;
          }
        const settable = inst as unknown as {
          set?: (values: Record<string, unknown>) => void;
        };
          if (chunk?.attack !== undefined || chunk?.sustain !== undefined) {
          const envelope: Record<string, unknown> = {};
          if (chunk.attack !== undefined) envelope.attack = chunk.attack;
          if (chunk.sustain !== undefined) envelope.release = chunk.sustain;
          if (Object.keys(envelope).length > 0) {
            settable.set?.({ envelope });
          }
        }
        if (chunk?.glide !== undefined) {
          settable.set?.({ portamento: chunk.glide });
        }
        if (chunk?.filter !== undefined) {
          settable.set?.({
            filter: { frequency: filterValueToFrequency(chunk.filter) },
          });
        }
        if (instrumentId === "keyboard") {
          const fx = keyboardFxRefs.current[key];
          if (fx) {
            if (chunk?.pan !== undefined) {
              fx.panner.pan.rampTo(chunk.pan, 0.1);
            }
            if (chunk?.reverb !== undefined) {
              fx.reverb.wet.value = chunk.reverb;
            }
            if (chunk?.delay !== undefined) {
              fx.delay.wet.value = chunk.delay;
            }
            if (chunk?.distortion !== undefined) {
              fx.distortion.distortion = chunk.distortion;
            }
            if (chunk?.bitcrusher !== undefined) {
              fx.bitCrusher.wet.value = chunk.bitcrusher;
            }
            if (chunk?.chorus !== undefined) {
              fx.chorus.wet.value = chunk.chorus;
            }
            if (chunk?.filter !== undefined) {
              const frequency = filterValueToFrequency(chunk.filter);
              fx.filter.frequency.rampTo(frequency, 0.1);
            }
          }
        }
        if (inst instanceof Tone.NoiseSynth) {
          inst.triggerAttackRelease(
            sustainOverride ?? character.note ?? "8n",
            time,
            velocity
          );
          return;
        }
        const baseNote = noteArg ?? chunk?.note ?? character.note ?? "C2";
        const targetNote = Tone.Frequency(baseNote).transpose(pitch).toNote();
        const duration = sustainOverride ?? (instrumentId === "keyboard" ? 0.3 : "8n");
        inst.triggerAttackRelease(targetNote, duration, time, velocity);
        };
      });
    });

    setTriggers(newTriggers);

    return () => {
      disposeAll();
    };
  }, [
    started,
    toneGraphVersion,
    resolveInstrumentCharacter,
  ]);

  useEffect(() => {
    if (patternGroups.length === 0) {
      setSelectedGroupId(null);
      return;
    }
    setSelectedGroupId((prev) => {
      if (prev && patternGroups.some((group) => group.id === prev)) {
        return prev;
      }
      return patternGroups[0]?.id ?? null;
    });
  }, [patternGroups]);

  useEffect(() => {
    setSongRows((rows) => {
      const groupIds = new Set(patternGroups.map((group) => group.id));
      let changed = false;
      const next = rows.map((row) => {
        const updatedSlots = row.slots.map((groupId) =>
          groupId && groupIds.has(groupId) ? groupId : null
        );
        const slotsChanged = updatedSlots.some(
          (value, index) => value !== row.slots[index]
        );
        if (slotsChanged) {
          changed = true;
          return { ...row, slots: updatedSlots };
        }
        return row;
      });
      return changed ? next : rows;
    });
  }, [patternGroups]);

  useEffect(() => {
    setEditing((prev) => {
      if (prev === null) return prev;
      return tracks.some((track) => track.id === prev) ? prev : null;
    });
  }, [tracks]);

  useEffect(() => {
    const previousMode = previousViewModeRef.current;
    if (previousMode === "track" && viewMode === "song") {
      currentLoopDraftRef.current = latestTracksRef.current.map((track) =>
        cloneTrackState(track)
      );
    } else if (previousMode === "song" && viewMode === "track") {
      if (!skipLoopDraftRestoreRef.current && currentLoopDraftRef.current) {
        const restored = currentLoopDraftRef.current.map((track) =>
          cloneTrackState(track)
        );
        setTracks(restored);
      }
      skipLoopDraftRestoreRef.current = false;
    }
    previousViewModeRef.current = viewMode;
  }, [viewMode, setTracks]);

  useEffect(() => {
    setCurrentSectionIndex((prev) => {
      const rowColumnCount = songRows.reduce(
        (max, row) => Math.max(max, row.slots.length),
        0
      );
      const performanceColumnCount = getPerformanceTracksSpanMeasures(
        performanceTracks
      );
      const maxColumns = Math.max(rowColumnCount, performanceColumnCount);
      if (maxColumns === 0) return 0;
      return prev >= maxColumns ? maxColumns - 1 : prev;
    });
  }, [songRows, performanceTracks]);

  useEffect(() => {
    if (!started || viewMode !== "song") return;
    const rowColumnCount = songRows.reduce(
      (max, row) => Math.max(max, row.slots.length),
      0
    );
    const performanceColumnCount = getPerformanceTracksSpanMeasures(
      performanceTracks
    );
    const maxColumns = Math.max(rowColumnCount, performanceColumnCount);
    if (maxColumns === 0) return;

    const ticksPerSection = Tone.Time("1m").toTicks();
    if (ticksPerSection === 0) return;

    const applySectionFromTicks = (ticks: number) => {
      const nextSection =
        Math.floor(ticks / ticksPerSection) % Math.max(maxColumns, 1);
      setCurrentSectionIndex((prev) =>
        prev === nextSection ? prev : nextSection
      );
    };

    applySectionFromTicks(Tone.Transport.ticks);

    const id = Tone.Transport.scheduleRepeat((time) => {
      const ticks = Tone.Transport.getTicksAtTime(time);
      Tone.Draw.schedule(() => {
        applySectionFromTicks(ticks);
      }, time);
    }, "1m");

    return () => {
      Tone.Transport.clear(id);
    };
  }, [started, viewMode, songRows, performanceTracks]);

  useEffect(() => {
    if (viewMode === "song") {
      setCurrentSectionIndex(0);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== "track") return;
    if (!pendingLoopStripAction) return;
    let frame = 0;
    const run = () => {
      const handle = loopStripRef.current;
      if (!handle) {
        frame = window.requestAnimationFrame(run);
        return;
      }
      if (pendingLoopStripAction === "openLibrary") {
        handle.openLoopsLibrary();
      }
      setPendingLoopStripAction(null);
    };
    frame = window.requestAnimationFrame(run);
    return () => window.cancelAnimationFrame(frame);
  }, [pendingLoopStripAction, viewMode]);

  const updateTrackPattern = useCallback(
    (trackId: number, updater: (pattern: Chunk) => Chunk) => {
      setTracks((prev) =>
        prev.map((track) => {
          if (track.id !== trackId) return track;
          if (!track.pattern) return track;
          const nextPattern = updater(track.pattern);
          if (nextPattern === track.pattern) return track;
          const nextSource = track.source
            ? {
                ...track.source,
                characterId:
                  nextPattern.characterId !== undefined
                    ? nextPattern.characterId ?? track.source.characterId
                    : track.source.characterId,
              }
            : track.source;
          return {
            ...track,
            pattern: nextPattern,
            source: nextSource ?? track.source,
          };
        })
      );
    },
    [setTracks]
  );

  const handlePresetApplied = useCallback(
    (
      trackId: number,
      {
        presetId,
        characterId,
        name,
      }: { presetId: string | null; characterId?: string | null; name?: string }
    ) => {
      setTracks((prev) =>
        prev.map((track) => {
          if (track.id !== trackId) return track;
          const nextSource = track.source
            ? {
                ...track.source,
                presetId: presetId ?? null,
                ...(characterId !== undefined
                  ? { characterId: characterId ?? track.source.characterId }
                  : {}),
              }
            : track.source;
          return {
            ...track,
            name: name ?? track.name,
            source: nextSource ?? track.source,
          };
        })
      );
    },
    [setTracks]
  );

  const ensurePerformanceRow = useCallback(
    (instrument: TrackInstrument, existingId?: string | null): string | null => {
      if (!instrument) {
        return null;
      }
      const color = getInstrumentColor(instrument);
      const pack = packs[packIndex];
      const { packId, characterId: defaultCharacterId } =
        resolvePerformanceTrackSourceForPack(pack, instrument, null);
      const allowCreateNew = !existingId;
      let ensuredId: string | null =
        existingId ?? activePerformanceTrackId ?? null;

      setPerformanceTracks((prev) => {
        if (ensuredId) {
          const index = prev.findIndex((track) => track.id === ensuredId);
          if (index >= 0) {
            const track = prev[index];
            const nextCharacterId = pack
              ? pickCharacterForInstrument(
                  pack,
                  instrument,
                  track.characterId ?? null
                )
              : track.characterId ?? null;
            const normalizedCharacterId = nextCharacterId ?? null;
            const normalizedPackId = packId ?? track.packId ?? null;
            if (
              track.instrument === instrument &&
              track.color === color &&
              (track.characterId ?? null) === normalizedCharacterId &&
              (track.packId ?? null) === normalizedPackId
            ) {
              return prev;
            }
            const next = prev.slice();
            next[index] = {
              ...track,
              instrument,
              color,
              packId: normalizedPackId,
              characterId: normalizedCharacterId,
            };
            return next;
          }
          if (!allowCreateNew) {
            ensuredId = null;
            return prev;
          }
        }

        if (!allowCreateNew) {
          return prev;
        }

        const nextId = createPerformanceTrackId();
        ensuredId = nextId;
        return [
          ...prev,
          {
            id: nextId,
            instrument,
            color,
            packId: packId ?? null,
            characterId: defaultCharacterId ?? null,
            notes: [],
          },
        ];
      });

      if (!ensuredId) {
        return null;
      }

      setSongRows((prev) => {
        const existingIndex = prev.findIndex(
          (row) => row.performanceTrackId === ensuredId
        );
        if (existingIndex >= 0) {
          return prev;
        }

        const maxColumns = prev.reduce(
          (max, row) => Math.max(max, row.slots.length),
          0
        );
        const newRow = createSongRow(maxColumns > 0 ? maxColumns : 1);
        newRow.performanceTrackId = ensuredId;
        return [...prev, newRow];
      });

      setActivePerformanceTrackId(ensuredId);

      return ensuredId;
    },
    [
      activePerformanceTrackId,
      setPerformanceTracks,
      setSongRows,
      setActivePerformanceTrackId,
      packIndex,
    ]
  );

  const updatePerformanceTrack = useCallback(
    (
      trackId: string,
      updater: (track: PerformanceTrack) => PerformanceTrack
    ) => {
      setPerformanceTracks((prev) => {
        const index = prev.findIndex((track) => track.id === trackId);
        if (index < 0) {
          return prev;
        }
        const current = prev[index];
        const nextTrack = updater(current);
        if (nextTrack === current) {
          return prev;
        }
        const next = prev.slice();
        next[index] = nextTrack;
        return next;
      });
    },
    [setPerformanceTracks]
  );

  const removePerformanceTrack = useCallback(
    (trackId: string) => {
      if (!trackId) return;
      setPerformanceTracks((prev) =>
        prev.filter((track) => track.id !== trackId)
      );
      setSongRows((rows) =>
        rows.map((row) =>
          row.performanceTrackId === trackId
            ? { ...row, performanceTrackId: null }
            : row
        )
      );
      setActivePerformanceTrackId((current) =>
        current === trackId ? null : current
      );
    },
    [setPerformanceTracks, setSongRows, setActivePerformanceTrackId]
  );

  const clearTrackPattern = useCallback(
    (trackId: number) => {
      updateTrackPattern(trackId, (pattern) => {
        const length = pattern.steps.length || 16;
        const steps = Array(length).fill(0);
        const velocities = pattern.velocities
          ? pattern.velocities.map(() => 1)
          : undefined;
        const pitches = pattern.pitches
          ? pattern.pitches.map(() => 0)
          : Array(length).fill(0);
        const next: Chunk = {
          ...pattern,
          steps,
          velocities,
          pitches,
          noteEvents: [],
          noteLoopLength: undefined,
        };
        return next;
      });
    },
    [updateTrackPattern]
  );

  const handleClearSelectedTrack = useCallback(() => {
    if (!selectedTrack || !canClearSelectedTrack) return;
    if (!window.confirm("Clear all steps for this track?")) {
      return;
    }
    clearTrackPattern(selectedTrack.id);
  }, [selectedTrack, canClearSelectedTrack, clearTrackPattern]);

  const buildProjectSnapshot = useCallback((): StoredProjectData => ({
    packIndex,
    bpm,
    subdivision: subdiv,
    isPlaying,
    tracks,
    patternGroups,
    songRows,
    performanceTracks,
    selectedGroupId,
    currentSectionIndex,
  }), [
    packIndex,
    bpm,
    subdiv,
    isPlaying,
    tracks,
    patternGroups,
    songRows,
    performanceTracks,
    selectedGroupId,
    currentSectionIndex,
  ]);

  const handleExportJson = useCallback(() => {
    setIsExportModalOpen(false);
    setAudioExportMessage("Preparing export…");
    try {
      const snapshot = buildProjectSnapshot();
      exportProjectJson({
        project: snapshot,
        projectName: activeProjectName,
      });
    } catch (error) {
      console.error(error);
      window.alert("Failed to export song JSON");
    }
  }, [buildProjectSnapshot, activeProjectName]);

  const handleExportAudio = useCallback(async () => {
    if (!isExportModalOpen) {
      setIsExportModalOpen(true);
    }
    if (isAudioExporting) return;
    const pack = packs[packIndex];
    if (!pack) {
      window.alert("Unable to export audio: pack not found");
      return;
    }
    try {
      const snapshot = buildProjectSnapshot();
      setIsAudioExporting(true);
      setAudioExportMessage("Preparing export…");
      await exportProjectAudio({
        project: snapshot,
        projectName: activeProjectName,
        pack,
        viewMode,
        onProgress: (update) => {
          setAudioExportMessage(update.message);
        },
      });
    } catch (error) {
      console.error(error);
      window.alert("Failed to export audio");
    } finally {
      setIsAudioExporting(false);
    }
  }, [
    buildProjectSnapshot,
    activeProjectName,
    packIndex,
    viewMode,
    isAudioExporting,
    isExportModalOpen,
  ]);

  const handleCloseExportModal = useCallback(() => {
    setIsExportModalOpen(false);
    setAudioExportMessage("Preparing export…");
  }, []);

  const refreshProjectList = useCallback(() => {
    setProjectList(listProjects());
  }, []);

  useEffect(() => {
    if (!projectModalMode) return;
    refreshProjectList();
  }, [projectModalMode, refreshProjectList]);

  const openSaveProjectModal = () => {
    setProjectModalMode("save");
    setProjectNameInput(activeProjectName);
    setProjectModalError(null);
  };

  const openLoadProjectModal = () => {
    setProjectModalMode("load");
    setProjectNameInput("");
    setProjectModalError(null);
  };

  const closeProjectModal = () => {
    setProjectModalMode(null);
    setProjectNameInput("");
    setProjectModalError(null);
  };

  const handleConfirmSaveProject = () => {
    const trimmed = projectNameInput.trim();
    if (!trimmed) {
      setProjectModalError("Enter a song name");
      return;
    }
    try {
      const snapshot = buildProjectSnapshot();
      saveStoredProject(trimmed, snapshot);
      updateLoopBaseline(snapshot.tracks, snapshot.patternGroups);
      deleteLoopDraft(trimmed);
      if (trimmed !== activeProjectName.trim()) {
        deleteLoopDraft(activeProjectName);
      }
      setActiveProjectName(trimmed);
      setProjectModalError(null);
      refreshProjectList();
      setProjectModalMode(null);
    } catch (error) {
      console.error(error);
      setProjectModalError("Failed to save song");
    }
  };

  const applyTransportState = useCallback((shouldPlay: boolean) => {
    if (!started) {
      pendingTransportStateRef.current = shouldPlay;
      setIsPlaying(false);
      return;
    }
    Tone.Transport.stop();
    setIsPlaying(false);
    if (shouldPlay) {
      Tone.Transport.start();
      setIsPlaying(true);
    }
  }, [started]);

  const applyLoadedProject = useCallback(
    (
      project: StoredProjectData,
      options?: {
        baseline?: { tracks: Track[]; patternGroups: PatternGroup[] };
      }
    ) => {
      restorationRef.current = true;
      const packCount = packs.length;
      const nextPackIndex =
        project.packIndex >= 0 && project.packIndex < packCount
          ? project.packIndex
          : 0;
      setPackIndex(nextPackIndex);
      setBpm(project.bpm ?? 120);
      if (project.subdivision && ["16n", "8n", "4n"].includes(project.subdivision)) {
        setSubdiv(project.subdivision as Subdivision);
      }
      const nextTracks = project.tracks;
      setTracks(nextTracks);
      currentLoopDraftRef.current = nextTracks.map((track) =>
        cloneTrackState(track)
      );
      const rawPerformanceTracks = project.performanceTracks ?? [];
      const packForProject = packs[nextPackIndex];
      const nextPerformanceTracks = rawPerformanceTracks.map((track) => {
        const { packId, characterId } = resolvePerformanceTrackSourceForPack(
          packForProject,
          track.instrument,
          track.characterId ?? null
        );
        const nextPackId = packId ?? track.packId ?? null;
        const nextCharacterId = characterId ?? null;
        if (
          (track.packId ?? null) === nextPackId &&
          (track.characterId ?? null) === nextCharacterId
        ) {
          return track;
        }
        return {
          ...track,
          packId: nextPackId,
          characterId: nextCharacterId,
        };
      });
      setPerformanceTracks(nextPerformanceTracks);
      setActivePerformanceTrackId(
        nextPerformanceTracks.length > 0 ? nextPerformanceTracks[0].id : null
      );
      const nextPatternGroups =
        project.patternGroups.length > 0
          ? project.patternGroups
          : [createInitialPatternGroup()];
      setPatternGroups(nextPatternGroups);
      setSongRows(
        project.songRows.length > 0
          ? project.songRows
          : [createSongRow()]
      );
      setSelectedGroupId(project.selectedGroupId ?? null);
      setCurrentSectionIndex(project.currentSectionIndex ?? 0);
      setEditing(null);
      setIsRecording(false);
      applyTransportState(project.isPlaying ?? false);
      const baselineTracks = options?.baseline?.tracks ?? nextTracks;
      const baselinePatternGroups =
        options?.baseline?.patternGroups ?? nextPatternGroups;
      updateLoopBaseline(baselineTracks, baselinePatternGroups);
      setToneGraphVersion((value) => value + 1);
    },
    [applyTransportState, updateLoopBaseline]
  );

  const loadProjectIntoSequencer = useCallback(
    (
      project: StoredProjectData,
      name: string,
      options?: {
        baseline?: { tracks: Track[]; patternGroups: PatternGroup[] };
      }
    ) => {
      skipLoopDraftRestoreRef.current = true;
      applyLoadedProject(project, options);
      setActiveProjectName(name);
      setViewMode("track");
      setStarted(true);
    },
    [applyLoadedProject, setActiveProjectName, setStarted, setViewMode]
  );

  const handleLoadProjectByName = useCallback(
    (name: string) => {
      const project = loadStoredProject(name);
      if (!project) {
        setProjectModalError("Song not found");
        return false;
      }
      const loopDraft = loadLoopDraft(name);
      let projectToApply: StoredProjectData = project;
      let baseline: { tracks: Track[]; patternGroups: PatternGroup[] } | undefined;
      if (loopDraft) {
        const nextPatternGroups =
          loopDraft.patternGroups.length > 0
            ? loopDraft.patternGroups
            : project.patternGroups;
        projectToApply = {
          ...project,
          tracks: loopDraft.tracks,
          patternGroups: nextPatternGroups,
        };
        baseline = {
          tracks: project.tracks,
          patternGroups: project.patternGroups,
        };
      }
      loadProjectIntoSequencer(
        projectToApply,
        name,
        baseline ? { baseline } : undefined
      );
      setProjectModalMode(null);
      setProjectModalError(null);
      return true;
    },
    [loadProjectIntoSequencer]
  );

  const requestProjectAction = useCallback(
    (
      action: ProjectAction,
      {
        skipConfirmation = false,
        bypassUnsavedCheck = false,
      }: { skipConfirmation?: boolean; bypassUnsavedCheck?: boolean } = {}
    ) => {
      if (!bypassUnsavedCheck && hasUnsavedLoopChanges) {
        setPendingProjectLoad({ action, skipConfirmation });
        setIsUnsavedChangesModalOpen(true);
        return false;
      }
      if (!skipConfirmation && started) {
        const confirmed = window.confirm(
          "Load this song? Unsaved changes to your current song will be lost."
        );
        if (!confirmed) {
          return false;
        }
      }

      switch (action.kind) {
        case "new":
          loadProjectIntoSequencer(createEmptyProjectData(), "untitled");
          setProjectModalMode(null);
          setProjectModalError(null);
          return true;
        case "stored":
          return handleLoadProjectByName(action.name);
        case "demo":
          loadProjectIntoSequencer(createDemoProjectData(), "Demo Jam");
          setProjectModalMode(null);
          setProjectModalError(null);
          return true;
        default:
          return false;
      }
    },
    [
      handleLoadProjectByName,
      hasUnsavedLoopChanges,
      loadProjectIntoSequencer,
      setProjectModalError,
      setProjectModalMode,
      started,
    ]
  );

  const handleDeleteProject = useCallback(
    (name: string) => {
      const confirmed = window.confirm(`Delete song "${name}"? This can't be undone.`);
      if (!confirmed) return;
      deleteProject(name);
      refreshProjectList();
      setActiveProjectName((current) => (current === name ? "untitled" : current));
    },
    [refreshProjectList, renameStoredProject]
  );

  const handleRenameProject = useCallback(
    (name: string) => {
      const nextName = window.prompt("Rename song", name);
      if (!nextName) {
        return;
      }
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === name) {
        return;
      }

      try {
        const renamed = renameStoredProject(name, trimmed);
        if (!renamed) {
          window.alert("Unable to rename song. It may have been deleted or moved.");
          return;
        }
        setActiveProjectName((current) =>
          current === name ? trimmed : current
        );
        setProjectNameInput((current) =>
          current.trim() === name ? trimmed : current
        );
        refreshProjectList();
      } catch (error) {
        console.error("Failed to rename song", error);
        window.alert("A song with that name already exists. Try another name.");
      }
    },
    [refreshProjectList]
  );

  const handleCancelPendingProjectLoad = useCallback(() => {
    setIsUnsavedChangesModalOpen(false);
    setPendingProjectLoad(null);
  }, []);

  const handleSaveAndLoadPendingProject = useCallback(() => {
    if (!pendingProjectLoad) return;
    const { action, skipConfirmation } = pendingProjectLoad;
    const snapshot = buildProjectSnapshot();
    const trimmedName = activeProjectName.trim();
    const targetName = trimmedName.length > 0 ? trimmedName : "untitled";
    try {
      saveStoredProject(targetName, snapshot);
      setActiveProjectName(targetName);
      refreshProjectList();
      updateLoopBaseline(snapshot.tracks, snapshot.patternGroups);
      deleteLoopDraft(targetName);
      setIsUnsavedChangesModalOpen(false);
      setPendingProjectLoad(null);
      requestProjectAction(action, {
        skipConfirmation,
        bypassUnsavedCheck: true,
      });
    } catch (error) {
      console.error("Failed to save before loading new project", error);
      window.alert("Failed to save song before loading the next one.");
    }
  }, [
    pendingProjectLoad,
    buildProjectSnapshot,
    activeProjectName,
    refreshProjectList,
    updateLoopBaseline,
    requestProjectAction,
  ]);

  const handleDiscardAndLoadPendingProject = useCallback(() => {
    if (!pendingProjectLoad) return;
    const { action, skipConfirmation } = pendingProjectLoad;
    lastPersistedLoopSnapshotRef.current = loopStateSignature;
    setHasUnsavedLoopChanges(false);
    deleteLoopDraft(activeProjectName);
    setIsUnsavedChangesModalOpen(false);
    setPendingProjectLoad(null);
    requestProjectAction(action, {
      skipConfirmation,
      bypassUnsavedCheck: true,
    });
  }, [
    pendingProjectLoad,
    loopStateSignature,
    activeProjectName,
    requestProjectAction,
  ]);

  const handleChangeProjectSortOrder = useCallback((order: ProjectSortOrder) => {
    setProjectSortOrder(order);
  }, []);

  const unsavedChangesSubtitle =
    pendingProjectLoad?.action.kind === "new"
      ? "You have unsaved changes. Do you want to save before starting a new song?"
      : "You have unsaved changes. Do you want to save before loading this song?";

  const initAudioGraph = useCallback(() => {
    try {
      Tone.Transport.bpm.value = bpm;
      Tone.Transport.start();
      setStarted(true);
      setIsPlaying(true);
      setCurrentSectionIndex(0);

      if (pendingTransportStateRef.current === false) {
        Tone.Transport.stop();
        setIsPlaying(false);
        pendingTransportStateRef.current = null;
      }

      console.log("Audio graph initialized successfully");
    } catch (error) {
      console.warn("Failed to initialize audio graph:", error);
    }
  }, [bpm]);

  const ensureAudioReady = useCallback(async () => {
    const unlocked = await activateAudio();
    const running = refreshAudioReadyState();
    if (!running) {
      console.warn("Audio context is not running; continuing to initialize graph.");
    }
    if (!started) {
      initAudioGraph();
      return unlocked && running;
    }
    return running;
  }, [initAudioGraph, started]);

  const { createNewProject, loadProject, handleLoadDemoSong } = useMemo(() => {
    // Touch handlerVersion so the memo recalculates after activation rebinding.
    void handlerVersion;

    const runProjectAction = (action: ProjectAction) => {
      void (async () => {
        if (!audioReady) {
          await activateAudio();
        }
        refreshAudioReadyState();

        const readyPromise = ensureAudioReady().catch((error) => {
          console.warn("Audio preparation failed:", error);
          return false;
        });

        const triggered = requestProjectAction(action, {
          skipConfirmation: !started,
        });

        if (!triggered) {
          return;
        }

        const ready = await readyPromise;
        if (!ready) {
          switch (action.kind) {
            case "stored":
              console.warn(
                "Audio graph not ready, continuing to load project",
                action.name
              );
              break;
            case "demo":
              console.warn(
                "Audio graph not ready, continuing to load demo song"
              );
              break;
            default:
              console.warn(
                "Audio graph not ready, continuing to load new project"
              );
          }
        }
      })();
    };

    const createNewProjectHandler = () => {
      console.log("New song button clicked");
      runProjectAction({ kind: "new" });
    };

    const loadProjectHandler = (name: string) => {
      runProjectAction({ kind: "stored", name });
    };

    const handleLoadDemoSongHandler = () => {
      runProjectAction({ kind: "demo" });
    };

    return {
      createNewProject: createNewProjectHandler,
      loadProject: loadProjectHandler,
      handleLoadDemoSong: handleLoadDemoSongHandler,
    };
  }, [ensureAudioReady, handlerVersion, requestProjectAction, started]);

  const unlockAndRun = useCallback((action?: () => void) => {
    void (async () => {
      try {
        await unlockAudio();
      } catch (error) {
        console.warn("unlockAudio failed before action:", error);
      } finally {
        action?.();
      }
    })();
  }, []);

  useEffect(() => {
    refreshProjectList();
  }, [refreshProjectList]);

  const handleReturnToSongSelection = useCallback(() => {
    try {
      const snapshot = buildProjectSnapshot();
      const trimmedName = activeProjectName.trim();
      const projectName = trimmedName.length > 0 ? trimmedName : "untitled";
      saveStoredProject(projectName, snapshot);
      updateLoopBaseline(snapshot.tracks, snapshot.patternGroups);
      deleteLoopDraft(projectName);
      if (projectName !== activeProjectName.trim()) {
        deleteLoopDraft(activeProjectName);
      }
      setActiveProjectName(projectName);
    } catch (error) {
      console.error("Failed to save song before returning to selection:", error);
    }
    Tone.Transport.stop();
    setIsPlaying(false);
    setProjectModalMode(null);
    setIsExportModalOpen(false);
    setAudioExportMessage("Preparing export…");
    setAddTrackModalState((state) => ({ ...state, isOpen: false }));
    setEditing(null);
    setIsRecording(false);
    setPendingLoopStripAction(null);
    setCurrentSectionIndex(0);
    setStarted(false);
    skipLoopDraftRestoreRef.current = true;
    currentLoopDraftRef.current = null;
    setViewMode("track");
    refreshProjectList();
  }, [
    buildProjectSnapshot,
    activeProjectName,
    refreshProjectList,
    updateLoopBaseline,
  ]);

  const handlePlayStop = async () => {
    if (isPlaying) {
      Tone.Transport.stop();
      setIsPlaying(false);
      setCurrentSectionIndex(0);
      setShowAudioUnlockPrompt(false);
      return;
    }

    let unlocked = true;
    if (!audioReady) {
      unlocked = await activateAudio();
    } else if (!refreshAudioReadyState()) {
      unlocked = await activateAudio();
    }

    const running = refreshAudioReadyState();

    if (Tone.Transport.state === "stopped") {
      setCurrentSectionIndex(0);
    }
    Tone.Transport.start();
    setIsPlaying(true);

    if (!unlocked || !running) {
      setShowAudioUnlockPrompt(true);
    } else {
      setShowAudioUnlockPrompt(false);
    }
  };

  const handleAudioUnlockPromptTap = useCallback(async () => {
    const unlocked = await activateAudio();
    const running = refreshAudioReadyState();
    if (unlocked && running) {
      setShowAudioUnlockPrompt(false);
      if (isPlaying) {
        Tone.Transport.start();
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!started) return;
    if (pendingTransportStateRef.current === null) return;
    const shouldPlay = pendingTransportStateRef.current;
    pendingTransportStateRef.current = null;
    Tone.Transport.stop();
    setIsPlaying(false);
    if (shouldPlay) {
      Tone.Transport.start();
      setIsPlaying(true);
    }
  }, [started]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      console.log("Document visible, refreshing audio context state");
      void initAudioContext()
        .then(() => {
          refreshAudioReadyState();
          if (Tone.getContext().state === "running") {
            setShowAudioUnlockPrompt(false);
          }
        })
        .catch((error) => {
          console.warn("Failed to refresh audio context:", error);
        });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleSelectLoopFromSongView = useCallback(
    (groupId: string) => {
      setSelectedGroupId(groupId);
      setEditing(null);
      if (viewMode !== "track") {
        skipLoopDraftRestoreRef.current = true;
        setViewMode("track");
        setPendingLoopStripAction(null);
      }
    },
    [setSelectedGroupId, setEditing, viewMode, setPendingLoopStripAction]
  );

  const handleCreateLoopFromSongView = useCallback(() => {
    const newId = createPatternGroupId();
    setPatternGroups((groups) => {
      const name = getNextPatternGroupName(groups);
      return [
        ...groups,
        {
          id: newId,
          name,
          tracks: [],
        },
      ];
    });
    setSelectedGroupId(newId);
    setTracks([]);
    latestTracksRef.current = [];
    currentLoopDraftRef.current = [];
    setEditing(null);
    skipLoopDraftRestoreRef.current = true;
    setViewMode("track");
    setPendingLoopStripAction(null);
  }, [
    setPatternGroups,
    setSelectedGroupId,
    setTracks,
    setEditing,
    setViewMode,
    setPendingLoopStripAction,
  ]);

  const handleConfirmAddTrack = useCallback(() => {
    if (!addTrackModalState.instrumentId || !addTrackModalState.packId) {
      closeAddTrackModal();
      return;
    }

    if (addTrackModalState.context === "song") {
      const pack = packs.find((candidate) => candidate.id === addTrackModalState.packId);
      if (!pack) {
        closeAddTrackModal();
        return;
      }

      const instrumentId = addTrackModalState.instrumentId as TrackInstrument;
      const instrumentDefinition = pack.instruments[instrumentId];

      const resolvePreset = () => {
        const presetId = addTrackModalState.presetId;
        if (!presetId) return null;
        if (isUserPresetId(presetId)) {
          const stored = loadInstrumentPreset(
            addTrackModalState.packId,
            addTrackModalState.instrumentId,
            stripUserPresetPrefix(presetId)
          );
          if (!stored) return null;
          return {
            chunk: stored.pattern,
            characterId: stored.characterId ?? null,
          };
        }
        const presetChunk = pack.chunks.find((chunk) => chunk.id === presetId);
        if (!presetChunk) return null;
        return {
          chunk: presetChunk,
          characterId: presetChunk.characterId ?? null,
        };
      };

      const presetPayload = resolvePreset();
      const resolvedCharacterId = resolveInstrumentCharacterId(
        instrumentDefinition,
        addTrackModalState.characterId || null,
        presetPayload?.characterId ?? null,
        null
      );

      const settings = presetPayload?.chunk
        ? createPerformanceSettingsSnapshot(presetPayload.chunk)
        : undefined;
      const performanceTrackId = createPerformanceTrackId();
      const color = getInstrumentColor(instrumentId);

      setPerformanceTracks((prev) => [
        ...prev,
        {
          id: performanceTrackId,
          instrument: instrumentId,
          color,
          packId: addTrackModalState.packId,
          characterId: resolvedCharacterId ?? null,
          settings,
          notes: [],
        },
      ]);

      setSongRows((rows) => {
        const maxColumns = rows.reduce(
          (max, row) => Math.max(max, row.slots.length),
          0
        );
        const newRow = createSongRow(maxColumns > 0 ? maxColumns : 1);
        newRow.performanceTrackId = performanceTrackId;
        return [...rows, newRow];
      });

      setActivePerformanceTrackId(performanceTrackId);
      closeAddTrackModal();
      return;
    }

    if (
      addTrackModalState.mode === "edit" &&
      addTrackModalState.targetTrackId !== null
    ) {
      loopStripRef.current?.updateTrackWithOptions(
        addTrackModalState.targetTrackId,
        {
          packId: addTrackModalState.packId,
          instrumentId: addTrackModalState.instrumentId,
          characterId: addTrackModalState.characterId,
          presetId: addTrackModalState.presetId,
        }
      );
    } else {
      loopStripRef.current?.addTrackWithOptions({
        packId: addTrackModalState.packId,
        instrumentId: addTrackModalState.instrumentId,
        characterId: addTrackModalState.characterId,
        presetId: addTrackModalState.presetId,
      });
    }
    closeAddTrackModal();
  }, [
    addTrackModalState,
    closeAddTrackModal,
    packs,
    setPerformanceTracks,
    setSongRows,
    setActivePerformanceTrackId,
  ]);

  const handleDeleteTrackFromModal = useCallback(() => {
    if (
      addTrackModalState.mode !== "edit" ||
      addTrackModalState.targetTrackId === null
    ) {
      closeAddTrackModal();
      return;
    }
    const confirmed = window.confirm("Delete this track? This action cannot be undone.");
    if (!confirmed) {
      return;
    }
    loopStripRef.current?.removeTrack(addTrackModalState.targetTrackId);
    closeAddTrackModal();
  }, [addTrackModalState, closeAddTrackModal]);

  const editingTrack = useMemo(
    () =>
      addTrackModalState.mode === "edit" && addTrackModalState.targetTrackId !== null
        ? tracks.find((track) => track.id === addTrackModalState.targetTrackId) ?? null
        : null,
    [tracks, addTrackModalState.mode, addTrackModalState.targetTrackId]
  );

  return (
    <div
      style={{
        height: "var(--app-height)",
        minHeight: "var(--app-height)",
        paddingBottom: "env(safe-area-inset-bottom)",
        boxSizing: "border-box",
        background: "#0f1420",
        color: "#e6f2ff",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        display: "flex",
        flexDirection: "column"
      }}
    >
      {started && showAudioUnlockPrompt ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 20, 32, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            onClick={handleAudioUnlockPromptTap}
            style={{
              padding: "14px 26px",
              borderRadius: 999,
              border: "1px solid #27E0B0",
              background: "rgba(39, 224, 176, 0.15)",
              color: "#27E0B0",
              fontWeight: 600,
              fontSize: 16,
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(39, 224, 176, 0.3)",
            }}
          >
            Tap to enable sound
          </button>
        </div>
      ) : null}

      <AddTrackModal
        isOpen={addTrackModalState.isOpen}
        mode={addTrackModalState.mode}
        packs={packs}
        selectedPackId={addTrackModalState.packId}
        selectedInstrumentId={addTrackModalState.instrumentId}
        selectedCharacterId={addTrackModalState.characterId}
        selectedPresetId={addTrackModalState.presetId}
        triggers={triggers}
        editingTrackName={editingTrack?.name}
        editingTrackPattern={editingTrack?.pattern ?? null}
        onSelectPack={handleSelectAddTrackPack}
        onSelectInstrument={handleSelectAddTrackInstrument}
        onSelectCharacter={handleSelectAddTrackCharacter}
        onSelectPreset={handleSelectAddTrackPreset}
        onCancel={closeAddTrackModal}
        onConfirm={handleConfirmAddTrack}
        onDelete={
          addTrackModalState.mode === "edit"
            ? handleDeleteTrackFromModal
            : undefined
        }
      />

      {projectModalMode && (
        <Modal
          isOpen={projectModalMode !== null}
          onClose={closeProjectModal}
          title={projectModalMode === "save" ? "Save Song" : "Load Song"}
          subtitle={
            projectModalMode === "save"
              ? "Name your jam to store it locally on this device."
              : "Open a saved song from local storage."
          }
          maxWidth={460}
          footer={
            projectModalMode === "save" ? (
              <IconButton
                icon="save"
                label="Save song"
                showLabel
                tone="accent"
                onClick={handleConfirmSaveProject}
                disabled={!projectNameInput.trim()}
              />
            ) : null
          }
        >
          {projectModalMode === "save" ? (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 13, color: "#cbd5f5" }}>Song name</span>
                <input
                  id="project-name"
                  type="text"
                  value={projectNameInput}
                  onChange={(event) => setProjectNameInput(event.target.value)}
                  aria-describedby="project-name-helper"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #2f384a",
                    background: "#0f172a",
                    color: "#e6f2ff",
                  }}
                />
                <span
                  id="project-name-helper"
                  style={{ fontSize: 12, color: "#94a3b8" }}
                >
                  Choose a name so you can find this song later.
                </span>
              </label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  maxHeight: "40vh",
                  overflowY: "auto",
                }}
              >
                {projectList.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>
                    No songs saved yet
                  </div>
                ) : (
                  projectList.map(({ name }) => {
                    const isActive = projectNameInput.trim() === name;
                    return (
                      <div
                        key={name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: isActive ? "1px solid #27E0B0" : "1px solid #1f2937",
                          background: isActive ? "rgba(39,224,176,0.08)" : "#0f172a",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setProjectNameInput(name)}
                          style={{
                            flex: 1,
                            textAlign: "left",
                            background: "transparent",
                            border: "none",
                            color: "#e6f2ff",
                            fontSize: 14,
                            cursor: "pointer",
                          }}
                          title={`Use song name ${name}`}
                        >
                          {name}
                        </button>
                        <IconButton
                          icon="delete"
                          label={`Delete song ${name}`}
                          tone="danger"
                          onClick={() => handleDeleteProject(name)}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxHeight: "50vh",
                overflowY: "auto",
              }}
            >
              {projectList.length === 0 ? (
                <div style={{ fontSize: 13, color: "#94a3b8" }}>
                  No songs saved yet
                </div>
              ) : (
                projectList.map(({ name }) => (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #1f2937",
                      background: "#0f172a",
                    }}
                  >
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        Saved locally
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <IconButton
                        icon="folder_open"
                        label={`Load song ${name}`}
                        tone="accent"
                        onClick={() => unlockAndRun(() => loadProject(name))}
                      />
                      <IconButton
                        icon="delete"
                        label={`Delete song ${name}`}
                        tone="danger"
                        onClick={() => handleDeleteProject(name)}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          {projectModalError ? (
            <div style={{ color: "#f87171", fontSize: 13 }}>{projectModalError}</div>
          ) : null}
        </Modal>
      )}

      {(isExportModalOpen || isAudioExporting) && (
        <Modal
          isOpen={isExportModalOpen || isAudioExporting}
          onClose={handleCloseExportModal}
          title="Export Song"
          maxWidth={420}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 15, color: "#cbd5f5" }}>
              Save your song as audio to share, or as a project file to keep working later.
            </p>
            <div
              aria-hidden="true"
              style={{
                height: 1,
                width: "100%",
                background: "rgba(148, 163, 184, 0.16)",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "stretch",
              }}
            >
              <IconButton
                icon="file_download"
                label="Audio"
                description="Shareable .wav"
                showLabel
                onClick={handleExportAudio}
                disabled={isAudioExporting}
                style={{
                  flex: 1,
                  color: "#27E0B0",
                  borderColor: "#1f2937",
                  background: "#111827",
                }}
                title="Export as audio"
              />
              <IconButton
                icon="folder"
                label="Project File"
                description="Reopen in Sequencer"
                showLabel
                onClick={handleExportJson}
                disabled={isAudioExporting}
                style={{
                  flex: 1,
                  color: "#27E0B0",
                  borderColor: "#1f2937",
                  background: "#111827",
                }}
                title="Export as project file"
              />
            </div>
            {isAudioExporting ? (
              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid #1f2937",
                  background: "#0b1624",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "center",
                  color: "#cbd5f5",
                  fontSize: 13,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 24, color: "#27E0B0" }}
                >
                  hourglass_top
                </span>
                <span>{audioExportMessage}</span>
              </div>
            ) : null}
          </div>
        </Modal>
      )}

      {isUnsavedChangesModalOpen && pendingProjectLoad ? (
        <Modal
          isOpen={isUnsavedChangesModalOpen}
          onClose={handleCancelPendingProjectLoad}
          title="Unsaved changes"
          subtitle={unsavedChangesSubtitle}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              color: "#e6f2ff",
              maxWidth: 360,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                onClick={handleSaveAndLoadPendingProject}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg, #27E0B0, #6AE0FF)",
                  color: "#0b1220",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Save &amp; Load
              </button>
              <button
                type="button"
                onClick={handleDiscardAndLoadPendingProject}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid #ef4444",
                  background: "transparent",
                  color: "#fca5a5",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={handleCancelPendingProjectLoad}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "1px solid #1f2937",
                  background: "#0f172a",
                  color: "#e2e8f0",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {!started ? (
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            alignItems: "center",
            padding: "48px 24px 32px",
            gap: 32,
          }}
        >
          <div
            style={{
              width: "min(760px, 100%)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              textAlign: "center",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 12,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: "#38bdf8",
                fontWeight: 600,
              }}
            >
              Welcome back
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: "2.5rem",
                color: "#e6f2ff",
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              Craft your next groove
            </h1>
            <p
              style={{
                margin: 0,
                maxWidth: 520,
                color: "#94a3b8",
                fontSize: 15,
                lineHeight: 1.6,
              }}
            >
              Jump straight into a fresh idea or pick up a saved session. Everything
              stays synced across your local library.
            </p>
          </div>
          <button
            type="button"
            onClick={() => unlockAndRun(createNewProject)}
            style={{
              padding: "20px 48px",
              borderRadius: 999,
              border: "1px solid rgba(39,224,176,0.4)",
              background: "linear-gradient(135deg, #27E0B0, #6AE0FF)",
              color: "#0b1220",
              fontSize: 18,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
              boxShadow: "0 24px 48px rgba(39,224,176,0.25)",
              letterSpacing: 0.2,
            }}
          >
            <span
              className="material-symbols-outlined"
              aria-hidden="true"
              style={{ fontSize: 22 }}
            >
              add
            </span>
            New Song
          </button>
          <div
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <SavedSongsList
              projects={projectList}
              sortOrder={projectSortOrder}
              onChangeSortOrder={handleChangeProjectSortOrder}
              onSelectProject={(name) =>
                unlockAndRun(() => loadProject(name))
              }
              onRenameProject={handleRenameProject}
              onDeleteProject={handleDeleteProject}
              onTryDemoSong={() => unlockAndRun(handleLoadDemoSong)}
            />
          </div>
        </div>
      ) : (
        <>
          <ViewHeader
            viewMode={viewMode}
            onBack={handleReturnToSongSelection}
            onSelectTrack={() => {
              skipLoopDraftRestoreRef.current = false;
              setViewMode("track");
            }}
            onSelectSong={() => {
              setEditing(null);
              setViewMode("song");
            }}
            actions={
              viewMode === "song" && !isSongInstrumentPanelOpen ? (
                <>
                  <IconButton
                    icon="save"
                    label="Save song"
                    onClick={openSaveProjectModal}
                  />
                  <IconButton
                    icon="folder_open"
                    label="Load song"
                    onClick={openLoadProjectModal}
                  />
                  <IconButton
                    icon="file_download"
                    label="Open export options"
                    onClick={() => {
                      setAudioExportMessage("Preparing export…");
                      setIsExportModalOpen(true);
                    }}
                    disabled={isAudioExporting}
                  />
                </>
              ) : undefined
            }
          />
          {viewMode === "track" && (
            <LoopStrip
              ref={loopStripRef}
              started={started}
              isPlaying={isPlaying}
              tracks={tracks}
              editing={editing}
              setEditing={setEditing}
              setTracks={setTracks}
              packIndex={packIndex}
              patternGroups={patternGroups}
              setPatternGroups={setPatternGroups}
              selectedGroupId={selectedGroupId}
              setSelectedGroupId={setSelectedGroupId}
              onRequestTrackModal={handleRequestTrackModal}
            />
          )}
          <div
            style={{
              padding: 16,
              paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {viewMode === "track" ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: 12,
                    gap: 12,
                    flexWrap: "nowrap",
                  }}
                >
                  <button
                    aria-label={isPlaying ? "Stop" : "Play"}
                    onPointerDown={handlePlayStop}
                    onPointerUp={(e) => e.currentTarget.blur()}
                    style={{
                      ...controlButtonBaseStyle,
                      background: isPlaying ? "#E02749" : "#27E0B0",
                      color: isPlaying ? "#ffe4e6" : "#1F2532",
                      fontSize: 24,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={controlIconStyle}
                    >
                      {isPlaying ? "stop" : "play_arrow"}
                    </span>
                  </button>
                  <div style={transportDividerStyle} />
                  {editing !== null ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {selectedTrack && canRecordSelectedTrack ? (
                          <button
                            aria-label={
                              isRecording ? "Stop recording" : "Start recording"
                            }
                            onClick={handleToggleRecording}
                            style={{
                              ...controlButtonBaseStyle,
                              background: isRecording ? "#E02749" : "#111827",
                              border: `1px solid ${isRecording ? "#E02749" : "#333"}`,
                              color: isRecording ? "#ffe4e6" : "#f43f5e",
                            }}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={controlIconStyle}
                            >
                              fiber_manual_record
                            </span>
                          </button>
                        ) : null}
                        <button
                          aria-label="Clear track"
                          onClick={handleClearSelectedTrack}
                          disabled={!canClearSelectedTrack}
                          style={{
                            ...controlButtonBaseStyle,
                            background: canClearSelectedTrack
                              ? "#1f2532"
                              : "#111827",
                            border: `1px solid ${
                              canClearSelectedTrack ? "#333" : "#1f2937"
                            }`,
                            color: canClearSelectedTrack ? "#e6f2ff" : "#475569",
                            cursor: canClearSelectedTrack ? "pointer" : "not-allowed",
                            opacity: canClearSelectedTrack ? 1 : 0.6,
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={controlIconStyle}
                          >
                            cleaning_services
                          </span>
                        </button>
                        <button
                          aria-label="Edit track settings"
                          onClick={() =>
                            selectedTrack && handleRequestTrackModal(selectedTrack)
                          }
                          disabled={!selectedTrack}
                          style={{
                            ...controlButtonBaseStyle,
                            background: "#111827",
                            border: "1px solid #333",
                            color: selectedTrack ? "#38bdf8" : "#475569",
                            cursor: selectedTrack ? "pointer" : "not-allowed",
                            opacity: selectedTrack ? 1 : 0.6,
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={controlIconStyle}
                          >
                            tune
                          </span>
                        </button>
                      </div>
                      <div style={transportDividerStyle} />
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
                          gap: isCompactTransport ? 8 : 12,
                          flex: 1,
                          minWidth: 0,
                          flexWrap: "nowrap",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            flex: "1 1 0",
                            minWidth: 0,
                          }}
                        >
                          <label
                            style={{
                              fontSize: 12,
                              letterSpacing: 0.2,
                              color: "#cbd5f5",
                              whiteSpace: "nowrap",
                            }}
                          >
                            BPM
                          </label>
                          <select
                            value={bpm}
                            onChange={(e) =>
                              setBpm(parseInt(e.target.value, 10))
                            }
                            style={{
                              padding: 8,
                              borderRadius: 8,
                              background: "#121827",
                              color: "white",
                              width: "100%",
                              minWidth: 0,
                            }}
                          >
                            {[90, 100, 110, 120, 130].map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            flex: "1 1 0",
                            minWidth: 0,
                          }}
                        >
                          <label
                            style={{
                              fontSize: 12,
                              letterSpacing: 0.2,
                              color: "#cbd5f5",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Quantize
                          </label>
                          <select
                            value={subdiv}
                            onChange={(e) =>
                              setSubdiv(e.target.value as Subdivision)
                            }
                            style={{
                              padding: 8,
                              borderRadius: 8,
                              background: "#121827",
                              color: "white",
                              width: "100%",
                              minWidth: 0,
                            }}
                          >
                            <option value="16n">1/16</option>
                            <option value="8n">1/8</option>
                            <option value="4n">1/4</option>
                          </select>
                        </div>
                      </div>
                      <div style={transportDividerStyle} />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!canAddTrack) return;
                      openAddTrackModal();
                    }}
                    disabled={!canAddTrack}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "10px 20px",
                      borderRadius: 999,
                      border: "none",
                      background: canAddTrack ? "#27E0B0" : "#1f2532",
                      color: canAddTrack ? "#1F2532" : "#475569",
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      cursor: canAddTrack ? "pointer" : "not-allowed",
                      boxShadow: canAddTrack
                        ? "0 2px 6px rgba(15, 20, 32, 0.35)"
                        : "none",
                      transition: "transform 0.2s ease, box-shadow 0.2s ease",
                      flexShrink: 0,
                      minHeight: 44,
                    }}
                  >
                    + Track
                  </button>
                </div>

                <div
                  className="scrollable"
                  style={{
                    marginTop: 16,
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    overflowY: "auto",
                    minHeight: 0,
                  }}
                >
                  {selectedTrack ? (
                    <InstrumentControlPanel
                      track={selectedTrack}
                      allTracks={tracks}
                      trigger={(() => {
                        if (!selectedTrack.instrument) return undefined;
                        const packId = selectedTrack.source?.packId;
                        const triggerKey = packId
                          ? createTriggerKey(packId, selectedTrack.instrument)
                          : null;
                        const trigger = triggerKey
                          ? triggers[triggerKey] ?? undefined
                          : undefined;
                        if (!trigger) return undefined;
                        const characterId = selectedTrack.source?.characterId;
                        return (
                          time: number,
                          velocity?: number,
                          pitch?: number,
                          note?: string,
                          sustain?: number,
                          chunk?: Chunk
                        ) =>
                          trigger(
                            time,
                            velocity,
                            pitch,
                            note,
                            sustain,
                            chunk,
                            characterId
                          );
                      })()}
                      onUpdatePattern={
                        selectedTrack.pattern
                          ? (updater) =>
                              updateTrackPattern(selectedTrack.id, updater)
                          : undefined
                      }
                      onHarmoniaRealtimeChange={
                        selectedTrack.instrument === "harmonia"
                          ? (payload) => {
                              handleHarmoniaRealtimeChange(payload);
                            }
                          : undefined
                      }
                      isRecording={isRecording}
                      onRecordingChange={setIsRecording}
                      onPresetApplied={handlePresetApplied}
                    />
                  ) : (
                    <div
                      style={{
                        borderRadius: 12,
                        border: "1px solid #2a3344",
                        padding: 24,
                        textAlign: "center",
                        color: "#94a3b8",
                        fontSize: 13,
                      }}
                    >
                      Select a track above to adjust its instrument settings.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <SongView
                patternGroups={patternGroups}
                songRows={songRows}
                setSongRows={setSongRows}
                currentSectionIndex={currentSectionIndex}
                isPlaying={isPlaying}
                bpm={bpm}
                setBpm={setBpm}
                onToggleTransport={handlePlayStop}
                onCreateLoop={handleCreateLoopFromSongView}
                selectedGroupId={selectedGroupId}
                onSelectLoop={handleSelectLoopFromSongView}
                performanceTracks={performanceTracks}
                triggers={triggers}
                onEnsurePerformanceRow={ensurePerformanceRow}
                activePerformanceTrackId={activePerformanceTrackId}
                onAddPerformanceTrack={openAddPerformanceTrackModal}
                onSelectPerformanceTrack={setActivePerformanceTrackId}
                onUpdatePerformanceTrack={updatePerformanceTrack}
                onRemovePerformanceTrack={removePerformanceTrack}
                onPlayInstrumentOpenChange={setIsSongInstrumentPanelOpen}
                onSaveSong={openSaveProjectModal}
                onOpenLoadSong={openLoadProjectModal}
                onOpenExportSong={
                  isAudioExporting
                    ? undefined
                    : () => {
                        setAudioExportMessage("Preparing export…");
                        setIsExportModalOpen(true);
                      }
                }
              />
            )}
          </div>
          <PatternPlaybackManager
            tracks={tracks}
            triggers={triggers}
            started={started}
            viewMode={viewMode}
            patternGroups={patternGroups}
            songRows={songRows}
            currentSectionIndex={currentSectionIndex}
            performanceTracks={performanceTracks}
          />
        </>
      )}
    </div>
  );
}

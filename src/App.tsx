import type {
  CSSProperties,
  TouchEvent as ReactTouchEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";

import { LoopStrip, type LoopStripHandle } from "./LoopStrip";
import type { Track, TriggerMap } from "./tracks";
import type { Chunk } from "./chunks";
import { packs, type InstrumentCharacter, type InstrumentDefinition } from "./packs";
import {
  createHarmoniaNodes,
  disposeHarmoniaNodes,
  triggerHarmoniaChord,
  HARMONIA_BASE_VOLUME_DB,
  type HarmoniaNodes,
} from "./instruments/harmonia";
import {
  createKickDesigner,
  mergeKickDesignerState,
  normalizeKickDesignerState,
  type KickDesignerInstrument,
} from "./instruments/kickDesigner";
import { SongView } from "./SongView";
import { PatternPlaybackManager } from "./PatternPlaybackManager";
import { ensureAudioContextRunning, filterValueToFrequency } from "./utils/audio";
import type { PatternGroup, SongRow } from "./song";
import { createPatternGroupId, createSongRow } from "./song";
import { AddTrackModal } from "./AddTrackModal";
import { Modal } from "./components/Modal";
import { IconButton } from "./components/IconButton";
import { getCharacterOptions } from "./addTrackOptions";
import { InstrumentControlPanel } from "./InstrumentControlPanel";
import { exportProjectAudio, exportProjectJson } from "./exporter";
import {
  deleteProject,
  listProjects,
  loadProject as loadStoredProject,
  saveProject as saveStoredProject,
  type StoredProjectData,
} from "./storage";
import { isUserPresetId } from "./presets";
import { applyKickMacrosToChunk, resolveInstrumentCharacterId } from "./instrumentCharacters";

const isIOSPWA = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };

  return (
    navigatorWithStandalone.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
};

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

const forceAudioContextCleanup = async () => {
  try {
    const context = Tone.getContext();
    if (context) {
      await context.dispose();
    }

    Tone.setContext(new Tone.Context());
    await new Promise((resolve) => setTimeout(resolve, 100));
  } catch (error) {
    console.warn("Audio cleanup failed:", error);
  }
};

const createInitialPatternGroup = (): PatternGroup => ({
  id: createPatternGroupId(),
  name: "sequence01",
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

interface AddTrackModalState {
  isOpen: boolean;
  mode: "add" | "edit";
  targetTrackId: number | null;
  packId: string;
  instrumentId: string;
  characterId: string;
  presetId: string | null;
}

const createDefaultAddTrackState = (
  packIdx: number
): AddTrackModalState => {
  const pack = packs[packIdx];
  if (!pack) {
    return {
      isOpen: false,
      mode: "add",
      targetTrackId: null,
      packId: "",
      instrumentId: "",
      characterId: "",
      presetId: null,
    };
  }
  const instrumentId = Object.keys(pack.instruments)[0] ?? "";
  const characters = instrumentId
    ? getCharacterOptions(pack.id, instrumentId)
    : [];
  const preferredCharacterId = pack.instruments[instrumentId]?.defaultCharacterId;
  const characterId = characters.find((character) => character.id === preferredCharacterId)?.id
    ?? characters[0]?.id
    ?? "";
  const preset = pack.chunks.find((chunk) => chunk.instrument === instrumentId);
  return {
    isOpen: false,
    mode: "add",
    targetTrackId: null,
    packId: pack.id,
    instrumentId,
    characterId,
    presetId: preset ? preset.id : null,
  };
};

export default function App() {
  const [started, setStarted] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [subdiv, setSubdiv] = useState<Subdivision>("16n");
  const [isPlaying, setIsPlaying] = useState(false);
  const [packIndex, setPackIndex] = useState(0);
  const [toneGraphVersion, setToneGraphVersion] = useState(0);

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
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const loopStripRef = useRef<LoopStripHandle | null>(null);
  const [pendingLoopStripAction, setPendingLoopStripAction] = useState<
    "openLibrary" | null
  >(null);
  const [addTrackModalState, setAddTrackModalState] = useState<AddTrackModalState>(
    () => createDefaultAddTrackState(packIndex)
  );
  const [projectModalMode, setProjectModalMode] = useState<"save" | "load" | null>(
    null
  );
  const [projectNameInput, setProjectNameInput] = useState("");
  const [projectList, setProjectList] = useState<string[]>([]);
  const [projectModalError, setProjectModalError] = useState<string | null>(
    null
  );
  const [activeProjectName, setActiveProjectName] = useState("untitled");
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isAudioExporting, setIsAudioExporting] = useState(false);
  const [audioExportMessage, setAudioExportMessage] = useState(
    "Preparing export…"
  );
  const selectedTrack = useMemo(
    () => (editing !== null ? tracks.find((track) => track.id === editing) ?? null : null),
    [editing, tracks]
  );
  const restorationRef = useRef(false);

  useEffect(() => {
    const restoring = isPWARestore();
    restorationRef.current = restoring;

    // No automatic cleanup - only when user clicks
  }, []);
  const pendingTransportStateRef = useRef<boolean | null>(null);
  const isLaunchingNewProjectRef = useRef(false);
  const pendingTouchNewProjectRef = useRef(false);

  const resolveInstrumentCharacter = useCallback(
    (instrumentId: string, requestedId?: string | null): InstrumentCharacter | undefined => {
      const pack = packs[packIndex];
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
    [packIndex]
  );

  const resolveHarmoniaNodeKey = useCallback(
    (requestedId?: string | null) => {
      const character = resolveInstrumentCharacter("harmonia", requestedId);
      if (!character) return undefined;
      return `harmonia:${character.id}`;
    },
    [resolveInstrumentCharacter]
  );

  const handleHarmoniaRealtimeChange = useCallback(
    ({
      tone,
      dynamics,
      characterId,
    }: {
      tone: number;
      dynamics: number;
      characterId?: string | null;
    }) => {
      const key = resolveHarmoniaNodeKey(characterId);
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
    [resolveHarmoniaNodeKey]
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
    setAddTrackModalState(() => {
      const pack = packs[packIndex];
      if (!pack) {
        return {
          isOpen: true,
          mode: "add",
          targetTrackId: null,
          packId: "",
          instrumentId: "",
          characterId: "",
          presetId: null,
        };
      }
      const instrumentId = Object.keys(pack.instruments)[0] ?? "";
      const characters = instrumentId
        ? getCharacterOptions(pack.id, instrumentId)
        : [];
      const characterId = characters[0]?.id ?? "";
      const preset = pack.chunks.find(
        (chunk) => chunk.instrument === instrumentId
      );
      return {
        isOpen: true,
        mode: "add",
        targetTrackId: null,
        packId: pack.id,
        instrumentId,
        characterId,
        presetId: preset ? preset.id : null,
      };
    });
  }, [packIndex]);

  const closeAddTrackModal = useCallback(() => {
    setAddTrackModalState((state) => ({ ...state, isOpen: false }));
  }, []);

  const handleSelectAddTrackPack = useCallback(
    (packId: string) => {
      const index = packs.findIndex((p) => p.id === packId);
      if (index >= 0 && index !== packIndex) {
        setPackIndex(index);
      }
      setAddTrackModalState((state) => ({ ...state, packId }));
    },
    [packIndex, setPackIndex]
  );

  const handleSelectAddTrackInstrument = useCallback((instrumentId: string) => {
    setAddTrackModalState((state) => {
      if (state.instrumentId === instrumentId) {
        return state;
      }
      const pack = packs.find((candidate) => candidate.id === state.packId);
      const characters = instrumentId
        ? getCharacterOptions(state.packId, instrumentId)
        : [];
      const instrumentDefinition = pack?.instruments[instrumentId];
      const preferredCharacterId = instrumentDefinition?.defaultCharacterId;
      const nextCharacterId = characters.length
        ? characters.find((character) => character.id === preferredCharacterId)?.id ?? characters[0].id
        : "";
      const presetOptions = pack
        ? pack.chunks.filter((chunk) => chunk.instrument === instrumentId)
        : [];
      const nextPresetId = presetOptions[0]?.id ?? null;
      return {
        ...state,
        instrumentId,
        characterId: nextCharacterId,
        presetId: nextPresetId,
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
      const pack = packs[packIndex];
      if (!pack) return;
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
      });
    },
    [packIndex]
  );

  useEffect(() => {
    if (!addTrackModalState.isOpen) return;
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
    if (!instrumentOptions.includes(addTrackModalState.instrumentId)) {
      const nextInstrument = instrumentOptions[0];
      const characters = getCharacterOptions(pack.id, nextInstrument);
      const nextCharacter = characters[0]?.id ?? "";
      const presetOptions = pack.chunks.filter(
        (chunk) => chunk.instrument === nextInstrument
      );
      setAddTrackModalState((state) => ({
        ...state,
        instrumentId: nextInstrument,
        characterId: nextCharacter,
        presetId: presetOptions[0]?.id ?? null,
      }));
      return;
    }
    const characters = getCharacterOptions(
      pack.id,
      addTrackModalState.instrumentId
    );
    if (
      characters.length > 0 &&
      !characters.some(
        (character) => character.id === addTrackModalState.characterId
      )
    ) {
      setAddTrackModalState((state) => ({
        ...state,
        characterId: characters[0].id,
      }));
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
        presetId: presetOptions[0]?.id ?? null,
      }));
    }
  }, [addTrackModalState]);

  useEffect(() => {
    if (started) Tone.Transport.bpm.value = bpm;
  }, [bpm, started]);

  useEffect(() => {
    const pack = packs[packIndex];
    setTracks((prev) => {
      const allowed = new Set(Object.keys(pack.instruments));
      let changed = false;
      const nextTracks: Track[] = [];
      prev.forEach((track) => {
        if (track.instrument && !allowed.has(track.instrument)) {
          changed = true;
          return;
        }
        if (!track.instrument) {
          nextTracks.push(track);
          return;
        }
        const instrumentDefinition = pack.instruments[
          track.instrument
        ] as InstrumentDefinition | undefined;
        if (!instrumentDefinition) {
          nextTracks.push(track);
          return;
        }
        const previousPatternCharacterId = track.pattern?.characterId ?? null;
        const resolvedCharacterId = resolveInstrumentCharacterId(
          instrumentDefinition,
          track.source?.characterId ?? null,
          null,
          previousPatternCharacterId
        );
        const nextSource = {
          packId: pack.id,
          instrumentId: track.instrument,
          characterId: resolvedCharacterId,
          presetId: track.source?.presetId ?? null,
        };
        let nextPattern = track.pattern;
        if (track.pattern) {
          const patternWithCharacter =
            track.pattern.characterId === resolvedCharacterId
              ? track.pattern
              : { ...track.pattern, characterId: resolvedCharacterId };
          nextPattern =
            track.instrument === "kick"
              ? applyKickMacrosToChunk(
                  patternWithCharacter,
                  instrumentDefinition,
                  resolvedCharacterId,
                  previousPatternCharacterId
                )
              : patternWithCharacter;
        }
        const sourceChanged =
          !track.source ||
          track.source.packId !== nextSource.packId ||
          track.source.instrumentId !== nextSource.instrumentId ||
          track.source.characterId !== nextSource.characterId ||
          (track.source.presetId ?? null) !== nextSource.presetId;
        const patternChanged = nextPattern !== track.pattern;
        if (sourceChanged || patternChanged) {
          changed = true;
          nextTracks.push({
            ...track,
            source: nextSource,
            pattern: nextPattern,
          });
        } else {
          nextTracks.push(track);
        }
      });
      return changed ? nextTracks : prev;
    });
    setEditing(null);
    if (!restorationRef.current) {
      const initialGroup = createInitialPatternGroup();
      setPatternGroups([initialGroup]);
      setSongRows([createSongRow()]);
      setCurrentSectionIndex(0);
      setSelectedGroupId(null);
    }

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
      instrumentId: string,
      character: InstrumentCharacter
    ) => {
      if (instrumentId === "kick") {
        const defaults = normalizeKickDesignerState(character.defaults);
        const instrument = createKickDesigner(defaults);
        instrument.toDestination();
        return { instrument: instrument as ToneInstrument };
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
    Object.keys(pack.instruments).forEach((instrumentId) => {
      newTriggers[instrumentId] = (
        time: number,
        velocity = 1,
        pitch = 0,
        noteArg?: string,
        sustainArg?: number,
        chunk?: Chunk,
        characterId?: string
      ) => {
        void ensureAudioContextRunning();
        const character = resolveInstrumentCharacter(instrumentId, characterId);
        if (!character) return;
        const key = `${instrumentId}:${character.id}`;
        let inst = instrumentRefs.current[key];
        if (!inst) {
          const created = createInstrumentInstance(instrumentId, character);
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
        if (instrumentId === "kick") {
          const kick = inst as unknown as KickDesignerInstrument;
          if (kick.setMacroState) {
            const defaults = normalizeKickDesignerState(character.defaults);
            const merged = mergeKickDesignerState(defaults, {
              punch: chunk?.punch,
              clean: chunk?.clean,
              tight: chunk?.tight,
            });
            kick.setMacroState(merged);
          }
        }

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

    setTriggers(newTriggers);
    restorationRef.current = false;

    return () => {
      disposeAll();
    };
  }, [
    packIndex,
    started,
    restorationRef,
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
    setCurrentSectionIndex((prev) => {
      const maxColumns = songRows.reduce(
        (max, row) => Math.max(max, row.slots.length),
        0
      );
      if (maxColumns === 0) return 0;
      return prev >= maxColumns ? maxColumns - 1 : prev;
    });
  }, [songRows]);

  useEffect(() => {
    if (!started || viewMode !== "song") return;
    const maxColumns = songRows.reduce(
      (max, row) => Math.max(max, row.slots.length),
      0
    );
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
  }, [started, viewMode, songRows]);

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
        handle.openSequenceLibrary();
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
      window.alert("Failed to export project JSON");
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
      setProjectModalError("Enter a project name");
      return;
    }
    try {
      const snapshot = buildProjectSnapshot();
      saveStoredProject(trimmed, snapshot);
      setActiveProjectName(trimmed);
      setProjectModalError(null);
      refreshProjectList();
      setProjectModalMode(null);
    } catch (error) {
      console.error(error);
      setProjectModalError("Failed to save project");
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
    (project: StoredProjectData) => {
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
      setTracks(project.tracks);
      setPatternGroups(
        project.patternGroups.length > 0
          ? project.patternGroups
          : [createInitialPatternGroup()]
      );
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
      setToneGraphVersion((value) => value + 1);
    },
    [applyTransportState]
  );

  const handleLoadProjectByName = useCallback(
    (name: string) => {
      const project = loadStoredProject(name);
      if (!project) {
        setProjectModalError("Project not found");
        return;
      }
      applyLoadedProject(project);
      setActiveProjectName(name);
      setProjectModalMode(null);
      setProjectModalError(null);
    },
    [applyLoadedProject, setActiveProjectName]
  );

  const handleDeleteProject = useCallback(
    (name: string) => {
      const confirmed = window.confirm(`Delete project "${name}"? This can't be undone.`);
      if (!confirmed) return;
      deleteProject(name);
      refreshProjectList();
      setActiveProjectName((current) => (current === name ? "untitled" : current));
    },
    [refreshProjectList]
  );

  const initAudioGraph = useCallback(async () => {
    try {
      if (isIOSPWA()) {
        await forceAudioContextCleanup();
      }

      await Tone.start();

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
    } catch (error) {
      console.error("Audio init failed:", error);
      alert("Audio failed to start. Please try again.");
      throw error;
    }
  }, [bpm]);

  const handleNewProjectClick = useCallback(
    async (button?: HTMLButtonElement | null) => {
      if (isLaunchingNewProjectRef.current) return;
      isLaunchingNewProjectRef.current = true;

      const targetButton = button ?? (document.activeElement as HTMLButtonElement | null);
      const originalText = targetButton?.textContent ?? null;

      try {
        if (targetButton) {
          targetButton.disabled = true;
          targetButton.textContent = "Starting...";
        }

        setActiveProjectName("untitled");
        await initAudioGraph();
      } catch (error) {
        console.error("Failed to start:", error);
        alert("Failed to start audio. Please refresh the page.");
      } finally {
        if (targetButton) {
          targetButton.disabled = false;
          targetButton.textContent = originalText ?? "New Project";
        }
        isLaunchingNewProjectRef.current = false;
      }
    },
    [initAudioGraph, setActiveProjectName]
  );

  const handleCreateNewProjectTouchStart = useCallback(() => {
    pendingTouchNewProjectRef.current = true;
    void ensureAudioContextRunning();
    void Tone.start().catch(() => {
      // Ignore; we'll retry when launching the project.
    });
  }, []);

  const handleCreateNewProjectTouchCommit = useCallback(
    (event: ReactTouchEvent<HTMLButtonElement>) => {
      if (!pendingTouchNewProjectRef.current) return;
      pendingTouchNewProjectRef.current = false;
      event.preventDefault();
      void handleNewProjectClick(event.currentTarget);
    },
    [handleNewProjectClick]
  );

  useEffect(() => {
    refreshProjectList();
  }, [refreshProjectList]);

  const handleLaunchProject = useCallback(
    async (name: string) => {
      if (!started) {
        await initAudioGraph();
      }
      handleLoadProjectByName(name);
    },
    [handleLoadProjectByName, initAudioGraph, started]
  );

  const handlePlayStop = () => {
    if (isPlaying) {
      Tone.Transport.stop();
      setIsPlaying(false);
      setCurrentSectionIndex(0);
      return;
    }
    if (Tone.Transport.state === "stopped") {
      setCurrentSectionIndex(0);
    }
    Tone.Transport.start();
    setIsPlaying(true);
  };

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

  // Add app state visibility handling for iOS PWA
  useEffect(() => {
    if (!isIOSPWA()) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("App became visible, checking audio context state");

        // If audio was started but context is suspended, try to resume
        if (started) {
          const context = Tone.getContext();
          if (context.state === "suspended") {
            console.log("Attempting to resume suspended audio context");
            void context.resume().catch((error) => {
              console.warn("Failed to resume audio context:", error);
            });
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [started]);

  const handleOpenSequenceLibrary = () => {
    if (viewMode !== "track") {
      setViewMode("track");
      setPendingLoopStripAction("openLibrary");
      return;
    }
    loopStripRef.current?.openSequenceLibrary();
  };

  const handleSelectSequenceFromSongView = useCallback(
    (groupId: string) => {
      setSelectedGroupId(groupId);
      setEditing(null);
      if (viewMode !== "track") {
        setViewMode("track");
        setPendingLoopStripAction(null);
      }
    },
    [setSelectedGroupId, setEditing, viewMode, setPendingLoopStripAction]
  );

  const handleConfirmAddTrack = useCallback(() => {
    if (!addTrackModalState.instrumentId) {
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
  }, [addTrackModalState, closeAddTrackModal]);

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
      <AddTrackModal
        isOpen={addTrackModalState.isOpen}
        mode={addTrackModalState.mode}
        packs={packs}
        selectedPackId={addTrackModalState.packId}
        selectedInstrumentId={addTrackModalState.instrumentId}
        selectedCharacterId={addTrackModalState.characterId}
        selectedPresetId={addTrackModalState.presetId}
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
          title={projectModalMode === "save" ? "Save Project" : "Load Project"}
          subtitle={
            projectModalMode === "save"
              ? "Name your jam to store it locally on this device."
              : "Open a saved project from local storage."
          }
          maxWidth={460}
          footer={
            projectModalMode === "save" ? (
              <IconButton
                icon="save"
                label="Save project"
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
                <span style={{ fontSize: 13, color: "#cbd5f5" }}>Project name</span>
                <input
                  id="project-name"
                  value={projectNameInput}
                  onChange={(event) => setProjectNameInput(event.target.value)}
                  placeholder="My Jam"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #2f384a",
                    background: "#0f172a",
                    color: "#e6f2ff",
                  }}
                />
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
                    No projects saved yet
                  </div>
                ) : (
                  projectList.map((name) => {
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
                          title={`Use project name ${name}`}
                        >
                          {name}
                        </button>
                        <IconButton
                          icon="delete"
                          label={`Delete project ${name}`}
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
                  No projects saved yet
                </div>
              ) : (
                projectList.map((name) => (
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
                        label={`Load project ${name}`}
                        tone="accent"
                        onClick={() => handleLoadProjectByName(name)}
                      />
                      <IconButton
                        icon="delete"
                        label={`Delete project ${name}`}
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
          title="Export Project"
          subtitle="Download your jam as JSON or render audio offline."
          maxWidth={420}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <IconButton
              icon="file_download"
              label="Export project JSON"
              tone="accent"
              onClick={handleExportJson}
              disabled={isAudioExporting}
            />
            <IconButton
              icon="file_download"
              label="Export audio"
              tone="accent"
              onClick={handleExportAudio}
              disabled={isAudioExporting}
            />
          </div>
          {isAudioExporting ? (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                borderRadius: 14,
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
                style={{ fontSize: 28, color: "#27E0B0" }}
              >
                hourglass_top
              </span>
              <span>{audioExportMessage}</span>
            </div>
          ) : null}
        </Modal>
      )}
      {!started ? (
        <div
          style={{
            display: "flex",
            flex: 1,
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              width: "min(440px, 100%)",
              display: "flex",
              flexDirection: "column",
              gap: 24,
            }}
          >
            <button
              type="button"
              onClick={(event) => {
                void handleNewProjectClick(event.currentTarget);
              }}
              onTouchStart={handleCreateNewProjectTouchStart}
              onTouchEnd={handleCreateNewProjectTouchCommit}
              onTouchCancel={handleCreateNewProjectTouchCommit}
              style={{
                padding: "18px 24px",
                fontSize: "1.25rem",
                borderRadius: 16,
                border: "1px solid #333",
                background: "#27E0B0",
                color: "#1F2532",
                fontWeight: 600,
              }}
            >
              New Project
            </button>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, color: "#e6f2ff" }}>
                Saved Projects
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  maxHeight: "60vh",
                  overflowY: "auto",
                }}
              >
                {projectList.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>
                    No projects saved yet
                  </div>
                ) : (
                  projectList.map((name) => (
                    <button
                      key={name}
                      onClick={() => handleLaunchProject(name)}
                      style={{
                        padding: "12px 16px",
                        borderRadius: 14,
                        border: "1px solid #1f2937",
                        background: "#0f172a",
                        color: "#e6f2ff",
                        textAlign: "left",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        Tap to load project
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              padding: "16px 16px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <button
                onClick={() => setViewMode("track")}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: viewMode === "track" ? "#27E0B0" : "#1f2532",
                  color: viewMode === "track" ? "#1F2532" : "#e6f2ff",
                }}
              >
                Tracks
              </button>
              <button
                onClick={() => {
                  setEditing(null);
                  setViewMode("song");
                }}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: viewMode === "song" ? "#27E0B0" : "#1f2532",
                  color: viewMode === "song" ? "#1F2532" : "#e6f2ff",
                }}
              >
                Song
              </button>
            </div>
            {viewMode === "song" ? (
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <IconButton
                  icon="save"
                  label="Save project"
                  onClick={openSaveProjectModal}
                />
                <IconButton
                  icon="folder_open"
                  label="Load project"
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
              </div>
            ) : null}
          </div>
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
              onAddTrack={openAddTrackModal}
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
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flex: 1,
                    }}
                  >
                    {editing !== null ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <button
                          aria-label="Done editing"
                          onClick={() => setEditing(null)}
                          style={{
                            ...controlButtonBaseStyle,
                            background: "#27E0B0",
                            color: "#1F2532",
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={controlIconStyle}
                          >
                            check
                          </span>
                        </button>
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
                      </div>
                    ) : (
                      <>
                        <label>BPM</label>
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
                          }}
                        >
                          {[90, 100, 110, 120, 130].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                        <label style={{ marginLeft: 12 }}>Quantize</label>
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
                          }}
                        >
                          <option value="16n">1/16</option>
                          <option value="8n">1/8</option>
                          <option value="4n">1/4</option>
                        </select>
                      </>
                    )}
                  </div>
                  <div
                    style={{
                      width: 1,
                      height: 24,
                      background: "#333",
                      margin: "0 12px",
                    }}
                  />
                  <div style={{ display: "flex", gap: 12 }}>
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
                  </div>
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
                        const trigger =
                          triggers[selectedTrack.instrument] ?? undefined;
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
                selectedGroupId={selectedGroupId}
                onOpenSequenceLibrary={handleOpenSequenceLibrary}
                onSelectSequence={handleSelectSequenceFromSongView}
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
          />
        </>
      )}
    </div>
  );
}

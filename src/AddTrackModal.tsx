import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import * as Tone from "tone";
import { createKick } from "@/instruments/kickInstrument";

import type { Pack } from "./packs";
import { getCharacterOptions } from "./addTrackOptions";
import { formatInstrumentLabel } from "./utils/instrument";
import {
  deleteInstrumentPreset,
  listInstrumentPresets,
  saveInstrumentPreset,
  PRESETS_UPDATED_EVENT,
  stripUserPresetPrefix,
  USER_PRESET_PREFIX,
  isUserPresetId,
} from "./presets";
import type { Chunk } from "./chunks";
import { Modal } from "./components/Modal";
import { IconButton } from "./components/IconButton";
import { createTriggerKey, type TriggerMap } from "./tracks";
import { initAudioContext } from "./utils/audio";
import { computeStepTriggerOptions } from "./utils/triggerTiming";
import {
  FALLBACK_INSTRUMENT_COLOR,
  getInstrumentColor,
  hexToRgba,
  lightenColor,
} from "./utils/color";

type SelectField = "pack" | "instrument" | "style" | "preset";

const ENABLE_DELAY_MS = 180;

const statusTextStyle: CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
};

interface AddTrackModalProps {
  isOpen: boolean;
  mode: "add" | "edit";
  packs: Pack[];
  selectedPackId: string;
  selectedInstrumentId: string;
  selectedCharacterId: string;
  selectedPresetId: string | null;
  triggers: TriggerMap;
  editingTrackName?: string;
  editingTrackPattern?: Chunk | null;
  onSelectPack: (packId: string) => void;
  onSelectInstrument: (instrumentId: string) => void;
  onSelectCharacter: (characterId: string) => void;
  onSelectPreset: (presetId: string | null) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onDelete?: () => void;
}

export const AddTrackModal: FC<AddTrackModalProps> = ({
  isOpen,
  mode,
  packs,
  selectedPackId,
  selectedInstrumentId,
  selectedCharacterId,
  selectedPresetId,
  triggers,
  editingTrackName,
  editingTrackPattern,
  onSelectPack,
  onSelectInstrument,
  onSelectCharacter,
  onSelectPreset,
  onCancel,
  onConfirm,
  onDelete,
}) => {
  const pack = useMemo(
    () => packs.find((candidate) => candidate.id === selectedPackId) ?? null,
    [packs, selectedPackId]
  );
  const instrumentOptions = useMemo(
    () => (pack ? Object.keys(pack.instruments) : []),
    [pack]
  );
  const characterOptions = useMemo(
    () =>
      selectedInstrumentId && pack?.id
        ? getCharacterOptions(pack.id, selectedInstrumentId)
        : [],
    [pack?.id, selectedInstrumentId]
  );
  const presetOptions = useMemo(
    () =>
      pack
        ? pack.chunks.filter((chunk) => chunk.instrument === selectedInstrumentId)
        : [],
    [pack, selectedInstrumentId]
  );

  const [userPresets, setUserPresets] = useState<
    { id: string; name: string; characterId: string | null; pattern: Chunk | null }[]
  >([]);
  const [loadedUserPresetsScope, setLoadedUserPresetsScope] = useState<string | null>(
    null
  );
  const [handoffLock, setHandoffLock] = useState<SelectField | null>(null);
  const [loadingState, setLoadingState] = useState({
    instrument: false,
    style: false,
    preset: false,
  });
  const [readyState, setReadyState] = useState({
    instrument: false,
    style: false,
    preset: false,
  });

  const packPresets = useMemo(
    () =>
      presetOptions.map((preset) => ({
        id: preset.id,
        name: preset.name,
        characterId: preset.characterId ?? null,
        pattern: preset,
      })),
    [presetOptions]
  );

  const activeUserPresetScope = useMemo(
    () => `${pack?.id ?? ""}::${selectedInstrumentId ?? ""}`,
    [pack?.id, selectedInstrumentId]
  );
  const userPresetsReady = useMemo(
    () => loadedUserPresetsScope === activeUserPresetScope,
    [loadedUserPresetsScope, activeUserPresetScope]
  );

  const userPresetItems = useMemo(
    () =>
      userPresets.map((preset) => ({
        id: `${USER_PRESET_PREFIX}${preset.id}`,
        name: preset.name,
        characterId: preset.characterId,
        pattern: preset.pattern ?? undefined,
      })),
    [userPresets]
  );

  type PresetSource = "none" | "user" | "pack";
  type PresetSelectionItem = {
    id: string | null;
    name: string;
    source: PresetSource;
    characterId: string | null;
    pattern?: Chunk;
  };

  const presetSelectionItems = useMemo<PresetSelectionItem[]>(
    () =>
      [
        {
          id: null,
          name: "None",
          source: "none",
          characterId: null,
        },
        ...userPresetItems.map((preset) => ({
          ...preset,
          source: "user" as PresetSource,
        })),
        ...packPresets.map((preset) => ({
          ...preset,
          source: "pack" as PresetSource,
        })),
      ],
    [packPresets, userPresetItems]
  );

  const scheduleAfterBlur = useCallback((task: () => void) => {
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(task);
      });
      return;
    }
    setTimeout(task, 0);
  }, []);

  const scheduleReadyTransition = useCallback((task: () => void) => {
    let cancelled = false;
    let raf1: number | undefined;
    let raf2: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finalize = () => {
      if (cancelled) return;
      task();
    };

    const startTimer = () => {
      timeoutId = setTimeout(finalize, ENABLE_DELAY_MS);
    };

    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(startTimer);
      });
    } else {
      startTimer();
    }

    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        if (raf1 !== undefined) {
          window.cancelAnimationFrame(raf1);
        }
        if (raf2 !== undefined) {
          window.cancelAnimationFrame(raf2);
        }
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const setLoading = useCallback((field: Exclude<SelectField, "pack">, value: boolean) => {
    setLoadingState((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const setReady = useCallback((field: Exclude<SelectField, "pack">, value: boolean) => {
    setReadyState((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const resetSelectStatus = useCallback(
    (field: Exclude<SelectField, "pack">) => {
      setLoading(field, false);
      setReady(field, false);
    },
    [setLoading, setReady]
  );

  const startLoadingSelect = useCallback(
    (field: Exclude<SelectField, "pack">) => {
      setLoading(field, true);
      setReady(field, false);
    },
    [setLoading, setReady]
  );

  const instrumentOptionsKey = useMemo(
    () => instrumentOptions.join("|"),
    [instrumentOptions]
  );
  const characterOptionsKey = useMemo(
    () => characterOptions.map((option) => option.id).join("|"),
    [characterOptions]
  );
  const presetOptionsKey = useMemo(
    () => presetOptions.map((option) => option.id).join("|"),
    [presetOptions]
  );

  useEffect(() => {
    if (!selectedPackId) {
      resetSelectStatus("instrument");
      return;
    }
    if (instrumentOptions.length === 0) {
      resetSelectStatus("instrument");
      return;
    }

    setLoading("instrument", true);
    setReady("instrument", false);
    const cleanup = scheduleReadyTransition(() => {
      setLoading("instrument", false);
      setReady("instrument", true);
    });

    return () => {
      cleanup?.();
    };
  }, [
    instrumentOptions.length,
    instrumentOptionsKey,
    resetSelectStatus,
    scheduleReadyTransition,
    selectedPackId,
    setLoading,
    setReady,
  ]);

  useEffect(() => {
    if (!selectedPackId || !selectedInstrumentId) {
      resetSelectStatus("style");
      return;
    }
    if (characterOptions.length === 0) {
      resetSelectStatus("style");
      return;
    }

    setLoading("style", true);
    setReady("style", false);
    const cleanup = scheduleReadyTransition(() => {
      setLoading("style", false);
      setReady("style", true);
    });

    return () => {
      cleanup?.();
    };
  }, [
    characterOptions.length,
    characterOptionsKey,
    resetSelectStatus,
    scheduleReadyTransition,
    selectedInstrumentId,
    selectedPackId,
    setLoading,
    setReady,
  ]);

  useEffect(() => {
    if (!selectedPackId || !selectedInstrumentId || !selectedCharacterId) {
      resetSelectStatus("preset");
      return;
    }

    setLoading("preset", true);
    setReady("preset", false);
    const cleanup = scheduleReadyTransition(() => {
      setLoading("preset", false);
      setReady("preset", true);
    });

    return () => {
      cleanup?.();
    };
  }, [
    presetOptionsKey,
    resetSelectStatus,
    scheduleReadyTransition,
    selectedCharacterId,
    selectedInstrumentId,
    selectedPackId,
    setLoading,
    setReady,
  ]);

  useEffect(() => {
    if (!selectedInstrumentId || characterOptions.length === 0) return;
    const hasSelection = characterOptions.some(
      (option) => option.id === selectedCharacterId
    );
    if (hasSelection) return;
    const first = characterOptions[0];
    if (!first) return;
    startLoadingSelect("preset");
    onSelectCharacter(first.id);
    onSelectPreset(null);
  }, [
    characterOptions,
    selectedCharacterId,
    selectedInstrumentId,
    onSelectCharacter,
    onSelectPreset,
    startLoadingSelect,
  ]);

  useEffect(() => {
    if (!selectedPresetId) return;
    if (isUserPresetId(selectedPresetId) && !userPresetsReady) return;
    const hasSelection = presetSelectionItems.some(
      (preset) => preset.id === selectedPresetId
    );
    if (hasSelection) return;
    onSelectPreset(null);
  }, [
    presetSelectionItems,
    selectedPresetId,
    onSelectPreset,
    userPresetsReady,
  ]);

  const previewStyle = useCallback(
    async (characterId: string) => {
      if (!characterId || !selectedInstrumentId || !selectedPackId) return;

      try {
        await initAudioContext();
      } catch {
        return;
      }

      if (selectedInstrumentId === "kick") {
        try {
          const voice = createKick(selectedPackId, characterId);
          const time = Tone.now() + 0.05;
          voice.triggerAttackRelease("8n", time, 0.9);
          if (import.meta.env.DEV) {
            console.info("[kick:preview]", {
              packId: selectedPackId,
              characterId,
            });
          }
          setTimeout(() => {
            voice.dispose();
          }, 600);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.info("[kick:preview:error]", error);
          }
        }
        return;
      }

      const trigger =
        triggers[createTriggerKey(selectedPackId, selectedInstrumentId)];
      if (!trigger) return;

      const start = Tone.now() + 0.05;
      const previewChunk: Chunk = {
        id: "style-preview",
        name: "Style Preview",
        instrument: selectedInstrumentId,
        characterId: characterId,
        steps: [],
      };
      trigger(start, 0.9, 0, undefined, 0.5, previewChunk, characterId);
    },
    [selectedInstrumentId, selectedPackId, triggers]
  );

  const previewPreset = useCallback(
    async (chunk: Chunk, fallbackCharacterId?: string | null) => {
      const instrumentId = chunk.instrument || selectedInstrumentId;
      if (!instrumentId || !selectedPackId) return;
      const trigger = triggers[createTriggerKey(selectedPackId, instrumentId)];
      if (!trigger) return;
      try {
        await initAudioContext();
      } catch {
        return;
      }
      const activeCharacterId =
        fallbackCharacterId ?? chunk.characterId ?? selectedCharacterId ?? null;
      const start = Tone.now() + 0.05;
      let hasTriggered = false;

      if (chunk.noteEvents && chunk.noteEvents.length > 0) {
        const events = chunk.noteEvents
          .slice(0, 16)
          .sort((a, b) => a.time - b.time);
        events.forEach((event) => {
          const velocity = Math.max(0, Math.min(1, event.velocity));
          trigger(
            start + event.time,
            velocity,
            undefined,
            event.note,
            event.duration,
            chunk,
            activeCharacterId ?? undefined
          );
        });
        hasTriggered = events.length > 0;
      } else if (chunk.steps && chunk.steps.length > 0) {
        const stepDurationSeconds = Tone.Time("16n").toSeconds();
        const stepsArray = chunk.steps.slice(0, 16);
        const limit = stepsArray.length;
        const velocities = chunk.velocities ?? [];
        const pitches = chunk.pitches ?? [];
        const notes = chunk.notes ?? [];
        for (let index = 0; index < limit; index += 1) {
          const stepValue = stepsArray[index];
          if (!stepValue) continue;
          const rawVelocity =
            velocities[index] ?? (typeof stepValue === "number" ? stepValue : 1);
          const velocity = Math.max(0, Math.min(1, rawVelocity ?? 1));
          const pitch = pitches[index] ?? 0;
          const note = notes[index] ?? chunk.note;
          const { sustainSeconds } = computeStepTriggerOptions({
            pattern: chunk,
            steps: stepsArray,
            index,
            stepDurationSeconds,
          });
          trigger(
            start + index * stepDurationSeconds,
            velocity,
            pitch,
            note,
            sustainSeconds,
            chunk,
            activeCharacterId ?? undefined
          );
          hasTriggered = true;
        }
      }

      if (!hasTriggered) {
        trigger(start, 0.9, 0, chunk.note, chunk.sustain, chunk, activeCharacterId ?? undefined);
      }
    },
    [selectedCharacterId, selectedInstrumentId, selectedPackId, triggers]
  );

  const refreshUserPresets = useCallback(() => {
    const scope = `${pack?.id ?? ""}::${selectedInstrumentId ?? ""}`;
    setLoadedUserPresetsScope(null);
    if (!pack || !selectedInstrumentId) {
      setUserPresets([]);
      setLoadedUserPresetsScope(scope);
      return;
    }
    const presets = listInstrumentPresets(pack.id, selectedInstrumentId).map((preset) => ({
      id: preset.id,
      name: preset.name,
      characterId: preset.characterId,
      pattern: preset.pattern,
    }));
    setUserPresets(presets);
    setLoadedUserPresetsScope(scope);
  }, [pack, selectedInstrumentId]);

  useEffect(() => {
    refreshUserPresets();
  }, [refreshUserPresets]);

  useEffect(() => {
    const handleUpdate = () => refreshUserPresets();
    if (typeof window !== "undefined") {
      window.addEventListener(PRESETS_UPDATED_EVENT, handleUpdate);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(PRESETS_UPDATED_EVENT, handleUpdate);
      }
    };
  }, [refreshUserPresets]);

  const handleDeletePreset = useCallback(
    (presetId: string) => {
      if (!pack || !selectedInstrumentId) return;
      if (!isUserPresetId(presetId)) return;
      const actualId = stripUserPresetPrefix(presetId);
      const confirmed = window.confirm("Delete this loop preset?");
      if (!confirmed) return;
      const removed = deleteInstrumentPreset(pack.id, selectedInstrumentId, actualId);
      if (removed) {
        if (selectedPresetId === presetId) {
          onSelectPreset(null);
        }
        refreshUserPresets();
      }
    },
    [pack, selectedInstrumentId, selectedPresetId, onSelectPreset, refreshUserPresets]
  );

  const handleSavePresetPattern = useCallback(() => {
    if (!pack || !selectedInstrumentId || !editingTrackPattern) {
      window.alert("No pattern data available to save as a loop.");
      return;
    }
    const suggestedName =
      editingTrackName?.trim() || formatInstrumentLabel(selectedInstrumentId);
    const defaultName = `${suggestedName} Pattern`;
    const name = window.prompt("Name your loop preset", defaultName);
    if (!name) return;
    const pattern: Chunk = {
      ...editingTrackPattern,
      instrument: selectedInstrumentId,
      characterId: editingTrackPattern.characterId ?? selectedCharacterId ?? undefined,
    };
    const record = saveInstrumentPreset({
      name,
      packId: pack.id,
      instrumentId: selectedInstrumentId,
      characterId: pattern.characterId ?? null,
      pattern,
    });
    if (!record) {
      window.alert("Unable to save this loop.");
      return;
    }
    onSelectPreset(`${USER_PRESET_PREFIX}${record.id}`);
    refreshUserPresets();
    window.alert("Loop saved.");
  }, [
    pack,
    selectedInstrumentId,
    editingTrackPattern,
    editingTrackName,
    selectedCharacterId,
    onSelectPreset,
    refreshUserPresets,
  ]);

  const handlePackSelect = useCallback(
    (nextValue: string) => {
      if (nextValue === selectedPackId) return;
      setHandoffLock("pack");
      startLoadingSelect("instrument");
      resetSelectStatus("style");
      resetSelectStatus("preset");
      scheduleAfterBlur(() => {
        try {
          onSelectPack(nextValue);
          onSelectInstrument("");
          onSelectCharacter("");
          onSelectPreset(null);
        } finally {
          setHandoffLock(null);
        }
      });
    },
    [
      onSelectCharacter,
      onSelectInstrument,
      onSelectPack,
      onSelectPreset,
      resetSelectStatus,
      scheduleAfterBlur,
      selectedPackId,
      startLoadingSelect,
    ]
  );

  const handleInstrumentSelect = useCallback(
    (nextValue: string) => {
      if (nextValue === selectedInstrumentId) return;
      setHandoffLock("instrument");
      startLoadingSelect("style");
      resetSelectStatus("preset");
      scheduleAfterBlur(() => {
        try {
          onSelectInstrument(nextValue);
          onSelectCharacter("");
          onSelectPreset(null);
        } finally {
          setHandoffLock(null);
        }
      });
    },
    [
      onSelectCharacter,
      onSelectInstrument,
      onSelectPreset,
      resetSelectStatus,
      scheduleAfterBlur,
      selectedInstrumentId,
      startLoadingSelect,
    ]
  );

  const handleStyleSelect = useCallback(
    (nextValue: string) => {
      if (nextValue === selectedCharacterId) return;
      setHandoffLock("style");
      startLoadingSelect("preset");
      scheduleAfterBlur(() => {
        try {
          onSelectCharacter(nextValue);
          onSelectPreset(null);
          if (nextValue) {
            void previewStyle(nextValue);
          }
        } finally {
          setHandoffLock(null);
        }
      });
    },
    [
      onSelectCharacter,
      onSelectPreset,
      previewStyle,
      scheduleAfterBlur,
      selectedCharacterId,
      startLoadingSelect,
    ]
  );

  const handlePresetSelect = useCallback(
    (nextValue: string | null) => {
      if (nextValue === (selectedPresetId ?? null)) return;
      setHandoffLock("preset");
      scheduleAfterBlur(() => {
        try {
          if (!nextValue) {
            onSelectPreset(null);
            return;
          }
          onSelectPreset(nextValue);
          const match = presetSelectionItems.find((item) => item.id === nextValue);
          if (
            match?.characterId &&
            match.characterId !== selectedCharacterId &&
            characterOptions.some((option) => option.id === match.characterId)
          ) {
            onSelectCharacter(match.characterId);
          }
          if (match?.pattern) {
            void previewPreset(match.pattern, match.characterId);
          }
        } finally {
          setHandoffLock(null);
        }
      });
    },
    [
      characterOptions,
      onSelectCharacter,
      onSelectPreset,
      presetSelectionItems,
      previewPreset,
      scheduleAfterBlur,
      selectedPresetId,
      selectedCharacterId,
    ]
  );

  const confirmDisabled = !pack || !selectedInstrumentId || !selectedCharacterId;
  const isEditMode = mode === "edit";
  const title = isEditMode ? "Edit Track" : "Add Track";
  const description = isEditMode
    ? "Adjust the sound pack, instrument, style, and loop preset for this track."
    : "Choose a sound pack, instrument, style, and optional loop preset to start a new groove.";
  const confirmLabel = isEditMode ? "Update Track" : "Add Track";
  const showSavePresetAction = isEditMode && Boolean(editingTrackPattern);

  const footerButtonBaseStyle: CSSProperties = {
    padding: "8px 18px",
    borderRadius: 999,
    border: "1px solid #333",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 0.3,
    minWidth: 0,
    cursor: "pointer",
    transition: "background 0.2s ease, color 0.2s ease, opacity 0.2s ease",
  };

  const compactIconButtonStyle: CSSProperties = {
    minHeight: 36,
    minWidth: 36,
    borderRadius: 10,
  };

  const cancelButtonStyle: CSSProperties = {
    ...footerButtonBaseStyle,
    background: "#1f2532",
    color: "#e6f2ff",
  };

  const confirmButtonStyle: CSSProperties = {
    ...footerButtonBaseStyle,
    background: confirmDisabled ? "#1b2130" : "#27E0B0",
    color: confirmDisabled ? "#475569" : "#1F2532",
    border: `1px solid ${confirmDisabled ? "#1f2937" : "#27E0B0"}`,
    cursor: confirmDisabled ? "not-allowed" : "pointer",
    opacity: confirmDisabled ? 0.7 : 1,
  };

  const sectionListStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    flex: "1 1 auto",
    minHeight: 0,
    paddingRight: 4,
  };

  const fieldLabelStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  const fieldTitleStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: "#cbd5f5",
    letterSpacing: 0.2,
  };

  const fieldTitleIconStyle: CSSProperties = {
    fontSize: 18,
    lineHeight: 1,
    color: "#94a3b8",
  };

  const savedLoopsSectionStyle: CSSProperties = {
    borderRadius: 12,
    border: "1px solid #1d2636",
    background: "#10192c",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };

  const savedLoopsHeaderStyle: CSSProperties = {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: "#e2e8f0",
    display: "flex",
    alignItems: "center",
    gap: 8,
  };

  const savedLoopsHeaderIconStyle: CSSProperties = {
    fontSize: 20,
    lineHeight: 1,
    color: "#94a3b8",
  };

  const savedLoopsSubcopyStyle: CSSProperties = {
    margin: 0,
    fontSize: 13,
    color: "#94a3b8",
    lineHeight: 1.5,
  };

  const savedLoopsFieldsStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  const selectionListStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "flex-start",
    width: "100%",
  };

  const createOptionChipStyle = (
    accentColor: string,
    {
      isActive,
      isDisabled,
    }: {
      isActive: boolean;
      isDisabled?: boolean;
    }
  ): CSSProperties => {
    const safeAccentColor = accentColor || FALLBACK_INSTRUMENT_COLOR;
    const baseBorderColor = "rgba(148, 163, 184, 0.35)";
    const baseTextColor = "#cbd5f5";
    const activeBorderColor = hexToRgba(safeAccentColor, 0.65);
    const activeBackground = hexToRgba(lightenColor(safeAccentColor, 0.18), 0.25);
    const disabledTextColor = "rgba(148, 163, 184, 0.7)";

    return {
      padding: "8px 16px",
      borderRadius: 999,
      border: `1px solid ${isActive ? activeBorderColor : baseBorderColor}`,
      background: isActive ? activeBackground : "transparent",
      color: isDisabled ? disabledTextColor : isActive ? "#f8fafc" : baseTextColor,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      fontSize: 14,
      fontWeight: 600,
      letterSpacing: 0.3,
      lineHeight: 1.3,
      textAlign: "center",
      alignSelf: "flex-start",
      flex: "0 1 auto",
      maxWidth: "100%",
      cursor: isDisabled ? "not-allowed" : "pointer",
      opacity: isDisabled ? 0.7 : 1,
      filter: isDisabled ? "saturate(0.6)" : "none",
      transition:
        "background 0.2s ease, border-color 0.2s ease, color 0.2s ease, opacity 0.2s ease",
      touchAction: "manipulation",
      boxSizing: "border-box",
    };
  };

  const chipLabelStyle: CSSProperties = {
    color: "inherit",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 0.3,
    lineHeight: 1.3,
    display: "inline-block",
    wordBreak: "break-word",
  };

  const createChipBadgeStyle = (
    accentColor: string,
    isActive: boolean
  ): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    border: `1px solid ${hexToRgba(
      accentColor || FALLBACK_INSTRUMENT_COLOR,
      isActive ? 0.55 : 0.35
    )}`,
    background: isActive
      ? hexToRgba(accentColor || FALLBACK_INSTRUMENT_COLOR, 0.25)
      : "rgba(148, 163, 184, 0.12)",
    color: isActive ? "#0e151f" : "#94a3b8",
    transition: "border-color 0.2s ease, background 0.2s ease, color 0.2s ease",
  });

  const emptyStateTextStyle: CSSProperties = {
    fontSize: 13,
    color: "#94a3b8",
  };

  const packSelectDisabled = handoffLock !== null && handoffLock !== "pack";

  const instrumentSelectDisabled =
    handoffLock !== null && handoffLock !== "instrument"
      ? true
      : loadingState.instrument || !readyState.instrument;
  const styleSelectDisabled =
    handoffLock !== null && handoffLock !== "style"
      ? true
      : loadingState.style || !readyState.style;
  const presetSelectDisabled =
    handoffLock !== null && handoffLock !== "preset"
      ? true
      : loadingState.preset || !readyState.preset;
  const presetBlockedLabel = !selectedPackId
    ? "Select a sound pack first"
    : !selectedInstrumentId
    ? "Select an instrument first"
    : !selectedCharacterId
    ? "Select a style first"
    : loadingState.preset
    ? "Loading presets..."
    : "Loop presets unavailable";

  const instrumentHelperText = loadingState.instrument
    ? "Loading instruments..."
    : !selectedPackId
    ? "Select a sound pack first."
    : instrumentOptions.length === 0
    ? "No instruments available."
    : null;

  const styleHelperText = loadingState.style
    ? "Loading styles..."
    : !selectedPackId
    ? "Select a sound pack first."
    : !selectedInstrumentId
    ? "Select an instrument first."
    : characterOptions.length === 0
    ? "No styles available yet."
    : null;

  const savedLoopsHelperText = loadingState.preset
    ? "Loading presets..."
    : presetSelectDisabled
    ? presetBlockedLabel
    : userPresetItems.length === 0 && packPresets.length === 0
    ? "No loop presets available yet."
    : null;

  const selectedInstrumentAccent = getInstrumentColor(selectedInstrumentId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      subtitle={description}
      fullScreen
      footer={
        <>
          {isEditMode && onDelete ? (
            <IconButton
              icon="delete"
              label="Remove track"
              tone="danger"
              iconSize={20}
              style={{ ...compactIconButtonStyle, marginRight: "auto" }}
              onClick={onDelete}
            />
          ) : (
            <div aria-hidden="true" style={{ marginRight: "auto" }} />
          )}
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={onCancel}
              style={cancelButtonStyle}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              style={confirmButtonStyle}
            >
              {confirmLabel}
            </button>
          </div>
        </>
      }
    >
      <div style={sectionListStyle}>
        <section
          aria-label="Sound pack selection"
          aria-disabled={packSelectDisabled}
          style={{
            ...fieldLabelStyle,
            gap: 10,
            opacity: packSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <span style={fieldTitleStyle}>
            <span
              aria-hidden="true"
              className="material-symbols-outlined"
              style={fieldTitleIconStyle}
            >
              library_music
            </span>
            <span>Sound Pack</span>
          </span>
          {packs.length > 0 ? (
            <div style={selectionListStyle}>
              {packs.map((option) => {
                const isActive = option.id === selectedPackId;
                const accentColor = FALLBACK_INSTRUMENT_COLOR;
                const buttonStyle = createOptionChipStyle(accentColor, {
                  isActive,
                  isDisabled: packSelectDisabled,
                });
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={packSelectDisabled}
                    aria-pressed={isActive}
                    onClick={() => handlePackSelect(option.id)}
                    style={buttonStyle}
                  >
                    <span style={chipLabelStyle}>
                      {option.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span style={emptyStateTextStyle}>No sound packs available.</span>
          )}
        </section>

        <section
          aria-label="Instrument selection"
          aria-disabled={instrumentSelectDisabled}
          style={{
            ...fieldLabelStyle,
            gap: 10,
            opacity: instrumentSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <span style={fieldTitleStyle}>
            <span
              aria-hidden="true"
              className="material-symbols-outlined"
              style={fieldTitleIconStyle}
            >
              piano
            </span>
            <span>Instrument</span>
          </span>
          {instrumentOptions.length > 0 ? (
            <div style={selectionListStyle}>
              {instrumentOptions.map((instrument) => {
                const isActive = instrument === selectedInstrumentId;
                const accentColor = getInstrumentColor(instrument);
                const buttonStyle = createOptionChipStyle(accentColor, {
                  isActive,
                  isDisabled: instrumentSelectDisabled,
                });
                return (
                  <button
                    key={instrument}
                    type="button"
                    disabled={instrumentSelectDisabled}
                    aria-pressed={isActive}
                    onClick={() => handleInstrumentSelect(instrument)}
                    style={buttonStyle}
                  >
                    <span style={chipLabelStyle}>
                      {formatInstrumentLabel(instrument)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : instrumentHelperText ? (
            <span
              role={loadingState.instrument ? "status" : undefined}
              aria-live={loadingState.instrument ? "polite" : undefined}
              style={
                loadingState.instrument ? statusTextStyle : emptyStateTextStyle
              }
            >
              {instrumentHelperText}
            </span>
          ) : null}
        </section>

        <section
          aria-label="Style selection"
          aria-disabled={styleSelectDisabled}
          style={{
            ...fieldLabelStyle,
            gap: 10,
            opacity: styleSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <span style={fieldTitleStyle}>
            <span
              aria-hidden="true"
              className="material-symbols-outlined"
              style={fieldTitleIconStyle}
            >
              auto_awesome
            </span>
            <span>Style</span>
          </span>
          {characterOptions.length > 0 ? (
            <div style={selectionListStyle}>
              {characterOptions.map((character) => {
                const isActive = character.id === selectedCharacterId;
                const accentColor = selectedInstrumentAccent;
                const buttonStyle = createOptionChipStyle(accentColor, {
                  isActive,
                  isDisabled: styleSelectDisabled,
                });
                return (
                  <button
                    key={character.id}
                    type="button"
                    disabled={styleSelectDisabled}
                    aria-pressed={isActive}
                    onClick={() => handleStyleSelect(character.id)}
                    style={buttonStyle}
                  >
                    <span style={chipLabelStyle}>
                      {character.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : styleHelperText ? (
            <span
              role={loadingState.style ? "status" : undefined}
              aria-live={loadingState.style ? "polite" : undefined}
              style={loadingState.style ? statusTextStyle : emptyStateTextStyle}
            >
              {styleHelperText}
            </span>
          ) : null}
        </section>

        <section
          aria-label="Loop preset selection"
          aria-disabled={presetSelectDisabled}
          style={{
            ...savedLoopsSectionStyle,
            opacity: presetSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h3 style={savedLoopsHeaderStyle}>
              <span
                aria-hidden="true"
                className="material-symbols-outlined"
                style={savedLoopsHeaderIconStyle}
              >
                playlist_play
              </span>
              <span>Loop Presets</span>
            </h3>
            <p style={savedLoopsSubcopyStyle}>
              Save the current loop or load one of your favorite presets.
            </p>
          </div>
          <div style={savedLoopsFieldsStyle}>
            <div style={selectionListStyle}>
              {presetSelectionItems.map((preset) => {
                const isNone = preset.id === null;
                const isActive = isNone
                  ? selectedPresetId === null
                  : preset.id === selectedPresetId;
                const presetKey = preset.id ?? "preset-none";
                const accentColor = selectedInstrumentAccent;
                const buttonStyle = createOptionChipStyle(accentColor, {
                  isActive,
                  isDisabled: presetSelectDisabled,
                });
                const badgeStyle =
                  preset.source === "user" || preset.source === "pack"
                    ? createChipBadgeStyle(accentColor, isActive)
                    : null;
                return (
                  <button
                    key={presetKey}
                    type="button"
                    disabled={presetSelectDisabled}
                    aria-pressed={isActive}
                    onClick={() => handlePresetSelect(preset.id)}
                    style={buttonStyle}
                  >
                    <span style={chipLabelStyle}>
                      {preset.name}
                    </span>
                    {badgeStyle ? (
                      <span style={badgeStyle}>
                        {preset.source === "user" ? "Saved" : "Pack"}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          {savedLoopsHelperText ? (
            <span
              role={loadingState.preset ? "status" : undefined}
              aria-live={loadingState.preset ? "polite" : undefined}
              style={loadingState.preset ? statusTextStyle : emptyStateTextStyle}
            >
              {savedLoopsHelperText}
            </span>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {showSavePresetAction ? (
              <IconButton
                icon="save"
                label="Save current loop"
                tone="accent"
                iconSize={20}
                style={compactIconButtonStyle}
                onClick={handleSavePresetPattern}
              />
            ) : null}
            {selectedPresetId && isUserPresetId(selectedPresetId) ? (
              <IconButton
                icon="delete"
                label="Delete loop preset"
                tone="danger"
                iconSize={20}
                style={compactIconButtonStyle}
                onClick={() => handleDeletePreset(selectedPresetId)}
              />
            ) : null}
          </div>
        </section>

      </div>
    </Modal>
  );
};

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FC,
} from "react";
import * as Tone from "tone";

import type { Pack } from "./packs";
import { createKick } from "@/instruments/kickInstrument";
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

type SelectField = "pack" | "instrument" | "style" | "preset";

const ENABLE_DELAY_MS = 180;

const baseSelectStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #2f384a",
  background: "#0f172a",
  color: "#e6f2ff",
  transition: "border-color 0.2s ease, color 0.2s ease, opacity 0.2s ease",
};

const disabledSelectStyle: CSSProperties = {
  opacity: 0.5,
  color: "#64748b",
  cursor: "not-allowed",
};

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

  const previewStyle = useCallback(
    async (characterId: string) => {
      if (!characterId || !selectedInstrumentId || !selectedPackId) return;
      try {
        await initAudioContext();
      } catch {
        return;
      }

      if (selectedInstrumentId === "kick") {
        const voice = createKick(selectedPackId, characterId);
        const when = Tone.now() + 0.05;
        voice.triggerAttackRelease("8n", when, 0.9);
        if (import.meta.env.DEV)
          console.info("[kick:preview]", { packId: selectedPackId, characterId });
        setTimeout(() => voice.dispose(), 600);
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
        const stepDuration = Tone.Time("16n").toSeconds();
        const limit = Math.min(chunk.steps.length, 16);
        const velocities = chunk.velocities ?? [];
        const pitches = chunk.pitches ?? [];
        const notes = chunk.notes ?? [];
        for (let index = 0; index < limit; index += 1) {
          const stepValue = chunk.steps[index];
          if (!stepValue) continue;
          const rawVelocity =
            velocities[index] ?? (typeof stepValue === "number" ? stepValue : 1);
          const velocity = Math.max(0, Math.min(1, rawVelocity ?? 1));
          const pitch = pitches[index] ?? 0;
          const note = notes[index] ?? chunk.note;
          trigger(
            start + index * stepDuration,
            velocity,
            pitch,
            note,
            chunk.sustain,
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
    if (!pack || !selectedInstrumentId) {
      setUserPresets([]);
      return;
    }
    const presets = listInstrumentPresets(pack.id, selectedInstrumentId).map((preset) => ({
      id: preset.id,
      name: preset.name,
      characterId: preset.characterId,
      pattern: preset.pattern,
    }));
    setUserPresets(presets);
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
      const confirmed = window.confirm("Delete this saved loop?");
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
    const name = window.prompt("Name your saved loop", defaultName);
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

  const handlePackSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const select = event.target;
      const nextValue = select.value;
      select.blur();
      const activeElement = (
        typeof document !== "undefined" ? document.activeElement : null
      ) as HTMLElement | null;
      activeElement?.blur();
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
      startLoadingSelect,
    ]
  );

  const handleInstrumentSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const select = event.target;
      const nextValue = select.value;
      select.blur();
      const activeElement = (
        typeof document !== "undefined" ? document.activeElement : null
      ) as HTMLElement | null;
      activeElement?.blur();
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
      startLoadingSelect,
    ]
  );

  const handleStyleSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const select = event.target;
      const nextValue = select.value;
      select.blur();
      const activeElement = (
        typeof document !== "undefined" ? document.activeElement : null
      ) as HTMLElement | null;
      activeElement?.blur();
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
      startLoadingSelect,
    ]
  );

  const handlePresetSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const select = event.target;
      const nextValue = select.value;
      select.blur();
      const activeElement = (
        typeof document !== "undefined" ? document.activeElement : null
      ) as HTMLElement | null;
      activeElement?.blur();
      setHandoffLock("preset");
      scheduleAfterBlur(() => {
        try {
          if (!nextValue) {
            onSelectPreset(null);
            return;
          }
          onSelectPreset(nextValue);
          const allPresets = [...userPresetItems, ...packPresets];
          const match = allPresets.find((item) => item.id === nextValue);
          if (match?.pattern) {
            void previewPreset(match.pattern, match.characterId);
          }
        } finally {
          setHandoffLock(null);
        }
      });
    },
    [onSelectPreset, packPresets, previewPreset, scheduleAfterBlur, userPresetItems]
  );

  const confirmDisabled = !pack || !selectedInstrumentId || !selectedCharacterId;
  const isEditMode = mode === "edit";
  const title = isEditMode ? "Edit Track" : "Add Track";
  const description = isEditMode
    ? "Adjust the sound pack, instrument, style, and saved loop for this track."
    : "Choose a sound pack, instrument, style, and optional saved loop to start a new groove.";
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
    : "Saved loops unavailable";

  const userPresetSelectValue =
    selectedPresetId && isUserPresetId(selectedPresetId) ? selectedPresetId : "";
  const packPresetSelectValue =
    selectedPresetId && !isUserPresetId(selectedPresetId) ? selectedPresetId : "";

  const userPresetSelectDisabled = presetSelectDisabled;
  const packPresetSelectDisabled = presetSelectDisabled || packPresets.length === 0;

  const savedLoopsHelperText = loadingState.preset
    ? "Loading presets..."
    : presetSelectDisabled
    ? presetBlockedLabel
    : userPresetItems.length === 0 && packPresets.length === 0
    ? "No saved loops available yet."
    : null;

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
        <label
          aria-disabled={packSelectDisabled}
          style={{
            ...fieldLabelStyle,
            opacity: packSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <span style={{ fontSize: 13, color: "#cbd5f5" }}>Sound Pack</span>
          <select
            value={selectedPackId || ""}
            onChange={handlePackSelectChange}
            disabled={packSelectDisabled}
            style={{
              ...baseSelectStyle,
              ...(packSelectDisabled ? disabledSelectStyle : {}),
              color:
                selectedPackId && !packSelectDisabled ? "#e6f2ff" : "#64748b",
            }}
          >
            <option value="" disabled>
              Select a sound pack
            </option>
            {packs.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <label
          aria-disabled={instrumentSelectDisabled}
          style={{
            ...fieldLabelStyle,
            opacity: instrumentSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <span style={{ fontSize: 13, color: "#cbd5f5" }}>Instrument</span>
          <select
            value={selectedInstrumentId || ""}
            onChange={handleInstrumentSelectChange}
            disabled={instrumentSelectDisabled}
            style={{
              ...baseSelectStyle,
              ...(instrumentSelectDisabled ? disabledSelectStyle : {}),
              color:
                selectedInstrumentId && !instrumentSelectDisabled
                  ? "#e6f2ff"
                  : "#64748b",
            }}
          >
            <option value="" disabled>
              {!selectedPackId
                ? "Select a sound pack first"
                : loadingState.instrument
                ? "Loading instruments..."
                : readyState.instrument
                ? "Select an instrument"
                : "Select a sound pack first"}
            </option>
            {instrumentOptions.map((instrument) => (
              <option key={instrument} value={instrument}>
                {formatInstrumentLabel(instrument)}
              </option>
            ))}
          </select>
          {loadingState.instrument ? (
            <span role="status" aria-live="polite" style={statusTextStyle}>
              Loading instruments...
            </span>
          ) : null}
        </label>

        <label
          aria-disabled={styleSelectDisabled}
          style={{
            ...fieldLabelStyle,
            opacity: styleSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <span style={{ fontSize: 13, color: "#cbd5f5" }}>Style</span>
          <select
            value={selectedCharacterId || ""}
            onChange={handleStyleSelectChange}
            disabled={styleSelectDisabled}
            style={{
              ...baseSelectStyle,
              ...(styleSelectDisabled ? disabledSelectStyle : {}),
              color:
                selectedCharacterId && !styleSelectDisabled
                  ? "#e6f2ff"
                  : "#64748b",
            }}
          >
            <option value="" disabled>
              {!selectedInstrumentId
                ? "Select an instrument first"
                : loadingState.style
                ? "Loading styles..."
                : readyState.style
                ? "Select a style"
                : "Select an instrument first"}
            </option>
            {characterOptions.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
          {loadingState.style ? (
            <span role="status" aria-live="polite" style={statusTextStyle}>
              Loading styles...
            </span>
          ) : null}
        </label>

        <section
          aria-disabled={presetSelectDisabled}
          style={{
            ...savedLoopsSectionStyle,
            opacity: presetSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h3 style={savedLoopsHeaderStyle}>Saved Loops</h3>
            <p style={savedLoopsSubcopyStyle}>
              Save the current loop or load one of your favorites.
            </p>
          </div>
          <div style={savedLoopsFieldsStyle}>
            <label style={fieldLabelStyle}>
              <span style={{ fontSize: 13, color: "#cbd5f5" }}>Your Saved Loops</span>
              <select
                value={userPresetSelectValue}
                onChange={handlePresetSelectChange}
                disabled={userPresetSelectDisabled}
                style={{
                  ...baseSelectStyle,
                  ...(userPresetSelectDisabled ? disabledSelectStyle : {}),
                  color:
                    !userPresetSelectDisabled && userPresetSelectValue
                      ? "#e6f2ff"
                      : "#64748b",
                }}
              >
                <option value="">Start fresh (no saved loop)</option>
                {userPresetItems.map((preset) => (
                  <option key={`user-${preset.id}`} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldLabelStyle}>
              <span style={{ fontSize: 13, color: "#cbd5f5" }}>Pack Loops</span>
              <select
                value={packPresetSelectValue}
                onChange={handlePresetSelectChange}
                disabled={packPresetSelectDisabled}
                style={{
                  ...baseSelectStyle,
                  ...(packPresetSelectDisabled ? disabledSelectStyle : {}),
                  color:
                    !packPresetSelectDisabled && packPresetSelectValue
                      ? "#e6f2ff"
                      : "#64748b",
                }}
              >
                {packPresetSelectDisabled ? (
                  <option value="" disabled>
                    {packPresets.length === 0
                      ? "No pack loops available"
                      : presetBlockedLabel}
                  </option>
                ) : (
                  <>
                    <option value="">Select a pack loop</option>
                    {packPresets.map((preset) => (
                      <option key={`pack-${preset.id}`} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
          </div>
          {savedLoopsHelperText ? (
            <span
              role={loadingState.preset ? "status" : undefined}
              aria-live={loadingState.preset ? "polite" : undefined}
              style={statusTextStyle}
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
                label="Delete saved loop"
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

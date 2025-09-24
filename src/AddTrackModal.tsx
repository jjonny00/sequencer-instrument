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
  const instrumentOptions = pack ? Object.keys(pack.instruments) : [];
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

  const scheduleAfterBlur = useCallback((task: () => void) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(task);
      });
    } else {
      setTimeout(task, 0);
    }
  }, []);

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
      setHandoffLock("pack");
      scheduleAfterBlur(() => {
        try {
          onSelectPack(nextValue);
        } finally {
          setHandoffLock(null);
        }
      });
    },
    [onSelectPack, scheduleAfterBlur]
  );

  const handleInstrumentSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const select = event.target;
      const nextValue = select.value;
      select.blur();
      setHandoffLock("instrument");
      scheduleAfterBlur(() => {
        try {
          onSelectInstrument(nextValue);
        } finally {
          setHandoffLock(null);
        }
      });
    },
    [onSelectInstrument, scheduleAfterBlur]
  );

  const handleStyleSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const select = event.target;
      const nextValue = select.value;
      select.blur();
      setHandoffLock("style");
      scheduleAfterBlur(() => {
        try {
          onSelectCharacter(nextValue);
          void previewStyle(nextValue);
        } finally {
          setHandoffLock(null);
        }
      });
    },
    [onSelectCharacter, previewStyle, scheduleAfterBlur]
  );

  const handlePresetSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const select = event.target;
      const nextValue = select.value;
      select.blur();
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

  const previewStyle = useCallback(
    async (characterId: string) => {
      if (!characterId || !selectedInstrumentId || !selectedPackId) return;
      const trigger =
        triggers[createTriggerKey(selectedPackId, selectedInstrumentId)];
      if (!trigger) return;
      try {
        await initAudioContext();
      } catch {
        return;
      }
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

  const packSelectDisabled = handoffLock !== null && handoffLock !== "pack";

  const instrumentOptionsReady = Boolean(pack && instrumentOptions.length > 0);
  const instrumentBaseDisabled = !instrumentOptionsReady;
  const instrumentSelectDisabled =
    instrumentBaseDisabled || (handoffLock !== null && handoffLock !== "instrument");

  const styleOptionsReady =
    Boolean(
      instrumentOptionsReady &&
        selectedInstrumentId &&
        characterOptions.length > 0
    );
  const styleBaseDisabled = !styleOptionsReady;
  const styleSelectDisabled =
    styleBaseDisabled || (handoffLock !== null && handoffLock !== "style");
  const presetBaseDisabled = styleBaseDisabled || !selectedCharacterId;
  const presetSelectDisabled =
    presetBaseDisabled || (handoffLock !== null && handoffLock !== "preset");
  const hasAvailablePresets = packPresets.length + userPresetItems.length > 0;

  const presetSelectValue = selectedPresetId ?? "";

  const presetBlockedLabel = !selectedPackId
    ? "Select a sound pack first"
    : !selectedInstrumentId
    ? "Select an instrument first"
    : !selectedCharacterId
    ? "Select a style first"
    : "Saved loops unavailable";

  const presetDefaultOptionLabel = hasAvailablePresets
    ? "Start fresh (no saved loop)"
    : "No saved loops available";

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
                : instrumentOptionsReady
                ? "Select an instrument"
                : "Loading instruments..."}
            </option>
            {instrumentOptions.map((instrument) => (
              <option key={instrument} value={instrument}>
                {formatInstrumentLabel(instrument)}
              </option>
            ))}
          </select>
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
                : styleOptionsReady
                ? "Select a style"
                : "Loading styles..."}
            </option>
            {characterOptions.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>

        <div
          aria-disabled={presetSelectDisabled}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            opacity: presetSelectDisabled ? 0.6 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <label style={fieldLabelStyle}>
            <span style={{ fontSize: 13, color: "#cbd5f5" }}>Saved Loop</span>
            <select
              value={presetSelectValue}
              onChange={handlePresetSelectChange}
              disabled={presetSelectDisabled}
              style={{
                ...baseSelectStyle,
                ...(presetSelectDisabled ? disabledSelectStyle : {}),
                color:
                  !presetSelectDisabled && selectedPresetId
                    ? "#e6f2ff"
                    : "#64748b",
              }}
            >
              {presetSelectDisabled ? (
                <option value="" disabled>
                  {presetBlockedLabel}
                </option>
              ) : (
                <>
                  <option value="">{presetDefaultOptionLabel}</option>
                  {hasAvailablePresets ? (
                    <>
                      {userPresetItems.length > 0 ? (
                        <optgroup label="Your saved loops">
                          {userPresetItems.map((preset) => (
                            <option key={`user-${preset.id}`} value={preset.id}>
                              {preset.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {packPresets.length > 0 ? (
                        <optgroup label="Pack loops">
                          {packPresets.map((preset) => (
                            <option key={`pack-${preset.id}`} value={preset.id}>
                              {preset.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </select>
          </label>
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
        </div>

      </div>
    </Modal>
  );
};

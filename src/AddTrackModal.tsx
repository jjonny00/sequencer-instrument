import { useCallback, useEffect, useMemo, useState, type FC } from "react";

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

interface AddTrackModalProps {
  isOpen: boolean;
  mode: "add" | "edit";
  packs: Pack[];
  selectedPackId: string;
  selectedInstrumentId: string;
  selectedCharacterId: string;
  selectedPresetId: string | null;
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
  const pack = packs.find((candidate) => candidate.id === selectedPackId) ?? packs[0] ?? null;
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
    { id: string; name: string; characterId: string | null }[]
  >([]);

  const refreshUserPresets = useCallback(() => {
    if (!pack || !selectedInstrumentId) {
      setUserPresets([]);
      return;
    }
    const presets = listInstrumentPresets(pack.id, selectedInstrumentId).map((preset) => ({
      id: preset.id,
      name: preset.name,
      characterId: preset.characterId,
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
      const confirmed = window.confirm("Delete this saved preset pattern?");
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
      window.alert("No pattern data available to save as a preset pattern.");
      return;
    }
    const suggestedName =
      editingTrackName?.trim() || formatInstrumentLabel(selectedInstrumentId);
    const defaultName = `${suggestedName} Pattern`;
    const name = window.prompt("Name your preset pattern", defaultName);
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
      window.alert("Unable to save this preset pattern.");
      return;
    }
    onSelectPreset(`${USER_PRESET_PREFIX}${record.id}`);
    refreshUserPresets();
    window.alert("Preset pattern saved.");
  }, [
    pack,
    selectedInstrumentId,
    editingTrackPattern,
    editingTrackName,
    selectedCharacterId,
    onSelectPreset,
    refreshUserPresets,
  ]);

  const characterLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    characterOptions.forEach((character) => {
      map.set(character.id, character.name);
    });
    return map;
  }, [characterOptions]);

  const packPresets = useMemo(
    () =>
      presetOptions.map((preset) => ({
        id: preset.id,
        name: preset.name,
        characterId: preset.characterId ?? null,
      })),
    [presetOptions]
  );

  const userPresetItems = useMemo(
    () =>
      userPresets.map((preset) => ({
        id: `${USER_PRESET_PREFIX}${preset.id}`,
        name: preset.name,
        characterId: preset.characterId,
      })),
    [userPresets]
  );

  const combinedPresetItems = useMemo(
    () => [...userPresetItems, ...packPresets],
    [userPresetItems, packPresets]
  );

  const confirmDisabled = !pack || !selectedInstrumentId;
  const isEditMode = mode === "edit";
  const title = isEditMode ? "Edit Track" : "Add Track";
  const description = isEditMode
    ? "Adjust the sound pack, instrument, character, and preset pattern for this track."
    : "Choose a sound pack, instrument, character, and optional preset pattern to start a new groove.";
  const confirmLabel = isEditMode ? "Update Track" : "Add Track";

  if (!isOpen) return null;

  const renderPresetRow = (
    item: { id: string; name: string; characterId: string | null },
    source: "user" | "pack"
  ) => {
    const isSelected = selectedPresetId === item.id;
    const characterLabel = item.characterId
      ? characterLabelMap.get(item.characterId) ?? "Custom character"
      : null;

    return (
      <div
        key={`${source}-${item.id}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 12px",
          borderRadius: 12,
          border: isSelected ? "1px solid #27E0B0" : "1px solid #1f2937",
          background: isSelected ? "rgba(39, 224, 176, 0.08)" : "#0f172a",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            {source === "user" ? "Saved preset" : "Pack preset"}
            {characterLabel ? ` · ${characterLabel}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <IconButton
            icon="folder_open"
            label={`Load preset ${item.name}`}
            tone={isSelected ? "accent" : "default"}
            onClick={() => onSelectPreset(item.id)}
          />
          {source === "user" ? (
            <IconButton
              icon="delete"
              label={`Delete preset ${item.name}`}
              tone="danger"
              onClick={() => handleDeletePreset(item.id)}
            />
          ) : null}
        </div>
      </div>
    );
  };

  const currentPresetLabel = selectedPresetId
    ? combinedPresetItems.find((preset) => preset.id === selectedPresetId)?.name ?? "Custom"
    : "None";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      subtitle={description}
      maxWidth={520}
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            width: "100%",
          }}
        >
          {isEditMode && onDelete ? (
            <IconButton
              icon="delete"
              label="Remove track"
              tone="danger"
              onClick={onDelete}
            />
          ) : (
            <div />
          )}
          <div style={{ display: "flex", gap: 12 }}>
            <IconButton icon="close" label="Cancel" tone="ghost" onClick={onCancel} />
            <IconButton
              icon={isEditMode ? "check" : "add"}
              label={confirmLabel}
              tone="accent"
              onClick={onConfirm}
              disabled={confirmDisabled}
            />
          </div>
        </div>
      }
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: "#cbd5f5" }}>Sound Pack</span>
        <select
          value={pack?.id ?? ""}
          onChange={(event) => onSelectPack(event.target.value)}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #2f384a",
            background: "#0f172a",
            color: "#e6f2ff",
          }}
        >
          {packs.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: "#cbd5f5" }}>Instrument</span>
        <select
          value={selectedInstrumentId}
          onChange={(event) => onSelectInstrument(event.target.value)}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #2f384a",
            background: "#0f172a",
            color: selectedInstrumentId ? "#e6f2ff" : "#64748b",
          }}
        >
          {instrumentOptions.length === 0 ? (
            <option value="" disabled>
              No instruments available
            </option>
          ) : (
            instrumentOptions.map((instrument) => (
              <option key={instrument} value={instrument}>
                {formatInstrumentLabel(instrument)}
              </option>
            ))
          )}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: "#cbd5f5" }}>Character</span>
        <select
          value={selectedCharacterId}
          onChange={(event) => onSelectCharacter(event.target.value)}
          disabled={characterOptions.length === 0}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #2f384a",
            background: "#0f172a",
            color: characterOptions.length > 0 ? "#e6f2ff" : "#64748b",
          }}
        >
          {characterOptions.length === 0 ? (
            <option value="" disabled>
              No characters
            </option>
          ) : (
            characterOptions.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))
          )}
        </select>
      </label>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 16,
          borderRadius: 16,
          background: "#0b1624",
          border: "1px solid #1f2937",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 600 }}>Preset Patterns</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Save the current pattern or load one of your favorites.
            </span>
          </div>
          <IconButton
            icon="save"
            label="Save current pattern as preset"
            tone="accent"
            onClick={handleSavePresetPattern}
            disabled={!isEditMode || !editingTrackPattern}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#cbd5f5", fontWeight: 600 }}>
              Your Presets
            </span>
            {userPresetItems.length > 0 ? (
              userPresetItems.map((preset) => renderPresetRow(preset, "user"))
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  padding: "12px 0",
                }}
              >
                No presets saved yet
              </div>
            )}
          </div>
          {packPresets.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#cbd5f5", fontWeight: 600 }}>
                Pack Presets
              </span>
              {packPresets.map((preset) => renderPresetRow(preset, "pack"))}
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "#94a3b8",
        }}
      >
        <span>Current preset: {currentPresetLabel}</span>
        {selectedPresetId ? (
          <IconButton
            icon="backspace"
            label="Clear preset selection"
            tone="ghost"
            onClick={() => onSelectPreset(null)}
          />
        ) : null}
      </div>
    </Modal>
  );
};

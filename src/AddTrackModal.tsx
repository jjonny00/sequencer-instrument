import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FC,
  type KeyboardEvent,
} from "react";

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

  const handleTogglePresetSelection = useCallback(
    (presetId: string | null) => {
      if (presetId === null) {
        onSelectPreset(null);
        return;
      }
      if (selectedPresetId === presetId) {
        onSelectPreset(null);
        return;
      }
      onSelectPreset(presetId);
    },
    [onSelectPreset, selectedPresetId]
  );

  const renderPresetRow = (
    item: { id: string; name: string; characterId: string | null },
    source: "user" | "pack"
  ) => {
    const isSelected = selectedPresetId === item.id;
    const characterLabel =
      source === "user" && item.characterId
        ? characterLabelMap.get(item.characterId) ?? undefined
        : undefined;

    const handleClick = () => handleTogglePresetSelection(item.id);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleClick();
      }
    };

    return (
      <div
        key={`${source}-${item.id}`}
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 12,
          border: isSelected ? "1px solid #27E0B0" : "1px solid #1f2937",
          background: isSelected ? "rgba(39, 224, 176, 0.12)" : "#0f172a",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</span>
          {characterLabel ? (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{characterLabel}</span>
          ) : null}
        </div>
        {source === "user" ? (
          <IconButton
            icon="delete"
            label={`Delete preset ${item.name}`}
            tone="danger"
            onClick={(event) => {
              event.stopPropagation();
              handleDeletePreset(item.id);
            }}
          />
        ) : null}
      </div>
    );
  };

  const handleNoneKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleTogglePresetSelection(null);
      }
    },
    [handleTogglePresetSelection]
  );

  const currentPresetLabel = selectedPresetId
    ? combinedPresetItems.find((preset) => preset.id === selectedPresetId)?.name ?? "Custom"
    : "None";

  const sectionListStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    flex: "1 1 auto",
    minHeight: 0,
    paddingRight: 4,
    paddingBottom: 16,
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      subtitle={description}
      fullScreen
      footer={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            width: "100%",
            padding: "4px 0",
          }}
        >
          {isEditMode && onDelete ? (
            <IconButton
              icon="delete"
              label="Remove track"
              tone="danger"
              iconSize={20}
              style={compactIconButtonStyle}
              onClick={onDelete}
            />
          ) : (
            <div />
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
        </div>
      }
    >
      <div style={sectionListStyle}>
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
          <span style={{ fontSize: 13, color: "#cbd5f5" }}>Style</span>
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
                No styles
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
                <span style={{ fontWeight: 600 }}>Saved Loops</span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  Save the current loop or load one of your favorites.
                </span>
              </div>
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
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#cbd5f5", fontWeight: 600 }}>
                  Your Saved Loops
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleTogglePresetSelection(null)}
                    onKeyDown={handleNoneKeyDown}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: 12,
                      border:
                        selectedPresetId === null
                          ? "1px solid #27E0B0"
                          : "1px solid #1f2937",
                      background:
                        selectedPresetId === null
                          ? "rgba(39, 224, 176, 0.12)"
                          : "#0f172a",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14 }}>None</span>
                  </div>
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
                      No saved loops yet
                    </div>
                  )}
                </div>
              </div>
              {packPresets.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#cbd5f5", fontWeight: 600 }}>
                    Pack Loops
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {packPresets.map((preset) => renderPresetRow(preset, "pack"))}
                  </div>
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
          <span>Current saved loop: {currentPresetLabel}</span>
        </div>
      </div>
    </Modal>
  );
};

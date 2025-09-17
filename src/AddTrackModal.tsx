import type { FC } from "react";

import type { Pack } from "./packs";
import { getCharacterOptions } from "./addTrackOptions";
import { formatInstrumentLabel } from "./utils/instrument";

interface AddTrackModalProps {
  isOpen: boolean;
  mode: "add" | "edit";
  packs: Pack[];
  selectedPackId: string;
  selectedInstrumentId: string;
  selectedCharacterId: string;
  selectedPresetId: string | null;
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
  onSelectPack,
  onSelectInstrument,
  onSelectCharacter,
  onSelectPreset,
  onCancel,
  onConfirm,
  onDelete,
}) => {
  if (!isOpen) return null;

  const pack = packs.find((p) => p.id === selectedPackId) ?? packs[0] ?? null;
  const instrumentOptions = pack
    ? Object.keys(pack.instruments)
    : [];
  const characterOptions = selectedInstrumentId
    ? getCharacterOptions(pack?.id ?? "", selectedInstrumentId)
    : [];
  const presetOptions = pack
    ? pack.chunks.filter((chunk) => chunk.instrument === selectedInstrumentId)
    : [];

  const confirmDisabled = !pack || !selectedInstrumentId;
  const isEditMode = mode === "edit";
  const title = isEditMode ? "Edit Track" : "Add Track";
  const description = isEditMode
    ? "Adjust the sound pack, instrument, character, and preset for this track."
    : "Choose a sound pack, instrument, character, and optional preset to start a new groove.";
  const confirmLabel = isEditMode ? "Update Track" : "Add Track";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(12, 18, 30, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 30,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#1b2231",
          borderRadius: 16,
          border: "1px solid #2f384a",
          boxShadow: "0 24px 48px rgba(5, 9, 18, 0.65)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          color: "#e6f2ff",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{title}</span>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>{description}</span>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, color: "#cbd5f5" }}>Sound Pack</span>
          <select
            value={pack?.id ?? ""}
            onChange={(event) => onSelectPack(event.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #334155",
              background: "#111827",
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
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #334155",
              background: "#111827",
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
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #334155",
              background: "#111827",
              color:
                characterOptions.length > 0 ? "#e6f2ff" : "#64748b",
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

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, color: "#cbd5f5" }}>
            Pattern Preset (optional)
          </span>
          <select
            value={selectedPresetId ?? ""}
            onChange={(event) =>
              onSelectPreset(event.target.value ? event.target.value : null)
            }
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #334155",
              background: "#111827",
              color:
                selectedPresetId || presetOptions.length > 0
                  ? "#e6f2ff"
                  : "#64748b",
            }}
          >
            <option value="">None</option>
            {presetOptions.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 8,
          }}
        >
          {isEditMode && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 999,
                border: "1px solid #4c1d24",
                background: "#E02749",
                color: "#e6f2ff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Remove Track
            </button>
          )}
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: 999,
                border: "1px solid #334155",
                background: "#111827",
                color: "#cbd5f5",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: 999,
                border: "1px solid #1b4332",
                background: confirmDisabled ? "#1f2532" : "#27E0B0",
                color: confirmDisabled ? "#475569" : "#0f1420",
                fontWeight: 700,
                cursor: confirmDisabled ? "not-allowed" : "pointer",
                boxShadow: confirmDisabled
                  ? "none"
                  : "0 8px 18px rgba(15, 32, 38, 0.45)",
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


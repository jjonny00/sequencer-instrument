import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type KeyboardEvent,
  type ReactNode,
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
import type { TriggerMap } from "./tracks";
import { initAudioContext } from "./utils/audio";

interface StepSectionProps {
  visible: boolean;
  delay?: number;
  children: ReactNode;
}

const StepSection: FC<StepSectionProps> = ({ visible, delay = 0, children }) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const updateHeight = () => {
      setContentHeight(element.getBoundingClientRect().height);
    };

    updateHeight();

    const win = typeof window !== "undefined" ? window : undefined;
    if (!win) return;

    let observer: ResizeObserver | null = null;

    if (win.ResizeObserver) {
      observer = new win.ResizeObserver(updateHeight);
      observer.observe(element);
    } else {
      win.addEventListener("resize", updateHeight);
    }

    return () => {
      observer?.disconnect();
      if (!observer) {
        win.removeEventListener("resize", updateHeight);
      }
    };
  }, [children]);

  const targetHeight = visible ? Math.max(contentHeight, 1) : 0;

  return (
    <div
      style={{
        width: "100%",
        maxHeight: targetHeight,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(16px)",
        overflow: "hidden",
        transition:
          "max-height 0.4s ease, opacity 0.3s ease, transform 0.3s ease",
        transitionDelay: visible ? `${delay}s` : "0s",
        pointerEvents: visible ? "auto" : "none",
        marginBottom: visible ? 16 : 0,
      }}
    >
      <div
        ref={contentRef}
        style={{
          visibility: visible ? "visible" : "hidden",
          transform: visible ? "translateX(0)" : "translateX(16px)",
          transition: "transform 0.3s ease",
          transitionDelay: visible ? `${delay}s` : "0s",
        }}
      >
        {children}
      </div>
    </div>
  );
};

interface PresetListItem {
  id: string;
  name: string;
  characterId: string | null;
  pattern?: Chunk;
}

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

  const previewStyle = useCallback(
    async (characterId: string) => {
      if (!characterId || !selectedInstrumentId) return;
      const trigger = triggers[selectedInstrumentId];
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
    [selectedInstrumentId, triggers]
  );

  const previewPreset = useCallback(
    async (chunk: Chunk, fallbackCharacterId?: string | null) => {
      const instrumentId = chunk.instrument || selectedInstrumentId;
      if (!instrumentId) return;
      const trigger = triggers[instrumentId];
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
    [selectedCharacterId, selectedInstrumentId, triggers]
  );

  const handleCharacterChange = useCallback(
    (characterId: string) => {
      onSelectCharacter(characterId);
      void previewStyle(characterId);
    },
    [onSelectCharacter, previewStyle]
  );

  const renderPresetRow = (
    item: PresetListItem,
    source: "user" | "pack"
  ) => {
    const isSelected = selectedPresetId === item.id;
    const characterLabel =
      source === "user" && item.characterId
        ? characterLabelMap.get(item.characterId) ?? undefined
        : undefined;

    const handleActivate = () => {
      if (item.pattern) {
        void previewPreset(item.pattern, item.characterId);
      }
      handleTogglePresetSelection(item.id);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleActivate();
      }
    };

    return (
      <div
        key={`${source}-${item.id}`}
        role="button"
        tabIndex={0}
        onClick={handleActivate}
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

  const sectionListStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    flex: "1 1 auto",
    minHeight: 0,
    paddingRight: 4,
    paddingBottom: 16,
  };

  const instrumentVisible = Boolean(pack && selectedPackId);
  const styleVisible = instrumentVisible && Boolean(selectedInstrumentId);
  const presetVisible = styleVisible && Boolean(selectedCharacterId);

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
            padding: "8px 0",
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
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#cbd5f5" }}>Sound Pack</span>
            <select
              value={selectedPackId}
              onChange={(event) => onSelectPack(event.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #2f384a",
                background: "#0f172a",
                color: selectedPackId ? "#e6f2ff" : "#64748b",
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
        </div>

        <StepSection visible={instrumentVisible}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#cbd5f5" }}>Instrument</span>
            <select
              value={selectedInstrumentId}
              onChange={(event) => onSelectInstrument(event.target.value)}
              disabled={instrumentOptions.length === 0}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #2f384a",
                background: "#0f172a",
                color:
                  selectedInstrumentId && instrumentOptions.length > 0
                    ? "#e6f2ff"
                    : "#64748b",
              }}
            >
              <option value="" disabled>
                {instrumentOptions.length === 0
                  ? "No instruments available"
                  : "Select an instrument"}
              </option>
              {instrumentOptions.map((instrument) => (
                <option key={instrument} value={instrument}>
                  {formatInstrumentLabel(instrument)}
                </option>
              ))}
            </select>
          </label>
        </StepSection>

        <StepSection visible={styleVisible} delay={0.05}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#cbd5f5" }}>Style</span>
            <select
              value={selectedCharacterId}
              onChange={(event) => handleCharacterChange(event.target.value)}
              disabled={characterOptions.length === 0}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #2f384a",
                background: "#0f172a",
                color:
                  selectedCharacterId && characterOptions.length > 0
                    ? "#e6f2ff"
                    : "#64748b",
              }}
            >
              <option value="" disabled>
                {characterOptions.length === 0 ? "No styles available" : "Select a style"}
              </option>
              {characterOptions.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </label>
        </StepSection>

        <StepSection visible={presetVisible} delay={0.1}>
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
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    Tap to preview before adding.
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {packPresets.map((preset) => renderPresetRow(preset, "pack"))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </StepSection>

      </div>
    </Modal>
  );
};

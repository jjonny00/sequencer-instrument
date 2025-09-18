import type { Chunk } from "./chunks";

const STORAGE_KEY = "sequencer_presets";
export const USER_PRESET_PREFIX = "user:";
export const PRESETS_UPDATED_EVENT = "sequencer-presets-updated";

export interface InstrumentPreset {
  id: string;
  name: string;
  packId: string;
  instrumentId: string;
  characterId: string | null;
  pattern: Chunk;
  createdAt: number;
  updatedAt: number;
}

interface PresetStore {
  [packId: string]: {
    [instrumentId: string]: InstrumentPreset[];
  };
}

const cloneChunk = (chunk: Chunk): Chunk => ({
  ...chunk,
  steps: chunk.steps.slice(),
  velocities: chunk.velocities ? chunk.velocities.slice() : undefined,
  pitches: chunk.pitches ? chunk.pitches.slice() : undefined,
  notes: chunk.notes ? chunk.notes.slice() : undefined,
  degrees: chunk.degrees ? chunk.degrees.slice() : undefined,
  noteEvents: chunk.noteEvents ? chunk.noteEvents.map((event) => ({ ...event })) : undefined,
});

const getStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("Local storage unavailable", error);
    return null;
  }
};

const readAllPresets = (): PresetStore => {
  const storage = getStorage();
  if (!storage) return {};
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as PresetStore;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (error) {
    console.warn("Failed to parse stored presets", error);
    return {};
  }
};

const writeAllPresets = (presets: PresetStore) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(presets));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(PRESETS_UPDATED_EVENT));
    }
  } catch (error) {
    console.warn("Failed to persist presets", error);
  }
};

const createId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
};

export const isUserPresetId = (value: string | null | undefined): value is string => {
  if (!value) return false;
  return value.startsWith(USER_PRESET_PREFIX);
};

export const stripUserPresetPrefix = (value: string) =>
  value.startsWith(USER_PRESET_PREFIX)
    ? value.slice(USER_PRESET_PREFIX.length)
    : value;

export interface SavePresetPayload {
  name: string;
  packId: string;
  instrumentId: string;
  characterId: string | null;
  pattern: Chunk;
}

export const saveInstrumentPreset = (
  payload: SavePresetPayload
): InstrumentPreset | null => {
  const { name, packId, instrumentId, characterId, pattern } = payload;
  if (!packId || !instrumentId) return null;
  const presets = readAllPresets();
  const existing = presets[packId]?.[instrumentId] ?? [];
  const now = Date.now();
  const record: InstrumentPreset = {
    id: createId(),
    name: name.trim() || pattern.name || "Untitled Preset Pattern",
    packId,
    instrumentId,
    characterId: characterId ?? null,
    pattern: cloneChunk(pattern),
    createdAt: now,
    updatedAt: now,
  };
  const nextPack = { ...presets[packId] };
  nextPack[instrumentId] = [record, ...existing];
  writeAllPresets({ ...presets, [packId]: nextPack });
  return record;
};

export const listInstrumentPresets = (
  packId: string,
  instrumentId: string
): InstrumentPreset[] => {
  if (!packId || !instrumentId) return [];
  const presets = readAllPresets();
  const collection = presets[packId]?.[instrumentId] ?? [];
  return collection
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((preset) => ({
      ...preset,
      pattern: cloneChunk(preset.pattern),
    }));
};

export const loadInstrumentPreset = (
  packId: string,
  instrumentId: string,
  presetId: string
): InstrumentPreset | null => {
  if (!packId || !instrumentId || !presetId) return null;
  const presets = readAllPresets();
  const collection = presets[packId]?.[instrumentId] ?? [];
  const preset = collection.find((candidate) => candidate.id === presetId);
  if (!preset) return null;
  return {
    ...preset,
    pattern: cloneChunk(preset.pattern),
  };
};

export const deleteInstrumentPreset = (
  packId: string,
  instrumentId: string,
  presetId: string
): boolean => {
  if (!packId || !instrumentId || !presetId) return false;
  const presets = readAllPresets();
  const collection = presets[packId]?.[instrumentId];
  if (!collection) return false;
  const nextCollection = collection.filter((preset) => preset.id !== presetId);
  if (nextCollection.length === collection.length) return false;
  const nextPack = { ...presets[packId], [instrumentId]: nextCollection };
  const next = { ...presets, [packId]: nextPack };
  writeAllPresets(next);
  return true;
};


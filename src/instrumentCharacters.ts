import type { Chunk } from "./chunks";
import {
  DEFAULT_KICK_STATE,
  mergeKickDesignerState,
  normalizeKickDesignerState,
} from "./instruments/kickState";
import type { InstrumentDefinition } from "./packs";

export const resolveInstrumentCharacterId = (
  instrumentDefinition: InstrumentDefinition | undefined,
  requestedCharacterId: string | null | undefined,
  presetCharacterId: string | null | undefined,
  patternCharacterId: string | null | undefined
): string => {
  const available = instrumentDefinition?.characters?.map((character) => character.id) ?? [];
  const pickCandidate = (candidate: string | null | undefined): string | null => {
    if (!candidate) return null;
    if (available.length === 0) return candidate;
    return available.includes(candidate) ? candidate : null;
  };

  return (
    pickCandidate(requestedCharacterId) ??
    pickCandidate(presetCharacterId) ??
    pickCandidate(patternCharacterId) ??
    pickCandidate(instrumentDefinition?.defaultCharacterId) ??
    (available.length > 0
      ? available[0]
      : requestedCharacterId ?? presetCharacterId ?? patternCharacterId ?? "")
  );
};

export const resolveKickDefaults = (
  instrument: InstrumentDefinition | undefined,
  characterId: string | null | undefined
) => {
  if (!instrument) return DEFAULT_KICK_STATE;
  const activeId =
    characterId ??
    instrument.defaultCharacterId ??
    instrument.characters[0]?.id ??
    null;
  const character = activeId
    ? instrument.characters.find((candidate) => candidate.id === activeId) ?? null
    : instrument.characters[0] ?? null;
  return character
    ? normalizeKickDesignerState(character.defaults)
    : DEFAULT_KICK_STATE;
};

export const applyKickMacrosToChunk = (
  chunk: Chunk,
  instrument: InstrumentDefinition | undefined,
  characterId: string | null | undefined,
  previousCharacterId?: string | null | undefined
): Chunk => {
  if (chunk.instrument !== "kick") return chunk;
  const defaults = resolveKickDefaults(
    instrument,
    characterId ?? chunk.characterId ?? null
  );
  const activeCharacterId = characterId ?? chunk.characterId ?? null;
  const hasOverrides =
    chunk.punch !== undefined || chunk.clean !== undefined || chunk.tight !== undefined;
  const characterChanged =
    previousCharacterId !== undefined &&
    previousCharacterId !== null &&
    activeCharacterId !== null &&
    previousCharacterId !== activeCharacterId;

  if (!hasOverrides || characterChanged) {
    if (
      chunk.punch === defaults.punch &&
      chunk.clean === defaults.clean &&
      chunk.tight === defaults.tight
    ) {
      return chunk;
    }
    return {
      ...chunk,
      punch: defaults.punch,
      clean: defaults.clean,
      tight: defaults.tight,
    };
  }

  const merged = mergeKickDesignerState(defaults, {
    punch: chunk.punch,
    clean: chunk.clean,
    tight: chunk.tight,
  });
  if (
    chunk.punch === merged.punch &&
    chunk.clean === merged.clean &&
    chunk.tight === merged.tight
  ) {
    return chunk;
  }
  return {
    ...chunk,
    punch: merged.punch,
    clean: merged.clean,
    tight: merged.tight,
  };
};


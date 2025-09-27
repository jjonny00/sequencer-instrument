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

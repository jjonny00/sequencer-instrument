import { packs } from "./packs";
import { formatInstrumentLabel } from "./utils/instrument";

export interface CharacterOption {
  id: string;
  name: string;
  description?: string;
}

const createFallbackCharacters = (instrumentId: string): CharacterOption[] => {
  if (!instrumentId) return [];
  return [
    {
      id: `${instrumentId}-default`,
      name: formatInstrumentLabel(instrumentId),
    },
  ];
};

export const getCharacterOptions = (
  packId: string,
  instrumentId: string
): CharacterOption[] => {
  if (!packId || !instrumentId) {
    return createFallbackCharacters(instrumentId);
  }
  const pack = packs.find((candidate) => candidate.id === packId);
  if (!pack) return createFallbackCharacters(instrumentId);
  const instrument = pack.instruments[instrumentId];
  if (!instrument) return createFallbackCharacters(instrumentId);
  if (!instrument.characters || instrument.characters.length === 0) {
    return createFallbackCharacters(instrumentId);
  }
  return instrument.characters.map((character) => ({
    id: character.id,
    name: character.name,
    description: character.description,
  }));
};


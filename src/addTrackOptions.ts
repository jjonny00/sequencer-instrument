import { formatInstrumentLabel } from "./utils/instrument";

export interface CharacterOption {
  id: string;
  name: string;
  description?: string;
}

type PackCharacterMap = Record<string, Record<string, CharacterOption[]>>;

const PACK_CHARACTER_MAP: PackCharacterMap = {
  phonk: {
    kick: [
      { id: "classic-808", name: "Classic 808" },
      { id: "saturated-boom", name: "Saturated Boom" },
    ],
    snare: [
      { id: "tight-snap", name: "Tight Snap" },
      { id: "vinyl-crack", name: "Vinyl Crack" },
    ],
    hat: [
      { id: "shufflin", name: "Shufflin' Hat" },
      { id: "spray", name: "Spray Cymbal" },
    ],
    cowbell: [{ id: "club-bell", name: "Club Bell" }],
    chord: [
      { id: "dusty-keys", name: "Dusty Keys" },
      { id: "lofi-pad", name: "Lo-fi Pad" },
    ],
    arpeggiator: [
      { id: "midnight-arp", name: "Midnight Arp" },
      { id: "drift-lights", name: "Drift Lights" },
    ],
  },
  edm2000s: {
    kick: [
      { id: "trance-thump", name: "Trance Thump" },
      { id: "sidechain", name: "Sidechain Pump" },
    ],
    snare: [
      { id: "digital-snap", name: "Digital Snap" },
      { id: "reverb-clap", name: "Reverb Clap" },
    ],
    hat: [
      { id: "sparkle", name: "Sparkle Tick" },
      { id: "driver", name: "Driver Hat" },
    ],
    bass: [
      { id: "saw-pluck", name: "Saw Pluck" },
      { id: "rolling-sub", name: "Rolling Sub" },
    ],
    chord: [
      { id: "saw-pad", name: "Saw Pad" },
      { id: "airwash", name: "Airwash Layer" },
    ],
    arpeggiator: [
      { id: "stutter-stars", name: "Stutter Stars" },
      { id: "laser-chase", name: "Laser Chase" },
    ],
  },
  kraftwerk: {
    kick: [
      { id: "motor-kick", name: "Motor Kick" },
      { id: "analog-punch", name: "Analog Punch" },
    ],
    snare: [
      { id: "machine-snare", name: "Machine Snare" },
      { id: "air-lock", name: "Air Lock" },
    ],
    hat: [
      { id: "robot-hat", name: "Robot Hat" },
      { id: "metronome", name: "Metronome Hat" },
    ],
    bass: [
      { id: "square-robot", name: "Square Robot" },
      { id: "pulse-drive", name: "Pulse Drive" },
    ],
    chord: [
      { id: "organ-pad", name: "Organ Pad" },
      { id: "glass-wave", name: "Glass Wave" },
    ],
    arpeggiator: [
      { id: "neon-steps", name: "Neon Steps" },
      { id: "data-stream", name: "Data Stream" },
    ],
  },
};

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
  const pack = PACK_CHARACTER_MAP[packId];
  if (!pack) return createFallbackCharacters(instrumentId);
  const characters = pack[instrumentId];
  if (!characters || characters.length === 0) {
    return createFallbackCharacters(instrumentId);
  }
  return characters;
};


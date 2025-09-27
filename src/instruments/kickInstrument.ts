import * as Tone from "tone";
import { packs, type InstrumentCharacter } from "@/packs";

interface KickCharacterDefaults {
  pitchDecay?: number;
  octaves?: number;
  decay?: number;
  release?: number;
  noiseDb?: number;
}

export const resolveKickCharacter = (
  packId: string,
  characterId?: string
): InstrumentCharacter | undefined => {
  const pack = packs.find((candidate) => candidate.id === packId);
  const kickInstrument = pack?.instruments?.kick;
  const characters = kickInstrument?.characters ?? [];

  if (characters.length === 0) {
    return undefined;
  }

  const resolvedId = characterId ?? kickInstrument?.defaultCharacterId;
  const resolvedCharacter = characters.find((character) => character.id === resolvedId);
  const defaultCharacter = kickInstrument?.defaultCharacterId
    ? characters.find((character) => character.id === kickInstrument.defaultCharacterId)
    : undefined;

  return resolvedCharacter ?? defaultCharacter ?? characters[0];
};

export const createKick = (packId: string, characterId?: string) => {
  const character = resolveKickCharacter(packId, characterId);

  if (!character) {
    throw new Error(`Unable to resolve kick character for pack "${packId}".`);
  }

  const {
    pitchDecay = 0.05,
    octaves = 4,
    decay = 0.3,
    release = 0.25,
    noiseDb = -Infinity,
  } = (character.defaults ?? {}) as KickCharacterDefaults;

  if (import.meta.env.DEV) {
    console.info("[kickInstrument]", {
      packId,
      characterId: character.id,
      params: { pitchDecay, octaves, decay, release, noiseDb },
    });
  }

  const output = new Tone.Gain(1).toDestination();
  const body = new Tone.MembraneSynth({
    pitchDecay,
    octaves,
    envelope: {
      attack: 0.001,
      decay,
      sustain: 0,
      release,
    },
  });
  body.connect(output);

  let noise: Tone.NoiseSynth | undefined;
  let noiseGain: Tone.Gain | undefined;

  if (noiseDb > -36) {
    noise = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: {
        attack: 0,
        decay: Math.max(0.015, Math.min(decay, 0.05)),
        sustain: 0,
        release: Math.max(0.02, Math.min(release, 0.08)),
      },
    });
    noiseGain = new Tone.Gain(Tone.dbToGain(noiseDb));
    noise.connect(noiseGain);
    noiseGain.connect(output);
  }

  const triggerAttackRelease = (
    note?: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => {
    const resolvedTime = time ?? Tone.now();
    const resolvedDuration = duration ?? decay;
    const resolvedNote = note ?? ("C2" as Tone.Unit.Frequency);

    body.oscillator.phase = 0;
    body.triggerAttackRelease(resolvedNote, resolvedDuration, resolvedTime, velocity);
    noise?.triggerAttackRelease(resolvedDuration, resolvedTime, velocity);
  };

  const dispose = () => {
    body.dispose();
    noise?.dispose();
    noiseGain?.dispose();
    output.dispose();
  };

  return { triggerAttackRelease, dispose };
};

import * as Tone from "tone";

import { packs } from "../packs";
import type { InstrumentCharacter } from "../packs";

export interface KickDesignerState {
  punch: number;
  clean: number;
  tight: number;
}

export const DEFAULT_KICK_STATE: KickDesignerState = {
  punch: 0.5,
  clean: 0.5,
  tight: 0.5,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const normalizeKickDesignerState = (
  state?: Partial<KickDesignerState> | null
): KickDesignerState => ({
  punch: clamp(state?.punch ?? DEFAULT_KICK_STATE.punch, 0, 1),
  clean: clamp(state?.clean ?? DEFAULT_KICK_STATE.clean, 0, 1),
  tight: clamp(state?.tight ?? DEFAULT_KICK_STATE.tight, 0, 1),
});

export const mergeKickDesignerState = (
  defaults: Partial<KickDesignerState> | null | undefined,
  overrides: Partial<KickDesignerState> | null | undefined
): KickDesignerState =>
  normalizeKickDesignerState({
    punch: overrides?.punch ?? defaults?.punch,
    clean: overrides?.clean ?? defaults?.clean,
    tight: overrides?.tight ?? defaults?.tight,
  });

export const mapKickParams = ({
  punch,
  clean,
  tight,
}: KickDesignerState) => ({
  sub: {
    pitchDecay: 0.01 + punch * 0.04, // 0.01–0.05
    octaves: 2 + Math.round(punch * 4), // 2–6
    envelope: {
      attack: 0.005,
      decay: 0.2 + (1 - clean) * 0.4, // 0.2–0.6
      sustain: 0,
      release: 0.05 + (1 - clean) * 0.15, // 0.05–0.2
    },
  },
  noise: {
    volume: -30 + (1 - tight) * 15, // -30 to -15 dB
  },
});

const getInstrumentCharacter = (
  packId: string,
  instrumentId: string,
  characterId: string
): InstrumentCharacter | null => {
  const pack = packs.find((candidate) => candidate.id === packId);
  if (!pack) return null;
  const definition = pack.instruments?.[instrumentId];
  if (!definition) return null;
  return (
    definition.characters.find((character) => character.id === characterId) ??
    null
  );
};

const resolveKickCharacter = (characterId: string): InstrumentCharacter => {
  for (const pack of packs) {
    const character = getInstrumentCharacter(pack.id, "kick", characterId);
    if (character) {
      return character;
    }
  }
  throw new Error(`Unknown kick character: ${characterId}`);
};

type KickNoiseNodes = {
  synth: Tone.NoiseSynth;
  gain: Tone.Gain;
};

export type KickDesignerInstrument = Tone.Gain & {
  triggerAttackRelease: (
    note?: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => void;
};

export function createKick(characterId: string): KickDesignerInstrument {
  const character = resolveKickCharacter(characterId);
  const defaults = normalizeKickDesignerState(character.defaults);
  const params = mapKickParams(defaults);

  const output = new Tone.Gain(1) as KickDesignerInstrument;

  const sub = new Tone.MembraneSynth({
    oscillator: { phase: 0 },
    pitchDecay: params.sub.pitchDecay,
    octaves: params.sub.octaves,
    envelope: params.sub.envelope,
  });
  sub.connect(output);

  let noiseNodes: KickNoiseNodes | null = null;

  if (params.noise.volume > -30) {
    const synth = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 },
    });
    const gain = new Tone.Gain(Tone.dbToGain(params.noise.volume));
    synth.connect(gain);
    gain.connect(output);
    noiseNodes = { synth, gain };
  }

  output.triggerAttackRelease = (
    note = "C1",
    duration: Tone.Unit.Time = "8n",
    time?: Tone.Unit.Time,
    velocity = 1
  ) => {
    const when = time ?? Tone.now();
    sub.oscillator.set({ phase: 0 });
    sub.triggerAttackRelease(note, duration, when, velocity);
    if (noiseNodes) {
      noiseNodes.synth.triggerAttackRelease(duration, when, velocity);
    }
  };

  const originalDispose = output.dispose.bind(output);
  output.dispose = () => {
    sub.dispose();
    if (noiseNodes) {
      noiseNodes.synth.dispose();
      noiseNodes.gain.dispose();
    }
    return originalDispose();
  };

  return output;
}

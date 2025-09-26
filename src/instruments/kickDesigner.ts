import * as Tone from "tone";

import { packs } from "../packs";

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
    pitchDecay: 0.01 + punch * 0.04,
    octaves: 2 + Math.round(punch * 4),
    envelope: {
      attack: 0.005,
      decay: 0.2 + (1 - clean) * 0.4,
      sustain: 0,
      release: 0.05 + (1 - clean) * 0.15,
    },
  },
  noise: {
    volume: -30 + (1 - tight) * 15,
  },
});

const resolveKickCharacterDefaults = (
  characterId: string
): KickDesignerState => {
  for (const pack of packs) {
    const definition = pack.instruments?.kick;
    if (!definition) continue;
    const character = definition.characters.find((c) => c.id === characterId);
    if (character) {
      return normalizeKickDesignerState(character.defaults);
    }
  }
  return DEFAULT_KICK_STATE;
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
  setMacroState: (state: Partial<KickDesignerState>) => void;
  getMacroState: () => KickDesignerState;
};

export const createKick = (characterId: string): KickDesignerInstrument => {
  const baseState = resolveKickCharacterDefaults(characterId);
  let currentState = baseState;

  const output = new Tone.Gain(1) as KickDesignerInstrument;
  const sub = new Tone.MembraneSynth();
  sub.connect(output);

  let noiseNodes: KickNoiseNodes | null = null;

  const ensureNoiseNodes = (): KickNoiseNodes => {
    if (noiseNodes) return noiseNodes;
    const synth = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 },
    });
    const gain = new Tone.Gain(0);
    synth.connect(gain);
    gain.connect(output);
    noiseNodes = { synth, gain };
    return noiseNodes;
  };

  const applyState = (state: KickDesignerState) => {
    currentState = { ...state };
    const params = mapKickParams(currentState);

    sub.set({
      pitchDecay: params.sub.pitchDecay,
      octaves: params.sub.octaves,
      envelope: params.sub.envelope,
    });

    if (params.noise.volume > -30) {
      const { gain } = ensureNoiseNodes();
      gain.gain.rampTo(Tone.dbToGain(params.noise.volume), 0.02);
    } else if (noiseNodes) {
      noiseNodes.gain.gain.rampTo(0, 0.02);
    }
  };

  applyState(baseState);

  output.triggerAttackRelease = (
    note = "C1",
    duration: Tone.Unit.Time = "8n",
    time?: Tone.Unit.Time,
    velocity = 1
  ) => {
    const when = time ?? Tone.now();
    sub.triggerAttackRelease(note, duration, when, velocity);
    if (noiseNodes) {
      noiseNodes.synth.triggerAttackRelease(duration, when, velocity);
    }
  };

  output.setMacroState = (state) => {
    const merged = mergeKickDesignerState(baseState, state);
    applyState(merged);
  };

  output.getMacroState = () => ({ ...currentState });

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
};

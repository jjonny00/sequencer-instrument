import * as Tone from "tone";

import { packs, type InstrumentCharacter } from "@/packs";
import {
  DEFAULT_KICK_STATE,
  normalizeKickDesignerState,
  type KickDesignerState,
} from "./kickDesigner";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

interface EnvelopeParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface KickParams {
  body: {
    gain: number;
    pitchDecay: number;
    octaves: number;
    envelope: EnvelopeParams;
    filterFrequency: number;
  };
  transient: {
    gain: number;
    envelope: EnvelopeParams;
    filterFrequency: number;
  } | null;
  saturation: {
    distortion: number;
    wet: number;
  };
  eq: {
    low: number;
    mid: number;
    high: number;
  };
  outputGain: number;
}

export const mapKickParams = (state: KickDesignerState): KickParams => {
  const punch = clamp(state.punch, 0, 1);
  const clean = clamp(state.clean, 0, 1);
  const tight = clamp(state.tight, 0, 1);

  const transientLevel = 0.75 * Math.sqrt(1 - punch);
  const bodyLevel = 0.8 + (1 - punch) * 0.15;

  const transientDecay = 0.01 + (1 - tight) * 0.02;
  const bodyDecay = 0.18 + tight * 0.45;
  const bodyRelease = 0.12 + tight * 0.4;
  const bodyPitchDecay = 0.018 + (1 - tight) * 0.05;
  const bodyOctaves = 3.5 + (1 - tight) * 1.5;
  const bodyFilterFrequency = 3500 + punch * 1500;
  const transientFilterFrequency = 1800 + (1 - punch) * 1800 + (1 - tight) * 600;

  const saturationDistortion = 0.08 + (1 - clean) * 0.75;
  const saturationWet = 0.1 + (1 - clean) * 0.85;

  const eqHigh = (1 - punch) * 5 - 2;
  const eqMid = -1 - (1 - clean) * 2 + (0.5 - punch) * 1.2;
  const eqLow = punch * 6 - 1.5;

  const outputGain = 0.85 + (1 - clean) * 0.12;

  return {
    body: {
      gain: bodyLevel,
      pitchDecay: bodyPitchDecay,
      octaves: bodyOctaves,
      envelope: {
        attack: 0.001,
        decay: bodyDecay,
        sustain: 0.01,
        release: bodyRelease,
      },
      filterFrequency: bodyFilterFrequency,
    },
    transient:
      transientLevel > 0.001
        ? {
            gain: transientLevel,
            envelope: {
              attack: 0,
              decay: transientDecay,
              sustain: 0,
              release: 0.015 + (1 - tight) * 0.02,
            },
            filterFrequency: transientFilterFrequency,
          }
        : null,
    saturation: {
      distortion: saturationDistortion,
      wet: saturationWet,
    },
    eq: {
      low: eqLow,
      mid: eqMid,
      high: eqHigh,
    },
    outputGain,
  };
};

function resolveKickCharacter(
  packId: string,
  characterId: string
): InstrumentCharacter | null {
  const pack = packs.find((candidate) => candidate.id === packId);
  if (!pack) {
    console.warn("[kick] pack not found", packId);
    return null;
  }

  const instrument = pack.instruments["kick"];
  if (!instrument) {
    console.warn("[kick] kick instrument not found in pack", packId);
    return null;
  }

  let character = instrument.characters.find((candidate) => candidate.id === characterId);
  if (!character && instrument.defaultCharacterId) {
    character = instrument.characters.find(
      (candidate) => candidate.id === instrument.defaultCharacterId
    );
  }
  if (!character) {
    character = instrument.characters[0];
  }
  if (!character) {
    console.warn("[kick] no kick characters available", packId);
    return null;
  }

  return character;
}

export interface KickInstrument {
  output: Tone.Gain;
  triggerAttackRelease: (
    note?: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => void;
  dispose: () => void;
}

export const createKick = (
  packId: string,
  characterId: string
): KickInstrument => {
  const character = resolveKickCharacter(packId, characterId);
  const state = character
    ? normalizeKickDesignerState(character.defaults)
    : DEFAULT_KICK_STATE;

  if (character) {
    console.info("[kick] using", {
      packId,
      characterId: character.id,
      defaults: character.defaults,
    });
  }

  const params = mapKickParams(state);

  const body = new Tone.MembraneSynth({
    pitchDecay: params.body.pitchDecay,
    octaves: params.body.octaves,
    envelope: params.body.envelope,
  });
  const bodyFilter = new Tone.Filter({
    type: "lowpass",
    frequency: params.body.filterFrequency,
    rolloff: -24,
  });
  const bodyGain = new Tone.Gain(params.body.gain);
  body.connect(bodyFilter);
  bodyFilter.connect(bodyGain);

  const mix = new Tone.Gain(1);
  bodyGain.connect(mix);

  let transientNodes: {
    synth: Tone.NoiseSynth;
    filter: Tone.Filter;
    gain: Tone.Gain;
  } | null = null;

  if (params.transient) {
    const transient = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: params.transient.envelope,
    });
    const transientFilter = new Tone.Filter({
      type: "highpass",
      frequency: params.transient.filterFrequency,
      rolloff: -24,
    });
    const transientGain = new Tone.Gain(params.transient.gain);
    transient.connect(transientFilter);
    transientFilter.connect(transientGain);
    transientGain.connect(mix);
    transientNodes = {
      synth: transient,
      filter: transientFilter,
      gain: transientGain,
    };
  }

  const saturation = new Tone.Distortion({
    distortion: params.saturation.distortion,
    oversample: "4x",
    wet: params.saturation.wet,
  });
  const eq = new Tone.EQ3({
    low: params.eq.low,
    mid: params.eq.mid,
    high: params.eq.high,
  });
  const compressor = new Tone.Compressor({
    threshold: -20,
    ratio: 3,
    attack: 0.01,
    release: 0.25,
  });
  const limiter = new Tone.Limiter({ threshold: -6 });
  const output = new Tone.Gain(params.outputGain);

  mix.connect(saturation);
  saturation.connect(eq);
  eq.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(output);

  const triggerAttackRelease = (
    note: Tone.Unit.Frequency = "C2",
    duration: Tone.Unit.Time = "8n",
    time?: Tone.Unit.Time,
    velocity = 1
  ) => {
    const when = time ?? Tone.now();
    body.triggerAttackRelease(note, duration, when, velocity);
    transientNodes?.synth.triggerAttackRelease("32n", when, velocity);
  };

  const dispose = () => {
    body.dispose();
    bodyFilter.dispose();
    bodyGain.dispose();
    transientNodes?.synth.dispose();
    transientNodes?.filter.dispose();
    transientNodes?.gain.dispose();
    mix.dispose();
    saturation.dispose();
    eq.dispose();
    compressor.dispose();
    limiter.dispose();
    output.dispose();
  };

  return {
    output,
    triggerAttackRelease,
    dispose,
  };
};

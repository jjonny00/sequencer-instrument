import * as Tone from "tone";

import { packs } from "@/soundpacks";
import {
  DEFAULT_KICK_STATE,
  normalizeKickDesignerState,
  type KickDesignerState,
} from "./kickState";

export interface KickInstrument {
  triggerAttackRelease: (
    note: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => void;
  setStyle: (style: KickDesignerState) => void;
  dispose: () => void;
}

export function createKick(packId: string, characterId: string): KickInstrument {
  const pack = packs[packId];
  if (!pack) {
    console.warn("[kick] pack not found", { packId, characterId });
    return buildKickInstrument(DEFAULT_KICK_STATE);
  }

  const instrument = pack.instruments?.kick;
  if (!instrument) {
    console.warn("[kick] kick instrument missing", { packId, characterId });
    return buildKickInstrument(DEFAULT_KICK_STATE);
  }

  let character = instrument.characters.find((candidate) => candidate.id === characterId);

  if (!character && instrument.defaultCharacterId) {
    character = instrument.characters.find(
      (candidate) => candidate.id === instrument.defaultCharacterId
    );
  }

  if (!character) {
    console.warn("[kick] could not resolve character", { packId, characterId });
    return buildKickInstrument(DEFAULT_KICK_STATE);
  }

  const defaults = normalizeKickDesignerState(
    character.defaults ?? DEFAULT_KICK_STATE
  );

  return buildKickInstrument(defaults);
}

const NOISE_DISABLE_THRESHOLD_DB = -30;

interface KickSynthesisParams {
  sub: {
    pitchDecay: number;
    octaves: number;
    decay: number;
    release: number;
    oscillator: { type: "sine" };
  };
  noiseDb: number;
}

function buildKickInstrument(initialStyle: KickDesignerState): KickInstrument {
  let currentStyle = normalizeKickDesignerState(initialStyle);
  let currentParams = mapKickParams(currentStyle);

  const output = new Tone.Gain(0.9).toDestination();

  const sub = new Tone.MembraneSynth({
    pitchDecay: currentParams.sub.pitchDecay,
    octaves: currentParams.sub.octaves,
    oscillator: currentParams.sub.oscillator,
    envelope: {
      attack: 0.005,
      decay: currentParams.sub.decay,
      sustain: 0,
      release: currentParams.sub.release,
    },
  }).connect(output);

  type NoiseNodes = {
    synth: Tone.NoiseSynth;
    gain: Tone.Gain;
  };

  let noise: NoiseNodes | null = null;

  const ensureNoise = () => {
    if (noise) return noise;
    const synth = new Tone.NoiseSynth({
      envelope: {
        attack: 0.001,
        decay: 0.02,
        sustain: 0,
        release: 0.01,
      },
    });
    const gain = new Tone.Gain({
      gain: Tone.dbToGain(currentParams.noiseDb),
    });
    synth.connect(gain);
    gain.connect(output);
    noise = { synth, gain };
    return noise;
  };

  const disposeNoise = () => {
    if (!noise) return;
    noise.synth.dispose();
    noise.gain.dispose();
    noise = null;
  };

  const applyParams = (params: KickSynthesisParams) => {
    currentParams = params;
    sub.set({
      pitchDecay: params.sub.pitchDecay,
      octaves: params.sub.octaves,
      envelope: {
        attack: 0.005,
        decay: params.sub.decay,
        sustain: 0,
        release: params.sub.release,
      },
      oscillator: params.sub.oscillator,
    });

    if (params.noiseDb <= NOISE_DISABLE_THRESHOLD_DB) {
      disposeNoise();
      return;
    }

    const nodes = ensureNoise();
    nodes.gain.gain.value = Tone.dbToGain(params.noiseDb);
  };

  applyParams(currentParams);

  return {
    triggerAttackRelease(_note, duration, time, velocity) {
      const resolvedDuration = duration ?? "8n";
      const resolvedVelocity = velocity ?? 0.9;

      sub.oscillator.phase = 0;
      sub.triggerAttackRelease("C1", resolvedDuration, time, resolvedVelocity);

      if (currentParams.noiseDb > NOISE_DISABLE_THRESHOLD_DB) {
        const nodes = ensureNoise();
        nodes.synth.triggerAttackRelease("8n", time, resolvedVelocity);
      }
    },
    setStyle(style) {
      currentStyle = normalizeKickDesignerState(style);
      applyParams(mapKickParams(currentStyle));
    },
    dispose() {
      sub.dispose();
      disposeNoise();
      output.dispose();
    },
  };
}

function mapKickParams({ punch, clean, tight }: KickDesignerState): KickSynthesisParams {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const p = clamp(punch);
  const c = clamp(clean);
  const t = clamp(tight);

  return {
    sub: {
      pitchDecay: 0.01 + p * 0.02,
      octaves: 2 + Math.round(p * 2),
      decay: 0.25 + (1 - c) * 0.25,
      release: 0.05 + (1 - c) * 0.1,
      oscillator: { type: "sine" as const },
    },
    noiseDb: -30 + (1 - t) * 10,
  };
}

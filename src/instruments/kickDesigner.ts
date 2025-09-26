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

interface KickSynthesisParams {
  sub: {
    pitchDecay: number;
    octaves: number;
    decay: number;
    release: number;
    gain: number;
  };
  body: {
    pitchDecay: number;
    octaves: number;
    decay: number;
    release: number;
    gain: number;
  };
  click: {
    decay: number;
    release: number;
    gain: number;
    highpassFrequency: number;
  };
  distortion: {
    amount: number;
    wet: number;
  };
  filter: {
    frequency: number;
    q: number;
  };
}

function buildKickInstrument(initialStyle: KickDesignerState): KickInstrument {
  let currentStyle = normalizeKickDesignerState(initialStyle);
  let currentParams = mapKickParams(currentStyle);

  const output = new Tone.Gain(0.9).toDestination();

  const mix = new Tone.Gain(1);
  const distortion = new Tone.Distortion({
    distortion: currentParams.distortion.amount,
    wet: currentParams.distortion.wet,
  });
  const filter = new Tone.Filter({
    type: "lowpass",
    frequency: currentParams.filter.frequency,
    Q: currentParams.filter.q,
  });

  mix.connect(distortion);
  distortion.connect(filter);
  filter.connect(output);

  const subGain = new Tone.Gain(currentParams.sub.gain).connect(mix);
  const sub = new Tone.MembraneSynth({
    pitchDecay: currentParams.sub.pitchDecay,
    octaves: currentParams.sub.octaves,
    oscillator: { type: "sine" },
    envelope: {
      attack: 0.005,
      decay: currentParams.sub.decay,
      sustain: 0,
      release: currentParams.sub.release,
    },
  }).connect(subGain);

  const bodyGain = new Tone.Gain(currentParams.body.gain).connect(mix);
  const body = new Tone.MembraneSynth({
    pitchDecay: currentParams.body.pitchDecay,
    octaves: currentParams.body.octaves,
    oscillator: { type: "sine" },
    envelope: {
      attack: 0.004,
      decay: currentParams.body.decay,
      sustain: 0,
      release: currentParams.body.release,
    },
  }).connect(bodyGain);

  const clickGain = new Tone.Gain(currentParams.click.gain).connect(mix);
  const clickFilter = new Tone.Filter({
    type: "highpass",
    frequency: currentParams.click.highpassFrequency,
    Q: 0.9,
  }).connect(clickGain);
  const click = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: {
      attack: 0.001,
      decay: currentParams.click.decay,
      sustain: 0,
      release: currentParams.click.release,
    },
  }).connect(clickFilter);

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
    });
    subGain.gain.rampTo(params.sub.gain, 0.02);

    body.set({
      pitchDecay: params.body.pitchDecay,
      octaves: params.body.octaves,
      envelope: {
        attack: 0.004,
        decay: params.body.decay,
        sustain: 0,
        release: params.body.release,
      },
    });
    bodyGain.gain.rampTo(params.body.gain, 0.02);

    click.set({
      envelope: {
        attack: 0.001,
        decay: params.click.decay,
        sustain: 0,
        release: params.click.release,
      },
    });
    clickGain.gain.rampTo(params.click.gain, 0.02);
    clickFilter.frequency.rampTo(params.click.highpassFrequency, 0.02);

    distortion.distortion = params.distortion.amount;
    distortion.wet.value = params.distortion.wet;
    filter.frequency.rampTo(params.filter.frequency, 0.02);
    filter.Q.rampTo(params.filter.q, 0.02);
  };

  applyParams(currentParams);

  return {
    triggerAttackRelease(_note, duration, time, velocity) {
      const resolvedDuration = duration ?? "8n";
      const resolvedVelocity = velocity ?? 0.9;

      sub.oscillator.phase = 0;
      body.oscillator.phase = 0;

      sub.triggerAttackRelease("C1", resolvedDuration, time, resolvedVelocity);
      body.triggerAttackRelease("C2", resolvedDuration, time, Math.min(1, resolvedVelocity * 0.9));

      if (currentParams.click.gain > 0.001) {
        click.triggerAttackRelease("16n", time, Math.min(1, resolvedVelocity * 0.8));
      }
    },
    setStyle(style) {
      currentStyle = normalizeKickDesignerState(style);
      applyParams(mapKickParams(currentStyle));
    },
    dispose() {
      sub.dispose();
      subGain.dispose();
      body.dispose();
      bodyGain.dispose();
      click.dispose();
      clickFilter.dispose();
      clickGain.dispose();
      mix.dispose();
      distortion.dispose();
      filter.dispose();
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
      pitchDecay: 0.015 + p * 0.035,
      octaves: 3 + p * 2,
      decay: 0.35 + (1 - c) * 0.35,
      release: 0.1 + (1 - c) * 0.35,
      gain: 0.6 + p * 0.35,
    },
    body: {
      pitchDecay: 0.006 + p * 0.01,
      octaves: 1.5 + p * 1.2,
      decay: 0.12 + (1 - t) * 0.18,
      release: 0.08 + (1 - t) * 0.12,
      gain: 0.25 + (1 - c) * 0.35,
    },
    click: {
      decay: 0.01 + (1 - t) * 0.03,
      release: 0.01 + (1 - t) * 0.05,
      gain: 0.05 + (1 - t) * 0.45,
      highpassFrequency: 2000 + t * 2500,
    },
    distortion: {
      amount: 0.15 + (1 - c) * 0.45,
      wet: 0.05 + (1 - c) * 0.55,
    },
    filter: {
      frequency: 180 + c * 420,
      q: 0.9 + (1 - c) * 0.6,
    },
  };
}

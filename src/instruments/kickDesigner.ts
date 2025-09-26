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

const CLICK_DISABLE_THRESHOLD_DB = -55;

interface KickSynthesisParams {
  sub: {
    pitchDecay: number;
    octaves: number;
    attack: number;
    decay: number;
    release: number;
    filterFrequency: number;
    filterQ: number;
    outputDb: number;
    oscillator: { type: "sine" };
  };
  click: {
    gainDb: number;
    decay: number;
    filterFrequency: number;
  };
}

function buildKickInstrument(initialStyle: KickDesignerState): KickInstrument {
  let currentStyle = normalizeKickDesignerState(initialStyle);
  let currentParams = mapKickParams(currentStyle);

  const output = new Tone.Gain({
    gain: Tone.dbToGain(currentParams.sub.outputDb),
  }).toDestination();

  const subFilter = new Tone.Filter({
    type: "lowpass",
    frequency: currentParams.sub.filterFrequency,
    Q: currentParams.sub.filterQ,
    rolloff: -24,
  }).connect(output);

  const sub = new Tone.MembraneSynth({
    pitchDecay: currentParams.sub.pitchDecay,
    octaves: currentParams.sub.octaves,
    oscillator: currentParams.sub.oscillator,
    envelope: {
      attack: currentParams.sub.attack,
      decay: currentParams.sub.decay,
      sustain: 0,
      release: currentParams.sub.release,
    },
  }).connect(subFilter);

  type ClickNodes = {
    synth: Tone.NoiseSynth;
    filter: Tone.Filter;
    gain: Tone.Gain;
  };

  let click: ClickNodes | null = null;

  const ensureClick = () => {
    if (click) return;
    const noise = new Tone.NoiseSynth({
      envelope: {
        attack: 0.001,
        decay: currentParams.click.decay,
        sustain: 0,
        release: 0.02,
      },
    });
    const filter = new Tone.Filter({
      type: "highpass",
      frequency: currentParams.click.filterFrequency,
      rolloff: -24,
    });
    const gain = new Tone.Gain({
      gain: Tone.dbToGain(currentParams.click.gainDb),
    });
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    click = { synth: noise, filter, gain };
  };

  const disposeClick = () => {
    if (!click) return;
    click.synth.dispose();
    click.filter.dispose();
    click.gain.dispose();
    click = null;
  };

  const applyParams = (params: KickSynthesisParams) => {
    currentParams = params;
    output.gain.value = Tone.dbToGain(params.sub.outputDb);
    sub.octaves = params.sub.octaves;
    sub.pitchDecay = params.sub.pitchDecay;
    sub.envelope.attack = params.sub.attack;
    sub.envelope.decay = params.sub.decay;
    sub.envelope.release = params.sub.release;
    subFilter.frequency.value = params.sub.filterFrequency;
    subFilter.Q.value = params.sub.filterQ;

    if (params.click.gainDb <= CLICK_DISABLE_THRESHOLD_DB) {
      disposeClick();
      return;
    }

    ensureClick();
    if (!click) return;
    click.gain.gain.value = Tone.dbToGain(params.click.gainDb);
    click.filter.frequency.value = params.click.filterFrequency;
    click.synth.set({
      envelope: {
        attack: 0.001,
        decay: params.click.decay,
        sustain: 0,
        release: 0.02,
      },
    });
  };

  applyParams(currentParams);

  return {
    triggerAttackRelease(_note, duration, time, velocity) {
      const resolvedDuration = duration ?? "8n";
      const resolvedVelocity = velocity ?? 0.9;

      sub.oscillator.phase = 0;
      sub.triggerAttackRelease("C1", resolvedDuration, time, resolvedVelocity);

      if (click) {
        click.synth.triggerAttackRelease("8n", time, resolvedVelocity);
      }
    },
    setStyle(style) {
      currentStyle = normalizeKickDesignerState(style);
      applyParams(mapKickParams(currentStyle));
    },
    dispose() {
      sub.dispose();
      subFilter.dispose();
      disposeClick();
      output.dispose();
    },
  };
}

function mapKickParams({ punch, clean, tight }: KickDesignerState): KickSynthesisParams {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const p = clamp(punch);
  const c = clamp(clean);
  const t = clamp(tight);

  const pitchDecay = 0.006 + p * 0.07;
  const octaves = 1.5 + p * 3.5;
  const attack = 0.001 + (1 - p) * 0.004;
  const decay = 0.2 + (1 - c) * 0.5;
  const release = 0.05 + (1 - c) * 0.35;
  const filterFrequency = 90 + c * 160;
  const filterQ = 0.7 + (1 - c) * 2.3;
  const outputDb = -10 + p * 5 + c * 2;
  const clickGainDb = -46 + (1 - t) * 20 - (1 - c) * 4;
  const clickDecay = 0.012 + (1 - t) * 0.035;
  const clickFilterFrequency = 2500 + t * 4500;

  return {
    sub: {
      pitchDecay,
      octaves,
      attack,
      decay,
      release,
      filterFrequency,
      filterQ,
      outputDb,
      oscillator: { type: "sine" as const },
    },
    click: {
      gainDb: clickGainDb,
      decay: clickDecay,
      filterFrequency: clickFilterFrequency,
    },
  };
}

import * as Tone from "tone";

import type { Chunk } from "../chunks";

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

export const applyKickDefaultsToChunk = (
  chunk: Chunk,
  defaults: Partial<KickDesignerState> | null | undefined
): Chunk => {
  const state = mergeKickDesignerState(defaults, {
    punch: chunk.punch,
    clean: chunk.clean,
    tight: chunk.tight,
  });
  return {
    ...chunk,
    punch: state.punch,
    clean: state.clean,
    tight: state.tight,
  };
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

export const createKickDesigner = (
  initialState?: Partial<KickDesignerState>
): KickDesignerInstrument => {
  const state = normalizeKickDesignerState(initialState);

  const output = new Tone.Gain(1) as KickDesignerInstrument;

  const transient = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0, decay: 0.015, sustain: 0, release: 0.02 },
  });
  const transientFilter = new Tone.Filter({
    type: "highpass",
    frequency: 2000,
    rolloff: -24,
  });
  const transientGain = new Tone.Gain(0.5);

  const body = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.2 },
    volume: -4,
  });
  const bodyFilter = new Tone.Filter({ type: "lowpass", frequency: 5000, rolloff: -24 });
  const bodyGain = new Tone.Gain(0.75);

  const sub = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0, decay: 0.6, sustain: 0, release: 0.8 },
    volume: -2,
  });
  const subFilter = new Tone.Filter({ type: "lowpass", frequency: 180, rolloff: -24 });
  const subGain = new Tone.Gain(0.7);

  const mix = new Tone.Gain(1);
  const saturation = new Tone.Distortion({ distortion: 0.1, oversample: "4x", wet: 0.2 });
  const eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
  const compressor = new Tone.Compressor({
    threshold: -20,
    ratio: 3,
    attack: 0.01,
    release: 0.25,
  });
  const limiter = new Tone.Limiter({ threshold: -6 });
  const outputGain = new Tone.Gain(0.9);

  transient.connect(transientFilter);
  transientFilter.connect(transientGain);
  transientGain.connect(mix);

  body.connect(bodyFilter);
  bodyFilter.connect(bodyGain);
  bodyGain.connect(mix);

  sub.connect(subFilter);
  subFilter.connect(subGain);
  subGain.connect(mix);

  mix.connect(saturation);
  saturation.connect(eq);
  eq.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(outputGain);
  outputGain.connect(output);

  const applyState = () => {
    const punch = clamp(state.punch, 0, 1);
    const clean = clamp(state.clean, 0, 1);
    const tight = clamp(state.tight, 0, 1);

    const transientLevel = Math.sqrt(1 - punch);
    const subLevel = Math.sqrt(punch);
    const bodyLevel = 0.8 + (1 - punch) * 0.15;

    transientGain.gain.rampTo(0.75 * transientLevel, 0.05);
    subGain.gain.rampTo(1.1 * subLevel, 0.05);
    bodyGain.gain.rampTo(bodyLevel, 0.05);

    const transientDecay = 0.01 + (1 - tight) * 0.02;
    transient.set({
      envelope: { attack: 0, decay: transientDecay, sustain: 0, release: 0.015 + (1 - tight) * 0.02 },
    });
    transientFilter.frequency.rampTo(1800 + (1 - punch) * 1800 + (1 - tight) * 600, 0.05);

    const bodyDecay = 0.18 + tight * 0.45;
    const bodyRelease = 0.12 + tight * 0.4;
    const bodyPitchDecay = 0.018 + (1 - tight) * 0.05;
    const bodyOctaves = 3.5 + (1 - tight) * 1.5;
    body.set({
      pitchDecay: bodyPitchDecay,
      octaves: bodyOctaves,
      envelope: { attack: 0.001, decay: bodyDecay, sustain: 0.01, release: bodyRelease },
    });
    bodyFilter.frequency.rampTo(3500 + punch * 1500, 0.05);

    const subDecay = 0.35 + tight * 0.8;
    const subRelease = 0.45 + tight * 1.1;
    sub.set({
      envelope: { attack: 0, decay: subDecay, sustain: 0, release: subRelease },
    });
    subFilter.frequency.rampTo(120 + tight * 80 + punch * 30, 0.05);

    saturation.distortion = 0.08 + (1 - clean) * 0.75;
    saturation.wet.value = 0.1 + (1 - clean) * 0.85;

    eq.high.value = (1 - punch) * 5 - 2;
    eq.mid.value = -1 - (1 - clean) * 2 + (0.5 - punch) * 1.2;
    eq.low.value = punch * 6 - 1.5;

    outputGain.gain.rampTo(0.85 + (1 - clean) * 0.12, 0.05);
  };

  applyState();

  output.setMacroState = (partial) => {
    const next = normalizeKickDesignerState({
      punch: partial.punch ?? state.punch,
      clean: partial.clean ?? state.clean,
      tight: partial.tight ?? state.tight,
    });
    state.punch = next.punch;
    state.clean = next.clean;
    state.tight = next.tight;
    applyState();
  };

  output.getMacroState = () => ({ ...state });

  output.triggerAttackRelease = (
    note = "C2",
    duration: Tone.Unit.Time = "8n",
    time?: Tone.Unit.Time,
    velocity = 1
  ) => {
    const when = time ?? Tone.now();
    const tight = state.tight;
    const punch = state.punch;

    const baseNote = typeof note === "number" ? note : note || "C2";
    const baseFrequency = Tone.Frequency(baseNote).toFrequency();

    const transientVelocity = Math.min(1, velocity * (0.85 + (1 - punch) * 0.3));
    transient.triggerAttackRelease("32n", when, transientVelocity);

    const bodyDuration = Math.max(0.15, 0.35 + tight * 0.4);
    const bodyStart = baseFrequency * (1 + (1 - tight) * 1.4);
    body.frequency.setValueAtTime(bodyStart, when);
    body.frequency.exponentialRampToValueAtTime(
      Math.max(30, baseFrequency),
      when + 0.08 + (1 - tight) * 0.05
    );
    body.triggerAttackRelease(baseNote, bodyDuration, when, Math.min(1, velocity * 0.95));

    const subNote = Tone.Frequency(baseNote).transpose(-12 + punch * -2).toNote();
    const subDuration = Math.max(0.4, 0.6 + tight * 1.2);
    sub.frequency.setValueAtTime(baseFrequency * 0.5, when);
    sub.frequency.exponentialRampToValueAtTime(
      Math.max(20, baseFrequency * 0.5),
      when + 0.12 + tight * 0.2
    );
    sub.triggerAttackRelease(subNote, subDuration, when, Math.min(1, velocity * (0.7 + punch * 0.4)));

    const releaseTime = Tone.Time(duration).toSeconds();
    const totalRelease = when + releaseTime;
    mix.gain.cancelAndHoldAtTime(totalRelease);
    mix.gain.rampTo(0, 0.2, totalRelease);
    mix.gain.rampTo(1, 0.001, when);
  };

  const originalDispose = output.dispose.bind(output);
  output.dispose = () => {
    transient.dispose();
    transientFilter.dispose();
    transientGain.dispose();
    body.dispose();
    bodyFilter.dispose();
    bodyGain.dispose();
    sub.dispose();
    subFilter.dispose();
    subGain.dispose();
    mix.dispose();
    saturation.dispose();
    eq.dispose();
    compressor.dispose();
    limiter.dispose();
    outputGain.dispose();
    return originalDispose();
  };

  return output;
};


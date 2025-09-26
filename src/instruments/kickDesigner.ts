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

export interface KickSubStyleConfig {
  pitchDecay?: number;
  octaves?: number;
  oscillator?: Partial<Tone.MembraneSynthOptions["oscillator"]>;
  envelope?: Partial<Tone.MembraneSynthOptions["envelope"]>;
  filter?: Partial<Tone.FilterOptions>;
  gain?: number;
}

export interface KickNoiseStyleConfig {
  type?: Tone.NoiseSynthOptions["noise"]["type"];
  envelope?: Partial<Tone.NoiseSynthOptions["envelope"]>;
  filter?: Partial<Tone.FilterOptions>;
  gain?: number;
}

export interface KickDesignerStyleConfig {
  sub?: KickSubStyleConfig;
  noise?: KickNoiseStyleConfig;
}

export type KickDesignerInstrument = Tone.Gain & {
  triggerAttackRelease: (
    note?: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => void;
  setMacroState: (state: Partial<KickDesignerState>) => void;
  getMacroState: () => KickDesignerState;
  setStyle: (style?: KickDesignerStyleConfig | null) => void;
  getStyle: () => { sub: Required<KickSubStyleConfig>; noise: Required<KickNoiseStyleConfig> };
};

export const createKickDesigner = (
  initialState?: Partial<KickDesignerState>,
  initialStyle?: KickDesignerStyleConfig | null
): KickDesignerInstrument => {
  const state = normalizeKickDesignerState(initialState);

  const kickOut = new Tone.Gain(1) as KickDesignerInstrument;

  const kickSub = new Tone.MembraneSynth();
  const toneFilter = new Tone.Filter();
  const subGain = new Tone.Gain(1);

  const kickClick = new Tone.NoiseSynth();
  const noiseFilter = new Tone.Filter();
  const clickGain = new Tone.Gain(0.1);

  kickSub.connect(toneFilter);
  toneFilter.connect(subGain);
  subGain.connect(kickOut);

  kickClick.connect(noiseFilter);
  noiseFilter.connect(clickGain);
  clickGain.connect(kickOut);

  const defaultSubStyle: Required<KickSubStyleConfig> = {
    pitchDecay: 0.05,
    octaves: 6,
    oscillator: { type: "sine" },
    envelope: {
      attack: 0.005,
      decay: 0.3,
      sustain: 0,
      release: 0.1,
    },
    filter: { type: "lowpass", frequency: 4500, rolloff: -12, Q: 0.8 },
    gain: 1,
  };

  const defaultNoiseStyle: Required<KickNoiseStyleConfig> = {
    type: "white",
    envelope: {
      attack: 0.001,
      decay: 0.02,
      sustain: 0,
      release: 0.01,
    },
    filter: { type: "highpass", frequency: 9000, rolloff: -12, Q: 0.7 },
    gain: 0.12,
  };

  const resolveSubStyle = (
    overrides?: KickSubStyleConfig | null
  ): Required<KickSubStyleConfig> => ({
    pitchDecay: overrides?.pitchDecay ?? defaultSubStyle.pitchDecay,
    octaves: overrides?.octaves ?? defaultSubStyle.octaves,
    oscillator: {
      ...defaultSubStyle.oscillator,
      ...(overrides?.oscillator ?? {}),
    },
    envelope: {
      ...defaultSubStyle.envelope,
      ...(overrides?.envelope ?? {}),
    },
    filter: {
      ...defaultSubStyle.filter,
      ...(overrides?.filter ?? {}),
    },
    gain: overrides?.gain ?? defaultSubStyle.gain,
  });

  const resolveNoiseStyle = (
    overrides?: KickNoiseStyleConfig | null
  ): Required<KickNoiseStyleConfig> => ({
    type: overrides?.type ?? defaultNoiseStyle.type,
    envelope: {
      ...defaultNoiseStyle.envelope,
      ...(overrides?.envelope ?? {}),
    },
    filter: {
      ...defaultNoiseStyle.filter,
      ...(overrides?.filter ?? {}),
    },
    gain: overrides?.gain ?? defaultNoiseStyle.gain,
  });

  let style: KickDesignerStyleConfig = {
    sub: initialStyle?.sub ?? undefined,
    noise: initialStyle?.noise ?? undefined,
  };

  const applyState = () => {
    const punch = clamp(state.punch, 0, 1);
    const clean = clamp(state.clean, 0, 1);
    const tight = clamp(state.tight, 0, 1);

    const resolvedSub = resolveSubStyle(style.sub);
    const resolvedNoise = resolveNoiseStyle(style.noise);

    const pitchDecay =
      resolvedSub.pitchDecay * (0.7 + (1 - tight) * 0.65 + punch * 0.2);
    const octaves =
      resolvedSub.octaves + punch * 0.7 - (tight - 0.5) * 0.6;
    const envelopeDecay =
      (resolvedSub.envelope.decay ?? defaultSubStyle.envelope.decay) *
      (0.8 + (1 - tight) * 0.9 + (1 - clean) * 0.25);
    const envelopeRelease =
      (resolvedSub.envelope.release ?? defaultSubStyle.envelope.release) *
      (0.7 + (1 - tight) * 1.1 + (1 - clean) * 0.3);

    kickSub.pitchDecay = Math.max(0.005, pitchDecay);
    kickSub.octaves = Math.max(1, octaves);

    const oscillatorOptions = resolvedSub.oscillator;
    kickSub.oscillator.set(
      oscillatorOptions as Tone.MembraneSynthOptions["oscillator"]
    );
    kickSub.oscillator.phase = 0;

    kickSub.envelope.set({
      attack: resolvedSub.envelope.attack ?? defaultSubStyle.envelope.attack,
      decay: Math.max(0.02, envelopeDecay),
      sustain:
        resolvedSub.envelope.sustain ?? defaultSubStyle.envelope.sustain,
      release: Math.max(0.02, envelopeRelease),
    });

    toneFilter.set({
      type: resolvedSub.filter.type ?? "lowpass",
      Q: resolvedSub.filter.Q ?? defaultSubStyle.filter.Q,
      rolloff: resolvedSub.filter.rolloff ?? defaultSubStyle.filter.rolloff,
    });
    const fallbackFilterFrequency =
      defaultSubStyle.filter.frequency ?? 4500;
    const baseFilterFrequency =
      resolvedSub.filter.frequency ?? fallbackFilterFrequency;
    const filterFrequency =
      baseFilterFrequency *
      (0.65 + clean * 0.9 + punch * 0.15 - (1 - tight) * 0.2);
    toneFilter.frequency.rampTo(clamp(filterFrequency, 80, 20000), 0.05);

    const fallbackSubGain = defaultSubStyle.gain ?? 1;
    const subLevel =
      (resolvedSub.gain ?? fallbackSubGain) *
      (0.7 + (1 - clean) * 0.35 + (1 - punch) * 0.2);
    subGain.gain.rampTo(subLevel, 0.05);

    const noiseAttack =
      resolvedNoise.envelope.attack ?? defaultNoiseStyle.envelope.attack;
    const noiseDecay =
      (resolvedNoise.envelope.decay ?? defaultNoiseStyle.envelope.decay) *
      (0.6 + (1 - tight) * 1.1);
    const noiseRelease =
      (resolvedNoise.envelope.release ?? defaultNoiseStyle.envelope.release) *
      (0.7 + (1 - tight) * 0.8);

    kickClick.noise.set({
      type: resolvedNoise.type ?? defaultNoiseStyle.type,
    });

    kickClick.envelope.set({
      attack: noiseAttack,
      decay: Math.max(0.005, noiseDecay),
      sustain:
        resolvedNoise.envelope.sustain ?? defaultNoiseStyle.envelope.sustain,
      release: Math.max(0.005, noiseRelease),
    });

    noiseFilter.set({
      type: resolvedNoise.filter.type ?? defaultNoiseStyle.filter.type,
      Q: resolvedNoise.filter.Q ?? defaultNoiseStyle.filter.Q,
      rolloff: resolvedNoise.filter.rolloff ?? defaultNoiseStyle.filter.rolloff,
    });
    const fallbackNoiseFrequency =
      defaultNoiseStyle.filter.frequency ?? 8000;
    const baseNoiseFrequency =
      resolvedNoise.filter.frequency ?? fallbackNoiseFrequency;
    const noiseFrequency =
      baseNoiseFrequency *
      (0.7 + clean * 0.6 + punch * 0.25 - (1 - tight) * 0.25);
    noiseFilter.frequency.rampTo(clamp(noiseFrequency, 80, 20000), 0.02);

    const fallbackNoiseGain = defaultNoiseStyle.gain ?? 0.12;
    const clickLevel =
      (resolvedNoise.gain ?? fallbackNoiseGain) *
      (0.4 + punch * 0.6 - (1 - tight) * 0.3);
    clickGain.gain.rampTo(Math.max(0, clickLevel), 0.02);

    kickOut.gain.rampTo(0.9 + (1 - clean) * 0.08, 0.05);
  };

  applyState();

  kickOut.setStyle = (nextStyle) => {
    style = {
      sub: nextStyle?.sub ?? undefined,
      noise: nextStyle?.noise ?? undefined,
    };
    applyState();
  };

  kickOut.getStyle = () => ({
    sub: resolveSubStyle(style.sub),
    noise: resolveNoiseStyle(style.noise),
  });

  kickOut.setMacroState = (partial) => {
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

  kickOut.getMacroState = () => ({ ...state });

  kickOut.triggerAttackRelease = (
    note = "C2",
    duration: Tone.Unit.Time = "8n",
    time?: Tone.Unit.Time,
    velocity = 1
  ) => {
    const when = time ?? Tone.now();
    const tight = state.tight;
    const baseNote = typeof note === "number" ? note : note || "C2";

    kickSub.oscillator.phase = 0;
    if (typeof kickSub.oscillator.restart === "function") {
      kickSub.oscillator.restart(when);
    }

    const baseDuration = Math.max(0.2, 0.35 + (1 - tight) * 0.45);
    const requestedDuration = Tone.Time(duration).toSeconds();
    const memDuration = Math.max(baseDuration, requestedDuration);
    kickSub.triggerAttackRelease(baseNote, memDuration, when, velocity);

    if (clickGain.gain.value > 0.001) {
      kickClick.triggerAttackRelease("8n", when, Math.min(1, velocity * 1.1));
    }
  };

  const originalDispose = kickOut.dispose.bind(kickOut);
  kickOut.dispose = () => {
    kickSub.dispose();
    toneFilter.dispose();
    subGain.dispose();
    kickClick.dispose();
    noiseFilter.dispose();
    clickGain.dispose();
    return originalDispose();
  };

  return kickOut;
};


import * as Tone from "tone";

import type { Chunk } from "../chunks";

export interface KickDesignerState {
  punch: number;
  clean: number;
  tight: number;
}

export interface KickFilterStyle extends Partial<Tone.FilterOptions> {
  punchRange?: number;
  tightRange?: number;
}

export interface KickSubStyle {
  gain?: number;
  filter?: KickFilterStyle;
  pitchDecay?: number;
  octaves?: number;
  volume?: number;
}

export interface KickClickStyle {
  enabled?: boolean;
  gain?: number;
  filter?: KickFilterStyle;
  noise?: { type?: Tone.NoiseType };
  envelope?: Partial<Tone.EnvelopeOptions>;
}

export interface KickStyleParameters {
  sub?: KickSubStyle;
  click?: KickClickStyle;
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

interface KickFilterStyleState {
  type: Tone.FilterType;
  frequency: number;
  rolloff: Tone.FilterRollOff;
  Q: number;
  punchRange: number;
  tightRange: number;
}

interface KickStyleState {
  sub: {
    gain: number;
    filter: KickFilterStyleState;
    pitchDecay: number;
    octaves: number;
    volume: number;
  };
  click: {
    enabled: boolean;
    gain: number;
    filter: KickFilterStyleState;
    noise: { type: Tone.NoiseType };
    envelope: Tone.EnvelopeOptions;
  };
}

const DEFAULT_CLICK_ENVELOPE: Tone.EnvelopeOptions = {
  attack: 0.001,
  decay: 0.02,
  sustain: 0,
  release: 0.01,
};

const DEFAULT_STYLE: KickStyleState = {
  sub: {
    gain: 0.7,
    filter: {
      type: "lowpass",
      frequency: 120,
      rolloff: -24,
      Q: 1,
      punchRange: 30,
      tightRange: 80,
    },
    pitchDecay: 0.04,
    octaves: 4,
    volume: -2,
  },
  click: {
    enabled: true,
    gain: 0.5,
    filter: {
      type: "highpass",
      frequency: 1800,
      rolloff: -24,
      Q: 1,
      punchRange: 1800,
      tightRange: 600,
    },
    noise: { type: "white" },
    envelope: { ...DEFAULT_CLICK_ENVELOPE },
  },
};

const mergeFilterStyle = (
  base: KickFilterStyleState,
  overrides?: KickFilterStyle | null
): KickFilterStyleState => ({
  type: overrides?.type ?? base.type,
  frequency: overrides?.frequency ?? base.frequency,
  rolloff: overrides?.rolloff ?? base.rolloff,
  Q: overrides?.Q ?? base.Q,
  punchRange: overrides?.punchRange ?? base.punchRange,
  tightRange: overrides?.tightRange ?? base.tightRange,
});

const mergeStyleParameters = (
  overrides?: KickStyleParameters | null
): KickStyleState => ({
  sub: {
    gain: overrides?.sub?.gain ?? DEFAULT_STYLE.sub.gain,
    filter: mergeFilterStyle(DEFAULT_STYLE.sub.filter, overrides?.sub?.filter),
    pitchDecay: overrides?.sub?.pitchDecay ?? DEFAULT_STYLE.sub.pitchDecay,
    octaves: overrides?.sub?.octaves ?? DEFAULT_STYLE.sub.octaves,
    volume: overrides?.sub?.volume ?? DEFAULT_STYLE.sub.volume,
  },
  click: {
    enabled: overrides?.click?.enabled ?? DEFAULT_STYLE.click.enabled,
    gain: overrides?.click?.gain ?? DEFAULT_STYLE.click.gain,
    filter: mergeFilterStyle(DEFAULT_STYLE.click.filter, overrides?.click?.filter),
    noise: {
      type: overrides?.click?.noise?.type ?? DEFAULT_STYLE.click.noise.type,
    },
    envelope: {
      ...DEFAULT_CLICK_ENVELOPE,
      ...overrides?.click?.envelope,
    },
  },
});

export type KickDesignerInstrument = Tone.Gain & {
  triggerAttackRelease: (
    note?: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => void;
  setMacroState: (state: Partial<KickDesignerState>) => void;
  setStyle: (style?: KickStyleParameters | null) => void;
  getMacroState: () => KickDesignerState;
};

export const createKickDesigner = (
  initialState?: Partial<KickDesignerState>
): KickDesignerInstrument => {
  const state = normalizeKickDesignerState(initialState);

  let styleState = mergeStyleParameters();
  let styleSignature: string | null = null;

  const output = new Tone.Gain(1) as KickDesignerInstrument;

  const click = new Tone.NoiseSynth({
    noise: { type: styleState.click.noise.type },
    envelope: { ...styleState.click.envelope },
  });
  const clickFilter = new Tone.Filter({
    type: styleState.click.filter.type,
    frequency: styleState.click.filter.frequency,
    rolloff: styleState.click.filter.rolloff,
    Q: styleState.click.filter.Q,
  });
  const clickGain = new Tone.Gain(styleState.click.enabled ? styleState.click.gain : 0);

  const body = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0.01, release: 0.2 },
    volume: -4,
  });
  const bodyFilter = new Tone.Filter({ type: "lowpass", frequency: 5000, rolloff: -24 });
  const bodyGain = new Tone.Gain(0.75);

  const sub = new Tone.MembraneSynth({
    pitchDecay: styleState.sub.pitchDecay,
    octaves: styleState.sub.octaves,
    envelope: { attack: 0, decay: 0.6, sustain: 0, release: 0.8 },
    volume: styleState.sub.volume,
  });
  const subFilter = new Tone.Filter({
    type: styleState.sub.filter.type,
    frequency: styleState.sub.filter.frequency,
    rolloff: styleState.sub.filter.rolloff,
    Q: styleState.sub.filter.Q,
  });
  const subGain = new Tone.Gain(styleState.sub.gain);

  const subLayer = new Tone.Gain(1);

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

  click.connect(clickFilter);
  clickFilter.connect(clickGain);
  clickGain.connect(subLayer);

  sub.connect(subFilter);
  subFilter.connect(subGain);
  subGain.connect(subLayer);

  subLayer.connect(mix);

  body.connect(bodyFilter);
  bodyFilter.connect(bodyGain);
  bodyGain.connect(mix);

  mix.connect(saturation);
  saturation.connect(eq);
  eq.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(outputGain);
  outputGain.connect(output);

  const applyStyle = () => {
    click.set({
      noise: { type: styleState.click.noise.type },
      envelope: { ...styleState.click.envelope },
    });
    clickFilter.set({
      type: styleState.click.filter.type,
      frequency: styleState.click.filter.frequency,
      rolloff: styleState.click.filter.rolloff,
      Q: styleState.click.filter.Q,
    });
    sub.set({
      pitchDecay: styleState.sub.pitchDecay,
      octaves: styleState.sub.octaves,
      volume: styleState.sub.volume,
    });
    subFilter.set({
      type: styleState.sub.filter.type,
      frequency: styleState.sub.filter.frequency,
      rolloff: styleState.sub.filter.rolloff,
      Q: styleState.sub.filter.Q,
    });
  };

  const applyState = () => {
    const punch = clamp(state.punch, 0, 1);
    const clean = clamp(state.clean, 0, 1);
    const tight = clamp(state.tight, 0, 1);

    const clickLevel = Math.sqrt(1 - punch);
    const subLevel = Math.sqrt(punch);
    const bodyLevel = 0.8 + (1 - punch) * 0.15;

    const effectiveClickGain = styleState.click.enabled
      ? styleState.click.gain * 0.75 * clickLevel
      : 0;
    clickGain.gain.rampTo(effectiveClickGain, 0.05);
    subGain.gain.rampTo(styleState.sub.gain * 1.1 * subLevel, 0.05);
    bodyGain.gain.rampTo(bodyLevel, 0.05);

    const clickFrequency =
      styleState.click.filter.frequency +
      (1 - punch) * styleState.click.filter.punchRange +
      (1 - tight) * styleState.click.filter.tightRange;
    clickFilter.frequency.rampTo(Math.max(20, clickFrequency), 0.05);

    const subFrequency =
      styleState.sub.filter.frequency +
      tight * styleState.sub.filter.tightRange +
      punch * styleState.sub.filter.punchRange;
    subFilter.frequency.rampTo(Math.max(20, subFrequency), 0.05);

    const clickEnvelopeDecay =
      (styleState.click.envelope.decay ?? DEFAULT_CLICK_ENVELOPE.decay) +
      (1 - tight) * 0.01;
    const clickEnvelopeRelease =
      (styleState.click.envelope.release ?? DEFAULT_CLICK_ENVELOPE.release) +
      (1 - tight) * 0.01;
    click.set({
      envelope: {
        ...styleState.click.envelope,
        decay: Math.max(0.005, clickEnvelopeDecay),
        release: Math.max(0.005, clickEnvelopeRelease),
      },
    });

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
      envelope: {
        attack: 0,
        decay: subDecay,
        sustain: 0,
        release: subRelease,
      },
    });

    saturation.distortion = 0.08 + (1 - clean) * 0.75;
    saturation.wet.value = 0.1 + (1 - clean) * 0.85;

    eq.high.value = (1 - punch) * 5 - 2;
    eq.mid.value = -1 - (1 - clean) * 2 + (0.5 - punch) * 1.2;
    eq.low.value = punch * 6 - 1.5;

    outputGain.gain.rampTo(0.85 + (1 - clean) * 0.12, 0.05);
  };

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

  output.setStyle = (style) => {
    const signature = JSON.stringify(style ?? null);
    if (styleSignature === signature) {
      return;
    }
    styleSignature = signature;
    styleState = mergeStyleParameters(style);
    applyStyle();
    applyState();
  };

  output.getMacroState = () => ({ ...state });

  const resetOscillatorPhase = (synth: unknown) => {
    const oscillator = (synth as { oscillator?: { phase: number } } | undefined)?.oscillator;
    if (oscillator && typeof oscillator.phase === "number") {
      oscillator.phase = 0;
    }
  };

  output.triggerAttackRelease = (
    note = "C2",
    duration: Tone.Unit.Time = "8n",
    time?: Tone.Unit.Time,
    velocity = 1
  ) => {
    const when = time ?? Tone.now();
    const tight = state.tight;
    const punch = state.punch;
    const whenSeconds = Tone.Time(when).toSeconds();

    const baseNote = typeof note === "number" ? note : note || "C2";
    const baseFrequency = Tone.Frequency(baseNote).toFrequency();

    const clickVelocity = Math.min(1, velocity * (0.85 + (1 - punch) * 0.3));
    const clickGainAtTime = styleState.click.enabled
      ? clickGain.gain.getValueAtTime(whenSeconds)
      : 0;
    if (styleState.click.enabled && clickGainAtTime > 1e-3) {
      click.triggerAttackRelease("32n", when, clickVelocity);
    }

    resetOscillatorPhase(body);
    resetOscillatorPhase(sub);

    const bodyDuration = Math.max(0.15, 0.35 + tight * 0.4);
    const bodyStart = baseFrequency * (1 + (1 - tight) * 1.4);
    body.frequency.setValueAtTime(bodyStart, whenSeconds);
    body.frequency.exponentialRampToValueAtTime(
      Math.max(30, baseFrequency),
      whenSeconds + 0.08 + (1 - tight) * 0.05
    );
    body.triggerAttackRelease(baseNote, bodyDuration, when, Math.min(1, velocity * 0.95));

    const subNote = Tone.Frequency(baseNote).transpose(-12 + punch * -2).toNote();
    const subDuration = Math.max(0.4, 0.6 + tight * 1.2);
    sub.frequency.setValueAtTime(baseFrequency * 0.5, whenSeconds);
    sub.frequency.exponentialRampToValueAtTime(
      Math.max(20, baseFrequency * 0.5),
      whenSeconds + 0.12 + tight * 0.2
    );
    sub.triggerAttackRelease(
      subNote,
      subDuration,
      when,
      Math.min(1, velocity * (0.7 + punch * 0.4))
    );

    const releaseTime = Tone.Time(duration).toSeconds();
    const totalRelease = whenSeconds + releaseTime;
    mix.gain.cancelAndHoldAtTime(totalRelease);
    mix.gain.rampTo(0, 0.2, totalRelease);
    mix.gain.rampTo(1, 0.001, whenSeconds);
  };

  const originalDispose = output.dispose.bind(output);
  output.dispose = () => {
    click.dispose();
    clickFilter.dispose();
    clickGain.dispose();
    body.dispose();
    bodyFilter.dispose();
    bodyGain.dispose();
    sub.dispose();
    subFilter.dispose();
    subGain.dispose();
    subLayer.dispose();
    mix.dispose();
    saturation.dispose();
    eq.dispose();
    compressor.dispose();
    limiter.dispose();
    outputGain.dispose();
    return originalDispose();
  };

  output.setStyle(null);

  return output;
};


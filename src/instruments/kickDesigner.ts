import * as Tone from "tone";

import type { Chunk } from "../chunks";

export interface KickDesignerState {
  punch: number;
  clean: number;
  tight: number;
}

export interface KickStyleParameters {
  gain?: number;
  sub?: Partial<Tone.MembraneSynthOptions>;
  noise?: {
    enabled?: boolean;
    type?: Tone.NoiseType;
    volume?: number;
    envelope?: Partial<Tone.EnvelopeOptions>;
  };
}

type EnvelopeSettings = Omit<Tone.EnvelopeOptions, "context">;

interface KickSynthMapping {
  sub: Pick<
    Tone.MembraneSynthOptions,
    "pitchDecay" | "octaves" | "envelope" | "volume"
  >;
  noise: {
    type: Tone.NoiseType;
    envelope: EnvelopeSettings;
    volume: number;
  };
}

export const DEFAULT_KICK_STATE: KickDesignerState = {
  punch: 0.5,
  clean: 0.5,
  tight: 0.5,
};

const DEFAULT_NOISE_ENVELOPE: EnvelopeSettings = {
  attack: 0.001,
  decay: 0.02,
  sustain: 0,
  release: 0.01,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const MEMBRANE_DEFAULTS = Tone.MembraneSynth.getDefaults();
const NOISE_DEFAULTS = Tone.NoiseSynth.getDefaults();

const mergeEnvelope = (
  base: EnvelopeSettings,
  overrides?: Partial<EnvelopeSettings>
): EnvelopeSettings => ({
  attack: overrides?.attack ?? base.attack,
  decay: overrides?.decay ?? base.decay,
  sustain: overrides?.sustain ?? base.sustain,
  release: overrides?.release ?? base.release,
});

export const mapKickParams = ({
  punch,
  clean,
  tight,
}: KickDesignerState): KickSynthMapping => {
  const clampedPunch = clamp(punch, 0, 1);
  const clampedClean = clamp(clean, 0, 1);
  const clampedTight = clamp(tight, 0, 1);

  const subDecay = 0.2 + (1 - clampedClean) * 0.5;
  const subRelease = 0.1 + (1 - clampedClean) * 0.2;

  return {
    sub: {
      pitchDecay: 0.02 + clampedPunch * 0.1,
      octaves: 4 + Math.round(clampedPunch * 3),
      envelope: {
        attack: 0.005,
        decay: subDecay,
        sustain: 0,
        release: subRelease,
      },
      volume: -8 + clampedPunch * 6 - (1 - clampedClean) * 2,
    },
    noise: {
      type: "white",
      envelope: { ...DEFAULT_NOISE_ENVELOPE },
      volume: -30 + (1 - clampedTight) * 20,
    },
  };
};

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
  setStyle: (style?: KickStyleParameters | null) => void;
  getMacroState: () => KickDesignerState;
};

const MIN_NOISE_VOLUME = -30;

export const createKickDesigner = (
  initialState?: Partial<KickDesignerState>
): KickDesignerInstrument => {
  const state = normalizeKickDesignerState(initialState);

  const output = new Tone.Gain(1) as KickDesignerInstrument;
  const sharedGain = new Tone.Gain(1);
  sharedGain.connect(output);

  let style: KickStyleParameters | null = null;
  let styleSignature: string | null = null;
  let sub: Tone.MembraneSynth | null = null;
  let noise: Tone.NoiseSynth | null = null;
  let noiseEnabled = false;

  const disposeVoices = () => {
    if (sub) {
      sub.dispose();
      sub = null;
    }
    if (noise) {
      noise.dispose();
      noise = null;
    }
    noiseEnabled = false;
  };

  const applyState = () => {
    const mapping = mapKickParams(state);

    const mergedSubEnvelope = {
      ...MEMBRANE_DEFAULTS.envelope,
      ...mergeEnvelope(mapping.sub.envelope, style?.sub?.envelope),
    };
    const subOptions: Tone.MembraneSynthOptions = {
      ...MEMBRANE_DEFAULTS,
      ...mapping.sub,
      ...(style?.sub ?? {}),
      envelope: mergedSubEnvelope,
    };
    const { context: _subContext, ...subConfig } = subOptions;

    if (!sub) {
      sub = new Tone.MembraneSynth(subConfig);
      sub.connect(sharedGain);
    } else {
      sub.set(subConfig);
      if (typeof subOptions.volume === "number") {
        sub.volume.value = subOptions.volume;
      }
    }

    const noiseVolume =
      style?.noise?.volume !== undefined
        ? style.noise.volume
        : mapping.noise.volume;
    const resolvedNoiseEnvelope = mergeEnvelope(
      mapping.noise.envelope,
      style?.noise?.envelope
    );
    const mergedNoiseEnvelope = {
      ...NOISE_DEFAULTS.envelope,
      ...resolvedNoiseEnvelope,
    };
    const noiseType = style?.noise?.type ?? mapping.noise.type;
    const shouldEnableNoise =
      (style?.noise?.enabled ?? true) && noiseVolume > MIN_NOISE_VOLUME;

    if (shouldEnableNoise) {
      if (!noise) {
        const noiseOptions: Tone.NoiseSynthOptions = {
          ...NOISE_DEFAULTS,
          noise: { ...NOISE_DEFAULTS.noise, type: noiseType },
          envelope: mergedNoiseEnvelope,
          volume: noiseVolume,
        };
        const { context: _noiseContext, ...noiseConfig } = noiseOptions;
        noise = new Tone.NoiseSynth(noiseConfig);
        noise.connect(sharedGain);
      } else {
        noise.set({
          noise: { ...NOISE_DEFAULTS.noise, type: noiseType },
          envelope: mergedNoiseEnvelope,
        });
        noise.volume.value = noiseVolume;
      }
    } else if (noise) {
      noise.volume.value = -Infinity;
    }

    noiseEnabled = shouldEnableNoise && noise !== null;

    const targetGain = style?.gain ?? 1;
    sharedGain.gain.rampTo(targetGain, 0.02);
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

  output.setStyle = (nextStyle) => {
    const signature = JSON.stringify(nextStyle ?? null);
    if (styleSignature === signature) {
      return;
    }
    styleSignature = signature;
    style = nextStyle ?? null;
    disposeVoices();
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
    const mappedDuration = duration ?? "8n";

    if (sub) {
      resetOscillatorPhase(sub);
      sub.triggerAttackRelease(note, mappedDuration, when, velocity);
    }

    if (noiseEnabled && noise) {
      noise.triggerAttackRelease("32n", when, velocity);
    }
  };

  const originalDispose = output.dispose.bind(output);
  output.dispose = () => {
    disposeVoices();
    sharedGain.dispose();
    return originalDispose();
  };

  applyState();

  return output;
};

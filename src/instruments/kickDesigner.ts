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

  const kickOut = new Tone.Gain(1) as KickDesignerInstrument;

  const kickSub = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 6,
    oscillator: { type: "sine", phase: 0 },
    envelope: {
      attack: 0.005,
      decay: 0.3,
      sustain: 0,
      release: 0.1,
    },
  });
  const toneFilter = new Tone.Filter({ type: "lowpass", frequency: 4500, rolloff: -12 });
  const subGain = new Tone.Gain(1);

  const kickClick = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: {
      attack: 0.001,
      decay: 0.02,
      sustain: 0,
      release: 0.01,
    },
  });
  const clickGain = new Tone.Gain(0.1);

  kickSub.connect(toneFilter);
  toneFilter.connect(subGain);
  subGain.connect(kickOut);

  kickClick.connect(clickGain);
  clickGain.connect(kickOut);

  const applyState = () => {
    const punch = clamp(state.punch, 0, 1);
    const clean = clamp(state.clean, 0, 1);
    const tight = clamp(state.tight, 0, 1);

    const pitchDecay = 0.035 + (1 - tight) * 0.035 + punch * 0.01;
    const octaves = 5 + punch * 1.5 + (1 - tight) * 0.5;
    const envelopeDecay = 0.24 + (1 - tight) * 0.25 + (1 - clean) * 0.05;
    const envelopeRelease = 0.12 + (1 - tight) * 0.35 + (1 - clean) * 0.1;

    kickSub.set({
      pitchDecay,
      octaves,
      envelope: {
        attack: 0.005,
        decay: envelopeDecay,
        sustain: 0,
        release: envelopeRelease,
      },
    });

    const clickDecay = 0.01 + (1 - tight) * 0.02;
    kickClick.set({
      envelope: {
        attack: 0.001,
        decay: clickDecay,
        sustain: 0,
        release: 0.01 + (1 - tight) * 0.015,
      },
    });

    const clickLevel = 0.05 + punch * 0.35;
    clickGain.gain.rampTo(clickLevel, 0.05);

    const filterFrequency = 1500 + clean * 3200 - (1 - punch) * 200;
    toneFilter.frequency.rampTo(filterFrequency, 0.05);

    const subLevel = 0.8 + (1 - clean) * 0.15 + (1 - punch) * 0.1;
    subGain.gain.rampTo(subLevel, 0.05);

    kickOut.gain.rampTo(0.9 + (1 - clean) * 0.08, 0.05);
  };

  applyState();

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
    clickGain.dispose();
    return originalDispose();
  };

  return kickOut;
};


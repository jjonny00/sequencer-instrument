import * as Tone from "tone";

import {
  DEFAULT_PULSE_DEPTH,
  DEFAULT_PULSE_FILTER_ENABLED,
  DEFAULT_PULSE_FILTER_TYPE,
  DEFAULT_PULSE_MODE,
  DEFAULT_PULSE_PATTERN,
  DEFAULT_PULSE_PATTERN_LENGTH,
  DEFAULT_PULSE_RATE,
  DEFAULT_PULSE_RESONANCE,
  DEFAULT_PULSE_SHAPE,
  DEFAULT_PULSE_SWING,
  type PulseFilterType,
  type PulseMode,
  type PulseShape,
} from "../chunks";
import type { InstrumentCharacter } from "../packs";

export type { PulseFilterType, PulseMode, PulseShape };

const FILTER_MIN_FREQUENCY = 180;
const FILTER_MAX_FREQUENCY = 9500;
const RESONANCE_MIN_Q = 0.7;
const RESONANCE_MAX_Q = 14;
const GATE_RAMP = 0.02;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const normalizePattern = (pattern: number[] | undefined, length: number) => {
  if (!Array.isArray(pattern) || pattern.length === 0) {
    return Array.from({ length }, (_value, index) => (index % 2 === 0 ? 1 : 0));
  }
  if (pattern.length === length) {
    return pattern.map((value) => (value ? 1 : 0));
  }
  const normalized: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const ratio = pattern.length / length;
    const sourceIndex = Math.floor(i * ratio);
    normalized.push(pattern[sourceIndex] ? 1 : 0);
  }
  return normalized;
};

export interface PulseSettings {
  mode: PulseMode;
  rate: string;
  depth: number;
  shape: PulseShape;
  filterEnabled: boolean;
  filterType: PulseFilterType;
  resonance: number;
  pattern?: number[];
  patternLength?: number;
  swing?: number;
}

export const DEFAULT_PULSE_SETTINGS: PulseSettings = {
  mode: DEFAULT_PULSE_MODE,
  rate: DEFAULT_PULSE_RATE,
  depth: DEFAULT_PULSE_DEPTH,
  shape: DEFAULT_PULSE_SHAPE,
  filterEnabled: DEFAULT_PULSE_FILTER_ENABLED,
  filterType: DEFAULT_PULSE_FILTER_TYPE,
  resonance: DEFAULT_PULSE_RESONANCE,
  pattern: DEFAULT_PULSE_PATTERN,
  patternLength: DEFAULT_PULSE_PATTERN_LENGTH,
  swing: DEFAULT_PULSE_SWING,
};

type ToneLike = Pick<
  typeof Tone,
  | "PolySynth"
  | "Synth"
  | "AmplitudeEnvelope"
  | "Gain"
  | "Destination"
  | "Filter"
  | "LFO"
  | "Multiply"
  | "Add"
  | "Scale"
  | "Sequence"
  | "Loop"
  | "Transport"
  | "Time"
  | "now"
> &
  Record<string, unknown>;

export interface PulseInstrumentNodes {
  instrument: Tone.PolySynth;
  filter: Tone.Filter;
  ampEnv: Tone.AmplitudeEnvelope;
  gate: Tone.Gain;
  output: Tone.Gain;
  effects: Tone.ToneAudioNode[];
  isFilterEnabled: () => boolean;
  setMode: (mode: PulseMode) => void;
  setRate: (value: Tone.Unit.Frequency) => void;
  setDepth: (value: number) => void;
  setShape: (value: PulseShape) => void;
  setFilterEnabled: (enabled: boolean) => void;
  setFilterType: (type: PulseFilterType) => void;
  setResonance: (value: number) => void;
  setPattern: (pattern: number[], length?: number) => void;
  setSwing: (value: number) => void;
  dispose: () => void;
}

const createPolySynth = (
  tone: ToneLike,
  character?: InstrumentCharacter
): Tone.PolySynth => {
  const rawOptions = (character?.options ?? {}) as {
    voice?: string;
    voiceOptions?: Record<string, unknown>;
  } & Record<string, unknown>;
  const { voice, voiceOptions, ...polyOptions } = rawOptions;

  if (voice && voice in tone) {
    const VoiceCtor = (
      tone as unknown as Record<
        string,
        new (opts?: Record<string, unknown>) => Tone.Synth
      >
    )[voice];
    if (VoiceCtor) {
      const PolyCtor = tone.PolySynth as unknown as new (
        voice?: new (opts?: Record<string, unknown>) => Tone.Synth,
        options?: Record<string, unknown>
      ) => Tone.PolySynth;
      const synth = new PolyCtor(VoiceCtor, voiceOptions ?? {});
      (synth as unknown as { set?: (values: Record<string, unknown>) => void }).set?.(
        polyOptions
      );
      return synth;
    }
  }

  const synth = new tone.PolySynth(tone.Synth);
  (synth as unknown as { set?: (values: Record<string, unknown>) => void }).set?.(
    rawOptions
  );
  return synth;
};

const createEffectNodes = (
  tone: ToneLike,
  character?: InstrumentCharacter
): Tone.ToneAudioNode[] => {
  if (!Array.isArray(character?.effects)) {
    return [];
  }
  const nodes: Tone.ToneAudioNode[] = [];
  (character?.effects ?? []).forEach((effect) => {
    const EffectCtor = (
      tone as unknown as Record<
        string,
        new (opts?: Record<string, unknown>) => Tone.ToneAudioNode
      >
    )[effect.type];
    if (!EffectCtor) {
      return;
    }
    const node = new EffectCtor(effect.options ?? {});
    (node as unknown as { start?: () => void }).start?.();
    nodes.push(node);
  });
  return nodes;
};

const reconnectChain = (
  params: {
    synth: Tone.PolySynth;
    filter: Tone.Filter;
    ampEnv: Tone.AmplitudeEnvelope;
    gate: Tone.Gain;
    effects: Tone.ToneAudioNode[];
    output: Tone.Gain;
  },
  useFilter: boolean
) => {
  const { synth, filter, ampEnv, gate, effects, output } = params;
  synth.disconnect();
  filter.disconnect();
  ampEnv.disconnect();
  gate.disconnect();
  effects.forEach((node) => node.disconnect());

  let current: Tone.ToneAudioNode = synth;
  if (useFilter) {
    synth.connect(filter);
    current = filter;
  }

  current.connect(ampEnv);
  current = ampEnv;

  current.connect(gate);
  current = gate;

  effects.forEach((node) => {
    current.connect(node);
    current = node;
  });

  current.connect(output);
};

const resonanceToQ = (value: number) =>
  RESONANCE_MIN_Q + (RESONANCE_MAX_Q - RESONANCE_MIN_Q) * clamp01(value);

const mapGateToAmplitude = (depth: number, value: number) => {
  const normalized = clamp01(value);
  const clampedDepth = clamp01(depth);
  return 1 - clampedDepth + clampedDepth * normalized;
};

const mapGateToFrequency = (depth: number, value: number) => {
  const normalized = clamp01(value);
  const clampedDepth = clamp01(depth);
  const normalizedValue = 1 - clampedDepth + clampedDepth * normalized;
  return (
    FILTER_MIN_FREQUENCY +
    (FILTER_MAX_FREQUENCY - FILTER_MIN_FREQUENCY) * normalizedValue
  );
};

const normalizeLength = (length?: number) =>
  length === 16 ? 16 : length === 8 ? 8 : DEFAULT_PULSE_PATTERN_LENGTH;

export const createPulseInstrument = (
  tone: ToneLike = Tone as ToneLike,
  settings: Partial<PulseSettings> = {},
  character?: InstrumentCharacter
): PulseInstrumentNodes => {
  const resolved: PulseSettings = {
    ...DEFAULT_PULSE_SETTINGS,
    ...settings,
  };

  const synth = createPolySynth(tone, character);
  const filter = new tone.Filter({
    type: resolved.filterType,
    frequency: FILTER_MAX_FREQUENCY,
    Q: resonanceToQ(resolved.resonance),
  });
  const ampEnv = new tone.AmplitudeEnvelope({
    attack: 0.005,
    decay: 0.08,
    sustain: 0,
    release: 0.05,
  });
  const gate = new tone.Gain(1);
  const output = new tone.Gain(1);
  output.connect(tone.Destination);
  const effects = createEffectNodes(tone, character);

  let currentMode: PulseMode = resolved.mode;
  let currentRate: Tone.Unit.Frequency = resolved.rate;
  let currentDepth = clamp01(resolved.depth);
  let currentShape: PulseShape = resolved.shape;
  let filterEnabled = Boolean(resolved.filterEnabled);
  let currentFilterType: PulseFilterType = resolved.filterType;
  let currentResonance = clamp01(resolved.resonance);
  let currentSwing = clamp01(resolved.swing ?? DEFAULT_PULSE_SWING);

  const patternLength = normalizeLength(resolved.patternLength);
  let patternSteps = normalizePattern(resolved.pattern ?? DEFAULT_PULSE_PATTERN, patternLength);
  let patternStepIndex = 0;
  let randomStepIndex = 0;

  const lfo = new tone.LFO({
    frequency: currentRate,
    type: currentShape,
    min: 0,
    max: 1,
  });
  lfo.start();

  const amplitudeDepth = new tone.Multiply(currentDepth);
  const amplitudeOffset = new tone.Add(1 - currentDepth);
  lfo.connect(amplitudeDepth);
  amplitudeDepth.connect(amplitudeOffset);

  const filterDepth = new tone.Multiply(currentDepth);
  const filterOffset = new tone.Add(1 - currentDepth);
  const filterScale = new tone.Scale(FILTER_MIN_FREQUENCY, FILTER_MAX_FREQUENCY);
  lfo.connect(filterDepth);
  filterDepth.connect(filterOffset);
  filterOffset.connect(filterScale);

  reconnectChain({ synth, filter, ampEnv, gate, effects, output }, filterEnabled);

  const resolveSeconds = (value?: Tone.Unit.Time) => {
    if (value === undefined) {
      return tone.now();
    }
    if (typeof value === "number") {
      return value;
    }
    try {
      return tone.Transport.getSecondsAtTime(value);
    } catch (error) {
      try {
        return tone.Time(value).toSeconds();
      } catch (innerError) {
        return tone.now();
      }
    }
  };

  const applySwing = (time: number, stepIndex: number) => {
    if (!currentSwing) {
      return time;
    }
    if (stepIndex % 2 !== 1) {
      return time;
    }
    const interval = tone.Time(currentRate).toSeconds();
    return time + interval * currentSwing * 0.5;
  };

  const triggerPulse = (value: number, time: number, velocity = 1) => {
    const when = Math.max(time, tone.now());
    const amplitude = clamp01(mapGateToAmplitude(currentDepth, value) * velocity);
    const frequency = mapGateToFrequency(currentDepth, value);

    if (value > 0) {
      ampEnv.triggerAttackRelease("16n", when, amplitude);
    }

    const targetFrequency = filterEnabled ? frequency : FILTER_MAX_FREQUENCY;
    filter.frequency.cancelScheduledValues(when);
    filter.frequency.linearRampToValueAtTime(targetFrequency, when + GATE_RAMP);
  };

  const resetPulseState = (time: number) => {
    const when = Math.max(time, tone.now());
    gate.gain.cancelScheduledValues(when);
    gate.gain.setValueAtTime(1, when);
    filter.frequency.cancelScheduledValues(when);
    filter.frequency.linearRampToValueAtTime(
      mapGateToFrequency(currentDepth, 1),
      when + GATE_RAMP
    );
    ampEnv.triggerRelease(when);
  };

  const updateEnvelopeShape = () => {
    const envelopeValues =
      currentMode === "LFO"
        ? {
            attack: 0.005,
            decay: 0.08,
            sustain: 1,
            release: 0.05,
          }
        : {
            attack: 0.005,
            decay: 0.08,
            sustain: 0,
            release: 0.05,
          };
    ampEnv.set(envelopeValues);
  };

  const updateLfoRouting = () => {
    amplitudeOffset.disconnect();
    filterScale.disconnect();
    if (currentMode !== "LFO") {
      resetPulseState(tone.now());
      return;
    }
    if (filterEnabled) {
      filterScale.connect(filter.frequency);
      gate.gain.setValueAtTime(1, tone.now());
    } else {
      amplitudeOffset.connect(gate.gain);
    }
  };

  const updateDepthNodes = () => {
    amplitudeDepth.factor.value = currentDepth;
    amplitudeOffset.addend.value = 1 - currentDepth;
    filterDepth.factor.value = currentDepth;
    filterOffset.addend.value = 1 - currentDepth;
  };

  let patternSequence: Tone.Sequence<number> | null = null;
  const rebuildPatternSequence = () => {
    patternSequence?.dispose();
    patternStepIndex = 0;
    patternSequence = new tone.Sequence<number>((time, step) => {
      const stepValue = typeof step === "number" ? step : 0;
      const index = patternStepIndex;
      patternStepIndex = (patternStepIndex + 1) % patternSteps.length;
      const eventTime = applySwing(time, index);
      if (currentMode === "Pattern" && activeVoices > 0) {
        triggerPulse(stepValue, eventTime);
      }
    }, patternSteps.slice(), currentRate);
    patternSequence.loop = true;
    patternSequence.start(0);
  };

  let randomLoop: Tone.Loop | null = null;
  const rebuildRandomLoop = () => {
    randomLoop?.dispose();
    randomStepIndex = 0;
    randomLoop = new tone.Loop((time) => {
      const stepIndex = randomStepIndex;
      randomStepIndex += 1;
      if (currentMode !== "Random" || activeVoices === 0) {
        return;
      }
      const probability = 0.3 + currentDepth * 0.6;
      const active = Math.random() < clamp01(probability);
      const eventTime = applySwing(time, stepIndex);
      triggerPulse(active ? 1 : 0, eventTime);
    }, currentRate);
    randomLoop.start(0);
  };

  rebuildPatternSequence();
  rebuildRandomLoop();
  updateDepthNodes();
  updateEnvelopeShape();
  updateLfoRouting();

  let activeVoices = 0;
  let voiceCounter = 0;
  const scheduledReleases = new Map<number, number>();

  const scheduleRelease = (
    voiceId: number,
    startTime?: Tone.Unit.Time,
    duration?: Tone.Unit.Time
  ) => {
    const startSeconds = resolveSeconds(startTime);
    const durationSeconds = duration
      ? tone.Time(duration).toSeconds()
      : tone.Time("8n").toSeconds();
    const releaseTime = startSeconds + durationSeconds;
    const eventId = tone.Transport.scheduleOnce(() => {
      scheduledReleases.delete(voiceId);
      activeVoices = Math.max(0, activeVoices - 1);
      if (activeVoices === 0) {
        resetPulseState(releaseTime);
      }
    }, releaseTime);
    scheduledReleases.set(voiceId, eventId);
  };

  const originalTrigger = synth.triggerAttackRelease.bind(synth);
  (synth as Tone.PolySynth & {
    triggerAttackRelease: typeof synth.triggerAttackRelease;
  }).triggerAttackRelease = (
    notes: Tone.Unit.Frequency | Tone.Unit.Frequency[],
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => {
    const voiceId = ++voiceCounter;
    activeVoices += 1;
    const startSeconds = resolveSeconds(time);
    if (activeVoices === 1) {
      if (currentMode === "LFO") {
        const when = Math.max(startSeconds, tone.now());
        gate.gain.cancelScheduledValues(when);
        gate.gain.setValueAtTime(1, when);
        filter.frequency.cancelScheduledValues(when);
        filter.frequency.linearRampToValueAtTime(
          mapGateToFrequency(currentDepth, 1),
          when + GATE_RAMP
        );
        ampEnv.triggerAttack(when, 1);
      } else {
        resetPulseState(startSeconds);
      }
    }
    scheduleRelease(voiceId, time, duration);
    return originalTrigger(
      notes,
      duration as Tone.Unit.Time | Tone.Unit.Time[],
      time,
      velocity
    );
  };

  const setMode = (mode: PulseMode) => {
    if (currentMode === mode) return;
    currentMode = mode;
    updateEnvelopeShape();
    updateLfoRouting();
    if (currentMode === "LFO" && activeVoices > 0) {
      const when = tone.now();
      ampEnv.triggerAttack(when, 1);
    }
  };

  const setRate = (value: Tone.Unit.Frequency) => {
    if (currentRate === value) return;
    currentRate = value;
    lfo.frequency.value = value;
    rebuildPatternSequence();
    if (randomLoop) {
      randomLoop.interval = value;
    }
  };

  const setDepth = (value: number) => {
    const clamped = clamp01(value);
    if (clamped === currentDepth) return;
    currentDepth = clamped;
    updateDepthNodes();
  };

  const setShape = (value: PulseShape) => {
    if (currentShape === value) return;
    currentShape = value;
    lfo.type = value;
  };

  const setFilterEnabled = (enabled: boolean) => {
    if (filterEnabled === enabled) return;
    filterEnabled = enabled;
    reconnectChain({ synth, filter, ampEnv, gate, effects, output }, filterEnabled);
    updateLfoRouting();
  };

  const setFilterType = (type: PulseFilterType) => {
    if (currentFilterType === type) return;
    currentFilterType = type;
    filter.type = type;
  };

  const setResonance = (value: number) => {
    const clamped = clamp01(value);
    if (currentResonance === clamped) return;
    currentResonance = clamped;
    filter.Q.value = resonanceToQ(clamped);
  };

  const setPattern = (pattern: number[], length?: number) => {
    const normalizedLength = normalizeLength(length ?? pattern.length);
    patternSteps = normalizePattern(pattern, normalizedLength);
    patternStepIndex = 0;
    if (patternSequence) {
      patternSequence.events = patternSteps.slice();
    } else {
      rebuildPatternSequence();
    }
  };

  const setSwing = (value: number) => {
    const clamped = clamp01(value);
    currentSwing = clamped;
  };

  const dispose = () => {
    scheduledReleases.forEach((eventId) => {
      tone.Transport.clear(eventId);
    });
    scheduledReleases.clear();
    lfo.dispose();
    amplitudeDepth.dispose();
    amplitudeOffset.dispose();
    filterDepth.dispose();
    filterOffset.dispose();
    filterScale.dispose();
    patternSequence?.dispose();
    randomLoop?.dispose();
    effects.forEach((node) => node.dispose());
    ampEnv.dispose();
    gate.dispose();
    filter.dispose();
    output.dispose();
  };

  return {
    instrument: synth,
    filter,
    ampEnv,
    gate,
    output,
    effects,
    isFilterEnabled: () => filterEnabled,
    setMode,
    setRate,
    setDepth,
    setShape,
    setFilterEnabled,
    setFilterType,
    setResonance,
    setPattern,
    setSwing,
    dispose,
  };
};

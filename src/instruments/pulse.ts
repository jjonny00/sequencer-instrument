import * as Tone from "tone";

import {
  DEFAULT_PULSE_DEPTH,
  DEFAULT_PULSE_FILTER_ENABLED,
  DEFAULT_PULSE_FILTER_TYPE,
  DEFAULT_PULSE_MODE,
  DEFAULT_PULSE_HUMANIZE,
  DEFAULT_PULSE_MOTION_DEPTH,
  DEFAULT_PULSE_MOTION_RATE,
  DEFAULT_PULSE_MOTION_TARGET,
  DEFAULT_PULSE_PATTERN,
  DEFAULT_PULSE_PATTERN_LENGTH,
  DEFAULT_PULSE_RATE,
  DEFAULT_PULSE_RESONANCE,
  DEFAULT_PULSE_SHAPE,
  DEFAULT_PULSE_SWING,
  normalizePulsePattern,
  type PulseFilterType,
  type PulseMode,
  type PulseMotionTarget,
  type PulsePatternStep,
  type PulseShape,
} from "../chunks";
import type { InstrumentCharacter } from "../packs";

export type { PulseFilterType, PulseMode, PulseShape, PulseMotionTarget };

export type PulseActivitySource = "pattern" | "random" | "manual" | "lfo";

export interface PulseActivityEvent {
  active: boolean;
  velocity: number;
  time: number;
  source: PulseActivitySource;
  stepIndex?: number;
}

const FILTER_MIN_FREQUENCY = 180;
const FILTER_MAX_FREQUENCY = 9500;
const RESONANCE_MIN_Q = 0.7;
const RESONANCE_MAX_Q = 14;
const GATE_RAMP = 0.02;
const MOTION_CUTOFF_RANGE = FILTER_MAX_FREQUENCY - FILTER_MIN_FREQUENCY;
const MOTION_CUTOFF_RATIO = 0.4;
const MOTION_RESONANCE_RATIO = 0.6;
const MOTION_AMP_SWING = 0.5;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const clonePatternSteps = (pattern: PulsePatternStep[]): PulsePatternStep[] =>
  pattern.map((step) => ({ ...step }));

const normalizePattern = (
  pattern: PulsePatternStep[] | number[] | undefined,
  length: number
) => clonePatternSteps(normalizePulsePattern(pattern, length));

export interface PulseSettings {
  mode: PulseMode;
  rate: string;
  depth: number;
  shape: PulseShape;
  filterEnabled: boolean;
  filterType: PulseFilterType;
  resonance: number;
  motionRate: string;
  motionDepth: number;
  motionTarget: PulseMotionTarget;
  pattern?: PulsePatternStep[];
  patternLength?: number;
  swing?: number;
  humanize?: number;
}

export const DEFAULT_PULSE_SETTINGS: PulseSettings = {
  mode: DEFAULT_PULSE_MODE,
  rate: DEFAULT_PULSE_RATE,
  depth: DEFAULT_PULSE_DEPTH,
  shape: DEFAULT_PULSE_SHAPE,
  filterEnabled: DEFAULT_PULSE_FILTER_ENABLED,
  filterType: DEFAULT_PULSE_FILTER_TYPE,
  resonance: DEFAULT_PULSE_RESONANCE,
  motionRate: DEFAULT_PULSE_MOTION_RATE,
  motionDepth: DEFAULT_PULSE_MOTION_DEPTH,
  motionTarget: DEFAULT_PULSE_MOTION_TARGET,
  pattern: clonePatternSteps(DEFAULT_PULSE_PATTERN),
  patternLength: DEFAULT_PULSE_PATTERN_LENGTH,
  swing: DEFAULT_PULSE_SWING,
  humanize: DEFAULT_PULSE_HUMANIZE,
};

type ToneLike = Pick<
  typeof Tone,
  | "PolySynth"
  | "Synth"
  | "AmplitudeEnvelope"
  | "Gain"
  | "Destination"
  | "Filter"
  | "Chorus"
  | "Noise"
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

const connectDetuneModulation = (synth: Tone.PolySynth, lfo: Tone.LFO) => {
  const polyWithDetune = synth as unknown as {
    detune?: { connect: (input: unknown) => void; disconnect?: (input: unknown) => void };
  };
  const polyDetune = polyWithDetune.detune;
  if (polyDetune && typeof polyDetune.connect === "function") {
    lfo.connect(polyDetune as unknown as any);
    return () => {
      lfo.disconnect(polyDetune as unknown as any);
    };
  }

  const polyWithVoices = synth as unknown as {
    voices?: Array<{
      detune?: { connect: (input: unknown) => void; disconnect?: (input: unknown) => void };
    }>;
  };

  if (Array.isArray(polyWithVoices.voices)) {
    polyWithVoices.voices.forEach((voice) => {
      const voiceDetune = voice?.detune;
      if (voiceDetune && typeof voiceDetune.connect === "function") {
        lfo.connect(voiceDetune as unknown as any);
      }
    });

    return () => {
      polyWithVoices.voices?.forEach((voice) => {
        const voiceDetune = voice?.detune;
        if (voiceDetune && typeof voiceDetune.connect === "function") {
          lfo.disconnect(voiceDetune as unknown as any);
        }
      });
    };
  }

  return () => {};
};

export interface PulseInstrumentNodes {
  instrument: Tone.PolySynth;
  filter: Tone.Filter;
  chorus: Tone.Chorus;
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
  setMotionRate: (value: Tone.Unit.Frequency) => void;
  setMotionDepth: (value: number) => void;
  setMotionTarget: (value: PulseMotionTarget) => void;
  setPattern: (pattern: PulsePatternStep[] | number[], length?: number) => void;
  setSwing: (value: number) => void;
  setHumanize: (value: number) => void;
  addPulseListener: (listener: (event: PulseActivityEvent) => void) => () => void;
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
    chorus: Tone.Chorus;
    ampEnv: Tone.AmplitudeEnvelope;
    gate: Tone.Gain;
    effects: Tone.ToneAudioNode[];
    output: Tone.Gain;
  },
  useFilter: boolean
) => {
  const { synth, filter, chorus, ampEnv, gate, effects, output } = params;
  synth.disconnect();
  filter.disconnect();
  chorus.disconnect();
  ampEnv.disconnect();
  gate.disconnect();
  effects.forEach((node) => node.disconnect());

  let current: Tone.ToneAudioNode = synth;
  if (useFilter) {
    synth.connect(filter);
    current = filter;
  }

  current.connect(chorus);
  current = chorus;

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

  const pulseListeners = new Set<(event: PulseActivityEvent) => void>();

  const notifyPulseListeners = (event: PulseActivityEvent) => {
    pulseListeners.forEach((listener) => {
      listener(event);
    });
  };

  const synth = createPolySynth(tone, character);
  const filter = new tone.Filter({
    type: resolved.filterType,
    frequency: FILTER_MAX_FREQUENCY,
    Q: resonanceToQ(resolved.resonance),
  });
  const chorus = new tone.Chorus(4, 2.5, 0.2);
  chorus.start();
  const ampEnv = new tone.AmplitudeEnvelope({
    attack: 0.005,
    decay: 0.08,
    sustain: 0,
    release: 0.05,
  });
  const noise = new tone.Noise("white");
  noise.start();
  const noiseEnv = new tone.AmplitudeEnvelope({
    attack: 0.01,
    decay: 0.12,
    sustain: 0,
    release: 0.08,
  });
  const noiseGain = new tone.Gain(0.18);
  noise.connect(noiseEnv);
  noiseEnv.connect(noiseGain);
  noiseGain.connect(ampEnv);
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
  let currentMotionRate: Tone.Unit.Frequency = resolved.motionRate;
  let currentMotionDepth = clamp01(resolved.motionDepth);
  let currentMotionTarget: PulseMotionTarget = resolved.motionTarget;
  let currentSwing = clamp01(resolved.swing ?? DEFAULT_PULSE_SWING);
  let currentHumanize = clamp01(resolved.humanize ?? DEFAULT_PULSE_HUMANIZE);

  const patternLength = normalizeLength(resolved.patternLength);
  let patternSteps = normalizePattern(
    resolved.pattern ?? DEFAULT_PULSE_PATTERN,
    patternLength
  );
  let patternStepIndex = 0;
  let randomStepIndex = 0;

  const lfo = new tone.LFO({
    frequency: currentRate,
    type: currentShape,
    min: 0,
    max: 1,
  });
  lfo.start();

  const motionLfo = new tone.LFO({
    frequency: currentMotionRate,
    min: -1,
    max: 1,
  });
  motionLfo.start();

  const detuneLfo = new tone.LFO({
    frequency: "8m",
    min: -6,
    max: 6,
  });
  detuneLfo.start();
  const disconnectDetuneModulation = connectDetuneModulation(synth, detuneLfo);

  const motionDepthNode = new tone.Multiply(currentMotionDepth);
  motionLfo.connect(motionDepthNode);

  const motionCutoffGain = new tone.Multiply(
    MOTION_CUTOFF_RANGE * MOTION_CUTOFF_RATIO
  );
  motionDepthNode.connect(motionCutoffGain);

  const motionResonanceGain = new tone.Multiply(
    resonanceToQ(currentResonance) * MOTION_RESONANCE_RATIO
  );
  motionDepthNode.connect(motionResonanceGain);

  const motionAmpScale = new tone.Multiply(MOTION_AMP_SWING);
  motionDepthNode.connect(motionAmpScale);
  const motionAmpOffset = new tone.Add(1);
  motionAmpScale.connect(motionAmpOffset);

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

  reconnectChain({ synth, filter, chorus, ampEnv, gate, effects, output }, filterEnabled);

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

  const jitter = (amount: number) => (Math.random() * 2 - 1) * amount;

  const applyHumanizeTime = (time: number) =>
    time + jitter(0.02 * currentHumanize);

  const computeHumanizedVelocity = (base: number) =>
    clamp01(base + jitter(0.1 * currentHumanize));

  const triggerPulse = (
    value: number,
    time: number,
    velocity = 1,
    context: { source: PulseActivitySource; stepIndex?: number } = {
      source: "pattern",
    }
  ) => {
    const when = Math.max(time, tone.now());
    const amplitude = clamp01(mapGateToAmplitude(currentDepth, value) * velocity);
    const frequency = mapGateToFrequency(currentDepth, value);

    if (value > 0) {
      ampEnv.triggerAttackRelease("16n", when, amplitude);
      const noiseVelocity = clamp01(amplitude * 0.6);
      noiseEnv.triggerAttackRelease("16n", when, noiseVelocity);
    }

    const targetFrequency = filterEnabled ? frequency : FILTER_MAX_FREQUENCY;
    filter.frequency.cancelScheduledValues(when);
    filter.frequency.linearRampToValueAtTime(targetFrequency, when + GATE_RAMP);

    notifyPulseListeners({
      active: value > 0,
      velocity: amplitude,
      time: when,
      source: context.source,
      stepIndex: context.stepIndex,
    });
  };

  const resetPulseState = (
    time: number,
    source: PulseActivitySource = "manual"
  ) => {
    const when = Math.max(time, tone.now());
    gate.gain.cancelScheduledValues(when);
    gate.gain.setValueAtTime(1, when);
    filter.frequency.cancelScheduledValues(when);
    filter.frequency.linearRampToValueAtTime(
      mapGateToFrequency(currentDepth, 1),
      when + GATE_RAMP
    );
    ampEnv.triggerRelease(when);
    noiseEnv.triggerRelease(when);
    notifyPulseListeners({
      active: false,
      velocity: 0,
      time: when,
      source,
    });
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

  const updateMotionDepthValue = () => {
    motionDepthNode.factor.value = currentMotionDepth;
  };

  const updateMotionResonanceGain = () => {
    motionResonanceGain.factor.value =
      resonanceToQ(currentResonance) * MOTION_RESONANCE_RATIO;
  };

  const updateMotionTargetRouting = () => {
    motionCutoffGain.disconnect();
    motionResonanceGain.disconnect();
    motionAmpOffset.disconnect();

    const now = tone.now();

    if (currentMotionTarget === "cutoff") {
      motionCutoffGain.connect(filter.frequency);
    } else if (currentMotionTarget === "resonance") {
      motionResonanceGain.connect(filter.Q);
    } else if (currentMotionTarget === "amp") {
      motionAmpOffset.connect(output.gain);
    }

    if (currentMotionTarget !== "amp") {
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(1, now);
    }
  };

  const createStepEvents = () => patternSteps.map((step) => (step.active ? 1 : 0));

  let patternSequence: Tone.Sequence<number> | null = null;
  const rebuildPatternSequence = () => {
    patternSequence?.dispose();
    patternStepIndex = 0;
    patternSequence = new tone.Sequence<number>((time, _step) => {
      if (!patternSteps.length) {
        return;
      }
      const index = patternStepIndex;
      patternStepIndex = (patternStepIndex + 1) % patternSteps.length;
      const stepData = patternSteps[index] ?? { active: false, velocity: 1, probability: 1 };
      const swungTime = applySwing(time, index);
      const eventTime = applyHumanizeTime(swungTime);
      if (currentMode !== "Pattern" || activeVoices === 0) {
        return;
      }
      const context = { source: "pattern" as const, stepIndex: index };
      if (!stepData.active) {
        triggerPulse(0, eventTime, 0, context);
        return;
      }
      const stepProbability = clamp01(stepData.probability ?? 1);
      if (Math.random() > stepProbability) {
        triggerPulse(0, eventTime, 0, context);
        return;
      }
      const baseVelocity =
        typeof stepData.velocity === "number" && Number.isFinite(stepData.velocity)
          ? stepData.velocity
          : 1;
      const velocity = computeHumanizedVelocity(baseVelocity);
      triggerPulse(1, eventTime, velocity, context);
    }, createStepEvents(), currentRate);
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
    const swungTime = applySwing(time, stepIndex);
    const eventTime = applyHumanizeTime(swungTime);
    const context = { source: "random" as const, stepIndex };
    if (!active) {
      triggerPulse(0, eventTime, 0, context);
      return;
    }
    const velocity = computeHumanizedVelocity(0.85);
    triggerPulse(1, eventTime, velocity, context);
  }, currentRate);
    randomLoop.start(0);
  };

  rebuildPatternSequence();
  rebuildRandomLoop();
  updateDepthNodes();
  updateMotionDepthValue();
  updateMotionResonanceGain();
  updateEnvelopeShape();
  updateLfoRouting();
  updateMotionTargetRouting();

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
        const releaseSource: PulseActivitySource =
          currentMode === "LFO" ? "lfo" : "manual";
        resetPulseState(releaseTime, releaseSource);
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
        const manualVelocity = clamp01(velocity ?? 1);
        notifyPulseListeners({
          active: true,
          velocity: manualVelocity,
          time: when,
          source: "lfo",
        });
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
    reconnectChain({ synth, filter, chorus, ampEnv, gate, effects, output }, filterEnabled);
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
    updateMotionResonanceGain();
  };

  const setMotionRate = (value: Tone.Unit.Frequency) => {
    if (currentMotionRate === value) return;
    currentMotionRate = value;
    motionLfo.frequency.value = value;
  };

  const setMotionDepth = (value: number) => {
    const clamped = clamp01(value);
    if (currentMotionDepth === clamped) return;
    currentMotionDepth = clamped;
    updateMotionDepthValue();
    if (currentMotionTarget === "amp" && clamped === 0) {
      const now = tone.now();
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(1, now);
    }
  };

  const setMotionTarget = (value: PulseMotionTarget) => {
    if (currentMotionTarget === value) return;
    currentMotionTarget = value;
    updateMotionTargetRouting();
  };

  const setPattern = (
    pattern: PulsePatternStep[] | number[],
    length?: number
  ) => {
    const normalizedLength = normalizeLength(length ?? pattern.length);
    patternSteps = normalizePattern(pattern, normalizedLength);
    patternStepIndex = 0;
    if (patternSequence) {
      patternSequence.events = createStepEvents();
    } else {
      rebuildPatternSequence();
    }
  };

  const setSwing = (value: number) => {
    const clamped = clamp01(value);
    currentSwing = clamped;
  };

  const setHumanize = (value: number) => {
    currentHumanize = clamp01(value);
  };

  const dispose = () => {
    scheduledReleases.forEach((eventId) => {
      tone.Transport.clear(eventId);
    });
    scheduledReleases.clear();
    pulseListeners.clear();
    lfo.dispose();
    motionLfo.dispose();
    disconnectDetuneModulation();
    detuneLfo.dispose();
    amplitudeDepth.dispose();
    amplitudeOffset.dispose();
    filterDepth.dispose();
    filterOffset.dispose();
    filterScale.dispose();
    motionDepthNode.dispose();
    motionCutoffGain.dispose();
    motionResonanceGain.dispose();
    motionAmpScale.dispose();
    motionAmpOffset.dispose();
    patternSequence?.dispose();
    randomLoop?.dispose();
    effects.forEach((node) => node.dispose());
    noiseEnv.dispose();
    noiseGain.dispose();
    noise.dispose();
    chorus.dispose();
    ampEnv.dispose();
    gate.dispose();
    filter.dispose();
    output.dispose();
  };

  return {
    instrument: synth,
    filter,
    chorus,
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
    setMotionRate,
    setMotionDepth,
    setMotionTarget,
    setPattern,
    setSwing,
    setHumanize,
    addPulseListener: (listener: (event: PulseActivityEvent) => void) => {
      pulseListeners.add(listener);
      return () => {
        pulseListeners.delete(listener);
      };
    },
    dispose,
  };
};

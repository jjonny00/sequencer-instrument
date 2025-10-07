import * as Tone from "tone";

import type { EffectSpec, InstrumentCharacter } from "../packs";

export type PulseModulationMode = "amplitude" | "filter";

type ToneLike = typeof Tone;

type PolyVoiceCtor = new (options?: Record<string, unknown>) => Tone.Synth;

type PolyCtor = new (
  voice?: PolyVoiceCtor,
  options?: Record<string, unknown>
) => Tone.PolySynth<Tone.Synth>;

const DEFAULT_RATE: Tone.Unit.Frequency = "8n";
const DEFAULT_DEPTH = 0.6;
const DEFAULT_SHAPE: Tone.ToneOscillatorType = "sine";
const DEFAULT_MODE: PulseModulationMode = "amplitude";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const isFrequencyLike = (
  value: unknown
): value is Tone.Unit.Frequency =>
  typeof value === "number" || typeof value === "string";

const isOscillatorType = (
  value: unknown
): value is Tone.ToneOscillatorType => typeof value === "string";

const isPulseMode = (value: unknown): value is PulseModulationMode =>
  value === "amplitude" || value === "filter";

const buildEffectChain = (
  tone: ToneLike,
  source: Tone.ToneAudioNode,
  effects: EffectSpec[]
): { tail: Tone.ToneAudioNode; nodes: Tone.ToneAudioNode[] } => {
  if (!effects.length) {
    return { tail: source, nodes: [] };
  }
  const nodes: Tone.ToneAudioNode[] = [];
  let current = source;
  effects.forEach((effect) => {
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
    const maybeStart = node as unknown as { start?: () => void };
    maybeStart.start?.();
    current.connect(node);
    nodes.push(node);
    current = node;
  });
  return { tail: current, nodes };
};

export interface PulseNodes {
  synth: Tone.PolySynth<Tone.Synth>;
  tremolo: Tone.Tremolo;
  autoFilter: Tone.AutoFilter;
  output: Tone.Gain;
  setRate: (rate: Tone.Unit.Frequency) => void;
  setDepth: (depth: number) => void;
  setShape: (shape: Tone.ToneOscillatorType) => void;
  setMode: (mode: PulseModulationMode) => void;
  getMode: () => PulseModulationMode;
  dispose: () => void;
}

const resolvePolySynth = (
  tone: ToneLike,
  character?: InstrumentCharacter
): Tone.PolySynth<Tone.Synth> => {
  const options = (character?.options ?? {}) as {
    voice?: string;
    voiceOptions?: Record<string, unknown>;
  } & Record<string, unknown>;
  const { voice, voiceOptions, ...polyOptions } = options;
  const settable = (values: Record<string, unknown>) => {
    (synth as unknown as { set?: (payload: Record<string, unknown>) => void }).set?.(
      values
    );
  };
  let synth: Tone.PolySynth<Tone.Synth>;
  if (voice && voice in tone) {
    const VoiceCtor = (
      tone as unknown as Record<string, PolyVoiceCtor>
    )[voice] as PolyVoiceCtor;
    const PolyCtorImpl = tone.PolySynth as unknown as PolyCtor;
    synth = new PolyCtorImpl(VoiceCtor, voiceOptions ?? {});
  } else {
    synth = new tone.PolySynth();
  }
  if (Object.keys(polyOptions).length > 0) {
    settable(polyOptions);
  }
  return synth;
};

const resolveDefaults = (
  character?: InstrumentCharacter
): {
  rate: Tone.Unit.Frequency;
  depth: number;
  shape: Tone.ToneOscillatorType;
  mode: PulseModulationMode;
} => {
  const defaults = character?.defaults ?? {};
  const rate = isFrequencyLike(defaults.pulseRate)
    ? (defaults.pulseRate as Tone.Unit.Frequency)
    : DEFAULT_RATE;
  const depth = clamp(
    typeof defaults.pulseDepth === "number" ? defaults.pulseDepth : DEFAULT_DEPTH,
    0,
    1
  );
  const shape = isOscillatorType(defaults.pulseShape)
    ? (defaults.pulseShape as Tone.ToneOscillatorType)
    : DEFAULT_SHAPE;
  const mode = isPulseMode(defaults.pulseMode)
    ? (defaults.pulseMode as PulseModulationMode)
    : DEFAULT_MODE;
  return { rate, depth, shape, mode };
};

export const createPulseInstrument = (
  tone: ToneLike = Tone,
  character?: InstrumentCharacter
): PulseNodes => {
  const synth = resolvePolySynth(tone, character);
  const effects = Array.isArray(character?.effects)
    ? (character?.effects as EffectSpec[])
    : [];
  const { tail, nodes: effectNodes } = buildEffectChain(tone, synth, effects);

  const tremolo = new tone.Tremolo({
    frequency: DEFAULT_RATE,
    depth: DEFAULT_DEPTH,
    wet: 1,
  }).start();
  tremolo.sync();

  const autoFilter = new tone.AutoFilter({
    frequency: DEFAULT_RATE,
    depth: DEFAULT_DEPTH,
    wet: 0,
  }).start();
  autoFilter.sync();

  tail.connect(tremolo);
  tail.connect(autoFilter);

  const output = new tone.Gain(1);
  tremolo.connect(output);
  autoFilter.connect(output);

  let mode: PulseModulationMode = DEFAULT_MODE;

  const setRate = (rate: Tone.Unit.Frequency) => {
    if (!isFrequencyLike(rate)) return;
    tremolo.frequency.value = rate;
    autoFilter.frequency.value = rate;
  };

  const setDepth = (depth: number) => {
    const clamped = clamp(depth, 0, 1);
    tremolo.depth.rampTo(clamped, 0.05);
    autoFilter.depth.rampTo(clamped, 0.05);
  };

  const setShape = (shape: Tone.ToneOscillatorType) => {
    if (!isOscillatorType(shape)) return;
    tremolo.type = shape;
    autoFilter.type = shape;
  };

  const setMode = (nextMode: PulseModulationMode) => {
    mode = nextMode;
    if (mode === "filter") {
      autoFilter.wet.rampTo(1, 0.05);
      tremolo.wet.rampTo(0, 0.05);
    } else {
      autoFilter.wet.rampTo(0, 0.05);
      tremolo.wet.rampTo(1, 0.05);
    }
  };

  const getMode = () => mode;

  const dispose = () => {
    tremolo.unsync();
    tremolo.stop();
    tremolo.dispose();
    autoFilter.unsync();
    autoFilter.stop();
    autoFilter.dispose();
    effectNodes.forEach((node) => node.dispose());
    output.dispose();
  };

  const defaults = resolveDefaults(character);
  setRate(defaults.rate);
  setDepth(defaults.depth);
  setShape(defaults.shape);
  setMode(defaults.mode);

  return {
    synth,
    tremolo,
    autoFilter,
    output,
    setRate,
    setDepth,
    setShape,
    setMode,
    getMode,
    dispose,
  };
};


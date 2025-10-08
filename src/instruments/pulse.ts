import * as Tone from "tone";

import {
  DEFAULT_PULSE_DEPTH,
  DEFAULT_PULSE_FILTER,
  DEFAULT_PULSE_RATE,
  DEFAULT_PULSE_SHAPE,
  type PulseShape,
} from "../chunks";
import type { InstrumentCharacter } from "../packs";

export type { PulseShape };

export interface PulseSettings {
  rate: Tone.Unit.Frequency;
  depth: number;
  shape: PulseShape;
  filter?: boolean;
}

export const DEFAULT_PULSE_SETTINGS: PulseSettings = {
  rate: DEFAULT_PULSE_RATE,
  depth: DEFAULT_PULSE_DEPTH,
  shape: DEFAULT_PULSE_SHAPE,
  filter: DEFAULT_PULSE_FILTER,
};

type ToneLike = Pick<
  typeof Tone,
  | "PolySynth"
  | "Synth"
  | "Tremolo"
  | "AutoFilter"
  | "Gain"
  | "Destination"
  | "Transport"
> &
  Record<string, unknown>;

export interface PulseInstrumentNodes {
  instrument: Tone.PolySynth;
  tremolo: Tone.Tremolo;
  filter: Tone.AutoFilter;
  output: Tone.Gain;
  effects: Tone.ToneAudioNode[];
  isFilterEnabled: () => boolean;
  setRate: (value: Tone.Unit.Frequency) => void;
  setDepth: (value: number) => void;
  setShape: (value: PulseShape) => void;
  setFilterEnabled: (enabled: boolean) => void;
  dispose: () => void;
}

const clampDepth = (value: number) => Math.max(0, Math.min(1, value));

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
    tremolo: Tone.Tremolo;
    filter: Tone.AutoFilter;
    effects: Tone.ToneAudioNode[];
    output: Tone.Gain;
  },
  useFilter: boolean
) => {
  const { synth, tremolo, filter, effects, output } = params;
  synth.disconnect();
  tremolo.disconnect();
  filter.disconnect();
  effects.forEach((node) => node.disconnect());

  let current: Tone.ToneAudioNode;
  if (useFilter) {
    synth.connect(filter);
    current = filter;
  } else {
    synth.connect(tremolo);
    current = tremolo;
  }

  effects.forEach((node) => {
    current.connect(node);
    current = node;
  });

  current.connect(output);
};

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
  const tremolo = new tone.Tremolo(resolved.rate, resolved.depth);
  tremolo.type = resolved.shape;
  tremolo.start();
  tremolo.sync();

  const filter = new tone.AutoFilter(resolved.rate);
  filter.type = resolved.shape;
  filter.depth.value = clampDepth(resolved.depth);
  filter.start();
  filter.sync();

  const output = new tone.Gain(1);
  output.connect(tone.Destination);

  const effects = createEffectNodes(tone, character);

  let useFilter = Boolean(resolved.filter);
  reconnectChain({ synth, tremolo, filter, effects, output }, useFilter);

  const setRate = (value: Tone.Unit.Frequency) => {
    tremolo.set({ frequency: value });
    filter.set({ frequency: value });
  };

  const setDepth = (value: number) => {
    const depth = clampDepth(value);
    tremolo.set({ depth });
    filter.depth.value = depth;
  };

  const setShape = (value: PulseShape) => {
    tremolo.type = value;
    filter.type = value;
  };

  const setFilterEnabled = (enabled: boolean) => {
    if (useFilter === enabled) return;
    useFilter = enabled;
    reconnectChain({ synth, tremolo, filter, effects, output }, useFilter);
  };

  const dispose = () => {
    tremolo.dispose();
    filter.dispose();
    effects.forEach((node) => node.dispose());
    output.dispose();
  };

  return {
    instrument: synth,
    tremolo,
    filter,
    output,
    effects,
    isFilterEnabled: () => useFilter,
    setRate,
    setDepth,
    setShape,
    setFilterEnabled,
    dispose,
  };
};

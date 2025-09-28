import * as Tone from "tone";

export type PerformanceInstrumentType = "keyboard" | "arp" | "pads";

export const PERFORMANCE_INSTRUMENT_TYPES: PerformanceInstrumentType[] = [
  "keyboard",
  "arp",
  "pads",
];

export const PERFORMANCE_INSTRUMENT_SETTINGS: Record<
  PerformanceInstrumentType,
  Record<string, unknown>
> = {
  keyboard: {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.25 },
  },
  arp: {
    oscillator: { type: "square" },
    envelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.15 },
  },
  pads: {
    oscillator: { type: "sine" },
    envelope: { attack: 0.25, decay: 0.4, sustain: 0.8, release: 1.6 },
  },
};

export const PERFORMANCE_INSTRUMENT_DURATIONS: Record<
  PerformanceInstrumentType,
  string
> = {
  keyboard: "4n",
  arp: "8n",
  pads: "2n",
};

export const PERFORMANCE_INSTRUMENT_VELOCITY: Record<
  PerformanceInstrumentType,
  number
> = {
  keyboard: 0.8,
  arp: 0.7,
  pads: 0.9,
};

export const PERFORMANCE_INSTRUMENT_LABELS: Record<
  PerformanceInstrumentType,
  string
> = {
  keyboard: "Keyboard",
  arp: "Arp",
  pads: "Pads",
};

export const isPerformanceInstrumentType = (
  value: string
): value is PerformanceInstrumentType =>
  (PERFORMANCE_INSTRUMENT_TYPES as string[]).includes(value);

export const createPerformanceInstrument = (
  type: PerformanceInstrumentType
) => {
    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    synth.set(
      PERFORMANCE_INSTRUMENT_SETTINGS[type] as unknown as Tone.SynthOptions
    );
    synth.volume.value = type === "pads" ? -4 : -6;
    return synth;
};

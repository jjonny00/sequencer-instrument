import * as Tone from "tone";

import { packs } from "@/packs";
import type { InstrumentCharacter, Pack } from "@/packs";

type KickMacroDefaults = {
  punch: number;
  clean: number;
  tight: number;
};

type ToneLike = Pick<
  typeof Tone,
  "Destination" | "Gain" | "MembraneSynth" | "NoiseSynth" | "dbToGain" | "now"
>;

interface KickVoiceOptions {
  tone?: ToneLike;
  pack?: Pack;
}

type KickVoice = Tone.Gain & {
  triggerAttackRelease: (
    note?: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function resolveKickCharacter(
  packId: string,
  characterId: string,
  providedPack?: Pack
) {
  const pack = providedPack ?? packs.find((candidate: Pack) => candidate.id === packId);
  if (!pack) throw new Error(`[kick] pack not found: ${packId}`);
  const instrument = pack.instruments?.["kick"];
  if (!instrument) throw new Error(`[kick] no 'kick' instrument in pack ${packId}`);
  let char = instrument.characters.find(
    (candidate: InstrumentCharacter) => candidate.id === characterId
  );
  if (!char && instrument.defaultCharacterId) {
    char = instrument.characters.find(
      (candidate: InstrumentCharacter) => candidate.id === instrument.defaultCharacterId
    );
  }
  if (!char) char = instrument.characters[0];
  if (!char) throw new Error(`[kick] no characters available for pack ${packId}`);
  return char;
}

function mapKickParams(defaults?: Partial<KickMacroDefaults>) {
  const punch = clamp(defaults?.punch ?? 0.5, 0, 1);
  const clean = clamp(defaults?.clean ?? 0.5, 0, 1);
  const tight = clamp(defaults?.tight ?? 0.5, 0, 1);
  return {
    pitchDecay: 0.01 + punch * 0.05,
    octaves: 2 + Math.round(punch * 3),
    decay: 0.2 + (1 - clean) * 0.6,
    release: 0.05 + (1 - clean) * 0.2,
    noiseDb: -40 + (1 - tight) * 20,
  };
}

export function createKick(
  packId: string,
  characterId: string,
  options: KickVoiceOptions = {}
): KickVoice {
  const toneApi = options.tone ?? Tone;
  const char = resolveKickCharacter(packId, characterId, options.pack);
  const params = mapKickParams(char.defaults);

  const output = new toneApi.Gain(1) as KickVoice;

  const sub = new toneApi.MembraneSynth({
    pitchDecay: params.pitchDecay,
    octaves: params.octaves,
    oscillator: { type: "sine" },
    envelope: {
      attack: 0.005,
      decay: params.decay,
      sustain: 0,
      release: params.release,
    },
  });
  sub.connect(output);

  let noise: InstanceType<typeof toneApi.NoiseSynth> | null = null;
  let noiseGain: InstanceType<typeof toneApi.Gain> | null = null;
  if (params.noiseDb > -36) {
    noise = new toneApi.NoiseSynth({
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
    });
    noiseGain = new toneApi.Gain(toneApi.dbToGain(params.noiseDb));
    noise.connect(noiseGain);
    noiseGain.connect(output);
  }

  output.connect(toneApi.Destination);

  if (import.meta.env.DEV) {
    console.info("[kick:new]", {
      packId,
      characterId: char.id,
      defaults: char.defaults,
      mapped: params,
    });
  }

  output.triggerAttackRelease = (
    note: Tone.Unit.Frequency = "C1",
    duration: Tone.Unit.Time = "8n",
    time?: Tone.Unit.Time,
    velocity?: number
  ) => {
    const oscillator = (sub as { oscillator?: { phase?: number } }).oscillator;
    if (oscillator && typeof oscillator.phase === "number") {
      oscillator.phase = 0;
    }
    sub.triggerAttackRelease(note, duration, time, velocity);
    noise?.triggerAttackRelease(duration, time, velocity);
  };

  const originalDispose = output.dispose.bind(output);
  output.dispose = () => {
    noise?.dispose();
    noiseGain?.dispose();
    sub.dispose();
    return originalDispose();
  };

  return output;
}

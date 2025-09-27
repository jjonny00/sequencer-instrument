import * as Tone from "tone";
import type { fromContext } from "tone/build/esm/fromContext";
import type { Chunk } from "@/chunks";
import type { InstrumentCharacter, Pack } from "@/packs";
import { packs } from "@/packs";

export type KickDefaults = {
  pitchDecay: number;
  octaves: number;
  decay: number;
  release: number;
  noiseDb?: number;
};

type BoundTone = ReturnType<typeof fromContext>;
type ToneLike = typeof Tone | BoundTone;

type KickOverrideSource = Pick<
  Chunk,
  "kickPitchDecay" | "kickOctaves" | "kickDecay" | "kickRelease" | "kickNoiseDb"
>;

export interface CreateKickOptions {
  tone?: ToneLike;
  overrides?: Partial<KickDefaults>;
}

const NOISE_MUTE_THRESHOLD_DB = -60;

export function extractKickOverrides(
  source?: Partial<KickOverrideSource> | null
): Partial<KickDefaults> | undefined {
  if (!source) return undefined;
  const overrides: Partial<KickDefaults> = {};
  if (typeof source.kickPitchDecay === "number") {
    overrides.pitchDecay = source.kickPitchDecay;
  }
  if (typeof source.kickOctaves === "number") {
    overrides.octaves = source.kickOctaves;
  }
  if (typeof source.kickDecay === "number") {
    overrides.decay = source.kickDecay;
  }
  if (typeof source.kickRelease === "number") {
    overrides.release = source.kickRelease;
  }
  if (typeof source.kickNoiseDb === "number") {
    overrides.noiseDb = source.kickNoiseDb;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function resolveKickCharacter(packId: string, characterId: string): InstrumentCharacter {
  const pack = packs.find((packDef: Pack) => packDef.id === packId);
  if (!pack) throw new Error(`[kick] pack not found: ${packId}`);
  const instrument = pack.instruments?.["kick"];
  if (!instrument) throw new Error(`[kick] kick not found in pack ${packId}`);
  let char = instrument.characters.find((character: InstrumentCharacter) => character.id === characterId);
  if (!char && instrument.defaultCharacterId) {
    char = instrument.characters.find((character: InstrumentCharacter) => character.id === instrument.defaultCharacterId);
  }
  if (!char) char = instrument.characters[0];
  return char;
}

function resolveKickDefaults(character: InstrumentCharacter): KickDefaults {
  const defaults = character.defaults as Partial<KickDefaults> | undefined;
  if (!defaults) {
    throw new Error(`[kick] defaults missing for character ${character.id}`);
  }

  const { pitchDecay, octaves, decay, release, noiseDb } = defaults;
  if (
    typeof pitchDecay !== "number" ||
    typeof octaves !== "number" ||
    typeof decay !== "number" ||
    typeof release !== "number"
  ) {
    throw new Error(`[kick] invalid defaults for character ${character.id}`);
  }

  return { pitchDecay, octaves, decay, release, noiseDb };
}

export function createKick(
  packId: string,
  characterId: string,
  options?: CreateKickOptions
) {
  const char = resolveKickCharacter(packId, characterId);
  const defaults = resolveKickDefaults(char);
  const tone = options?.tone ?? Tone;
  const params: KickDefaults = {
    ...defaults,
    ...(options?.overrides ?? {}),
  };
  const { pitchDecay, octaves, decay, release, noiseDb } = params;

  const sub = new tone.MembraneSynth({
    pitchDecay,
    octaves,
    oscillator: { type: "sine" },
    envelope: { attack: 0.005, decay, sustain: 0, release },
  }).toDestination();

  let noise: Tone.NoiseSynth | null = null;
  let noiseGain: Tone.Gain | null = null;
  if (typeof noiseDb === "number" && noiseDb > NOISE_MUTE_THRESHOLD_DB) {
    noise = new tone.NoiseSynth({
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
    });
    noiseGain = new tone.Gain(tone.dbToGain(noiseDb)).toDestination();
    noise.connect(noiseGain);
  }

  if (import.meta.env.DEV) {
    console.info("[kick:create]", {
      packId,
      characterId: char.id,
      params,
      overrides: options?.overrides ?? null,
    });
  }

  return {
    triggerAttackRelease(dur: Tone.Unit.Time, time: Tone.Unit.Time, vel?: number) {
      // reset phase for click-free hits
      // @ts-ignore
      if (sub.oscillator && typeof sub.oscillator.phase !== "undefined") {
        // @ts-ignore
        sub.oscillator.phase = 0;
      }
      sub.triggerAttackRelease("C1", dur, time, vel);
      if (noise) noise.triggerAttackRelease(dur, time, vel);
    },
    dispose() {
      noise?.dispose();
      noiseGain?.dispose();
      sub.dispose();
    },
  };
}

declare global {
  interface Window {
    __debugKick?: (packId: string, characterId: string) => string;
  }
}

// @ts-ignore
if (import.meta.env.DEV && typeof window !== "undefined") {
  // Debug helper for console
  window.__debugKick = (packId: string, characterId: string) => {
    const voice = createKick(packId, characterId);
    const when = Tone.now() + 0.05;
    voice.triggerAttackRelease("8n", when, 0.9);
    setTimeout(() => voice.dispose(), 600);
    return `Triggered kick for ${packId}:${characterId}`;
  };
}

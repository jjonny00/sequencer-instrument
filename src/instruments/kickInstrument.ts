import * as Tone from "tone";
import type { fromContext } from "tone/build/esm/fromContext";
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
  tone: ToneLike = Tone
) {
  const char = resolveKickCharacter(packId, characterId);
  const defaults = resolveKickDefaults(char);
  const { pitchDecay, octaves, decay, release, noiseDb } = defaults;

  const sub = new tone.MembraneSynth({
    pitchDecay,
    octaves,
    oscillator: { type: "sine" },
    envelope: { attack: 0.005, decay, sustain: 0, release },
  }).toDestination();

  let noise: Tone.NoiseSynth | null = null;
  let noiseGain: Tone.Gain | null = null;
  if (typeof noiseDb === "number" && noiseDb > -36) {
    noise = new tone.NoiseSynth({
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 },
    });
    noiseGain = new tone.Gain(tone.dbToGain(noiseDb)).toDestination();
    noise.connect(noiseGain);
  }

  if (import.meta.env.DEV) {
    console.info("[kick:create]", { packId, characterId: char.id, params: defaults });
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

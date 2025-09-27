import * as Tone from "tone";

import { packs } from "@/packs";
import type { InstrumentCharacter, Pack } from "@/packs";

type KickMacroDefaults = {
  punch: number;
  clean: number;
  tight: number;
};

function resolveKickCharacter(packId: string, characterId: string) {
  const pack = packs.find((candidate: Pack) => candidate.id === packId);
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

function mapKickParams({ punch, clean, tight }: KickMacroDefaults) {
  return {
    pitchDecay: 0.01 + punch * 0.05,
    octaves: 2 + Math.round(punch * 3),
    decay: 0.2 + (1 - clean) * 0.6,
    release: 0.05 + (1 - clean) * 0.2,
    noiseDb: -40 + (1 - tight) * 20,
  };
}

export function createKick(packId: string, characterId: string) {
  const char = resolveKickCharacter(packId, characterId);
  const macroDefaults: KickMacroDefaults = {
    punch: char.defaults?.punch ?? 0.5,
    clean: char.defaults?.clean ?? 0.5,
    tight: char.defaults?.tight ?? 0.5,
  };
  const params = mapKickParams(macroDefaults);

  const sub = new Tone.MembraneSynth({
    pitchDecay: params.pitchDecay,
    octaves: params.octaves,
    oscillator: { type: "sine" },
    envelope: { attack: 0.005, decay: params.decay, sustain: 0, release: params.release }
  }).toDestination();

  let noise: Tone.NoiseSynth | null = null;
  let noiseGain: Tone.Gain | null = null;
  if (params.noiseDb > -36) {
    noise = new Tone.NoiseSynth({
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 }
    });
    noiseGain = new Tone.Gain(Tone.dbToGain(params.noiseDb)).toDestination();
    noise.connect(noiseGain);
  }

  if (import.meta.env.DEV) {
    console.info("[kick:new]", { packId, characterId: char.id, defaults: char.defaults, mapped: params });
  }

  return {
    triggerAttackRelease(dur: Tone.Unit.Time, time: Tone.Unit.Time, vel?: number) {
      // reset oscillator phase for click-free hits
      const oscillator = (sub as { oscillator?: Tone.OmniOscillator<Tone.Oscillator> }).oscillator;
      if (oscillator && typeof oscillator.phase !== "undefined") {
        oscillator.phase = 0;
      }
      sub.triggerAttackRelease("C1", dur, time, vel);
      if (noise) noise.triggerAttackRelease(dur, time, vel);
    },
    dispose() {
      noise?.dispose(); noiseGain?.dispose();
      sub.dispose();
    }
  };
}

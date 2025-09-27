import * as Tone from "tone";
import { packs } from "@/packs";

function resolveKickCharacter(packId: string, characterId: string) {
  const pack = packs.find(p => p.id === packId);
  if (!pack) throw new Error(`[kick] pack not found: ${packId}`);
  const instrument = pack.instruments?.["kick"];
  if (!instrument) throw new Error(`[kick] kick not found in pack ${packId}`);
  let char = instrument.characters.find(c => c.id === characterId);
  if (!char && instrument.defaultCharacterId) {
    char = instrument.characters.find(c => c.id === instrument.defaultCharacterId);
  }
  if (!char) char = instrument.characters[0];
  return char;
}

export function createKick(packId: string, characterId: string) {
  const char = resolveKickCharacter(packId, characterId);
  const { pitchDecay, octaves, decay, release, noiseDb } = char.defaults;

  const sub = new Tone.MembraneSynth({
    pitchDecay,
    octaves,
    oscillator: { type: "sine" },
    envelope: { attack: 0.005, decay, sustain: 0, release }
  }).toDestination();

  let noise: Tone.NoiseSynth | null = null;
  let noiseGain: Tone.Gain | null = null;
  if (typeof noiseDb === "number" && noiseDb > -36) {
    noise = new Tone.NoiseSynth({
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.01 }
    });
    noiseGain = new Tone.Gain(Tone.dbToGain(noiseDb)).toDestination();
    noise.connect(noiseGain);
  }

  if (import.meta.env.DEV) {
    console.info("[kick:create]", { packId, characterId: char.id, params: char.defaults });
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
      noise?.dispose(); noiseGain?.dispose();
      sub.dispose();
    }
  };
}

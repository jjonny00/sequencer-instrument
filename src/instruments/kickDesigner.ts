import * as Tone from "tone";

import { packs } from "../packs";
import {
  DEFAULT_KICK_STATE,
  normalizeKickDesignerState,
} from "./kickState";

export interface KickInstrument {
  triggerAttackRelease: (
    note: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => void;
  dispose: () => void;
}

export function createKick(packId: string, characterId: string): KickInstrument {
  const pack = packs.find((candidate) => candidate.id === packId);
  if (!pack) {
    console.warn(`[kick] Pack '${packId}' not found; using default kick voice.`);
  }

  const instrument = pack?.instruments?.kick;
  if (!instrument) {
    console.warn(
      `[kick] Pack '${packId}' is missing a kick instrument; using default kick voice.`
    );
  }

  let character = instrument?.characters.find((candidate) => candidate.id === characterId);
  if (!character) {
    if (characterId) {
      console.warn(
        `[kick] Character '${characterId}' not found in pack '${packId}', falling back to defaults.`
      );
    }
    const fallbackId = instrument?.defaultCharacterId;
    if (fallbackId) {
      character = instrument?.characters.find((candidate) => candidate.id === fallbackId);
    }
    if (!character && instrument?.characters.length) {
      character = instrument.characters[0];
    }
  }

  const defaults = normalizeKickDesignerState(character?.defaults ?? DEFAULT_KICK_STATE);
  const params = mapKickParams(defaults);

  const sub = new Tone.MembraneSynth({
    pitchDecay: params.sub.pitchDecay,
    octaves: params.sub.octaves,
    oscillator: params.sub.oscillator ?? { type: "sine" },
    envelope: {
      attack: 0.005,
      decay: params.sub.decay,
      sustain: 0,
      release: params.sub.release,
    },
  }).toDestination();

  let noise: Tone.NoiseSynth | null = null;
  let noiseGain: Tone.Gain | null = null;

  if (params.noiseDb > -30) {
    noise = new Tone.NoiseSynth({
      envelope: {
        attack: 0.001,
        decay: 0.02,
        sustain: 0,
        release: 0.01,
      },
    });
    noiseGain = new Tone.Gain({ gain: Tone.dbToGain(params.noiseDb) }).toDestination();
    noise.connect(noiseGain);
  }

  return {
    triggerAttackRelease(_note, duration, time, velocity) {
      if (time === undefined) {
        console.warn(
          "[kick] triggerAttackRelease called without a scheduled time; defaulting to immediate playback."
        );
      }
      const scheduledTime = time ?? Tone.now();
      const resolvedDuration = duration ?? "8n";
      const resolvedVelocity = velocity ?? 0.9;

      sub.oscillator.phase = 0;
      sub.triggerAttackRelease("C1", resolvedDuration, scheduledTime, resolvedVelocity);

      if (noise) {
        noise.triggerAttackRelease("8n", scheduledTime, resolvedVelocity);
      }
    },
    dispose() {
      sub.dispose();
      noise?.dispose();
      noiseGain?.dispose();
    },
  };
}

function mapKickParams({
  punch,
  clean,
  tight,
}: {
  punch: number;
  clean: number;
  tight: number;
}) {
  const p = Math.max(0, Math.min(1, punch));
  const c = Math.max(0, Math.min(1, clean));
  const t = Math.max(0, Math.min(1, tight));
  return {
    sub: {
      pitchDecay: 0.01 + p * 0.02,
      octaves: 2 + Math.round(p * 2),
      decay: 0.25 + (1 - c) * 0.25,
      release: 0.05 + (1 - c) * 0.1,
      oscillator: { type: "sine" as const },
    },
    noiseDb: -30 + (1 - t) * 10,
  } as const;
}

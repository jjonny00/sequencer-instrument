import * as Tone from "tone";

import { packs } from "@/soundpacks";
import { DEFAULT_KICK_STATE } from "./kickState";

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
  const pack = packs[packId];
  if (!pack) {
    console.warn("[kick] pack not found", { packId, characterId });
    return createKickFromParams(mapKickParams(DEFAULT_KICK_STATE));
  }

  const instrument = pack.instruments?.kick;
  if (!instrument) {
    console.warn("[kick] kick instrument missing", { packId, characterId });
    return createKickFromParams(mapKickParams(DEFAULT_KICK_STATE));
  }

  let character = instrument.characters.find((candidate) => candidate.id === characterId);

  if (!character && instrument.defaultCharacterId) {
    character = instrument.characters.find(
      (candidate) => candidate.id === instrument.defaultCharacterId
    );
  }

  if (!character) {
    console.warn("[kick] could not resolve character", { packId, characterId });
    return createKickFromParams(mapKickParams(DEFAULT_KICK_STATE));
  }

  const {
    punch = DEFAULT_KICK_STATE.punch,
    clean = DEFAULT_KICK_STATE.clean,
    tight = DEFAULT_KICK_STATE.tight,
  } = character.defaults ?? {};

  return createKickFromParams(
    mapKickParams({
      punch,
      clean,
      tight,
    })
  );
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

function createKickFromParams(params: ReturnType<typeof mapKickParams>): KickInstrument {
  const output = new Tone.Gain().toDestination();

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
  }).connect(output);

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

    noiseGain = new Tone.Gain({ gain: Tone.dbToGain(params.noiseDb) });
    noise.connect(noiseGain);
    noiseGain.connect(output);
  }

  return {
    triggerAttackRelease(_note, duration, time, velocity) {
      const resolvedDuration = duration ?? "8n";
      const resolvedVelocity = velocity ?? 0.9;

      sub.oscillator.phase = 0;
      sub.triggerAttackRelease("C1", resolvedDuration, time, resolvedVelocity);

      if (noise) {
        noise.triggerAttackRelease("8n", time, resolvedVelocity);
      }
    },
    dispose() {
      sub.dispose();
      noise?.dispose();
      noiseGain?.dispose();
      output.dispose();
    },
  };
}

import * as Tone from "tone";

import { packs } from "../packs";
import {
  DEFAULT_KICK_STATE,
  normalizeKickDesignerState,
} from "./kickState";

export type KickInstrument = Tone.Gain & {
  triggerAttackRelease: (
    note?: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => void;
  dispose: () => void;
};

export function createKick(packId: string, characterId: string): KickInstrument {
  const pack = packs.find((candidate) => candidate.id === packId);
  if (!pack) {
    console.warn(`createKick: pack '${packId}' not found.`);
  }

  const instrument = pack?.instruments?.kick;
  if (!instrument) {
    console.warn(`createKick: kick instrument missing for pack '${packId}'.`);
  }

  let character = instrument?.characters.find((c) => c.id === characterId);
  if (!character) {
    if (characterId) {
      console.warn(
        `createKick: character '${characterId}' not found in pack '${packId}', using default.`
      );
    }
    if (instrument?.defaultCharacterId) {
      character = instrument.characters.find(
        (candidate) => candidate.id === instrument.defaultCharacterId
      );
    }
    if (!character && instrument?.characters.length) {
      character = instrument.characters[0];
    }
  }

  const defaults = normalizeKickDesignerState(character?.defaults ?? DEFAULT_KICK_STATE);
  const params = mapKickParams(defaults);

  const output = new Tone.Gain(1) as KickInstrument;

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
  });
  sub.connect(output);

  let click: Tone.NoiseSynth | null = null;
  let clickGain: Tone.Gain | null = null;

  if (params.noiseDb > -30) {
    click = new Tone.NoiseSynth({
      envelope: {
        attack: 0.001,
        decay: 0.02,
        sustain: 0,
        release: 0.01,
      },
    });
    clickGain = new Tone.Gain({ gain: Tone.dbToGain(params.noiseDb) });
    click.connect(clickGain);
    clickGain.connect(output);
  }

  output.triggerAttackRelease = (
    _note?: Tone.Unit.Frequency,
    duration?: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity?: number
  ) => {
    const scheduledTime = time;
    const resolvedDuration = duration ?? "16n";
    const resolvedVelocity = velocity ?? 1;

    // reset oscillator phase for consistent attack
    sub.oscillator.phase = 0;
    sub.triggerAttackRelease("C1", resolvedDuration, scheduledTime, resolvedVelocity);

    if (click) {
      click.triggerAttackRelease(0.02, scheduledTime, resolvedVelocity);
    }
  };

  const originalDispose = output.dispose.bind(output);
  output.dispose = () => {
    sub.dispose();
    click?.dispose();
    clickGain?.dispose();
    return originalDispose();
  };

  return output;
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

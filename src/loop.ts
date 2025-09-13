import * as Tone from "tone";

export function startStarterLoop(
  kick: Tone.MembraneSynth,
  snare: Tone.NoiseSynth,
  hat: Tone.MetalSynth
) {
  const kickSeq = new Tone.Sequence(
    (time, step) => {
      if (step) kick.triggerAttackRelease("C2", "8n", time);
    },
    [1, 0, 1, 0, 1, 0, 1, 0], // 8th notes over 1 bar
    "8n"
  ).start(0);

  const snareSeq = new Tone.Sequence(
    (time, step) => {
      if (step) snare.triggerAttackRelease("16n", time);
    },
    [0, 0, 1, 0, 0, 0, 1, 0], // backbeat on 2 & 4
    "8n"
  ).start(0);

  const hatSeq = new Tone.Sequence(
    (time, step) => {
      if (step) hat.triggerAttackRelease("32n", time);
    },
    [1, 1, 1, 1, 1, 1, 1, 1], // straight 8ths
    "8n"
  ).start(0);

  return () => {
    kickSeq.dispose();
    snareSeq.dispose();
    hatSeq.dispose();
  };
}
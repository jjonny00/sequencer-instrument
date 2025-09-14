export interface Chunk {
  id: string;
  name: string;
  instrument: string;
  steps: number[];
  note: string;
  velocity: number;
}

export const presets: Record<string, Chunk> = {
  kick: {
    id: "kick-basic",
    name: "Kick Basic",
    instrument: "kick",
    steps: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    note: "C2",
    velocity: 0.9,
  },
  snare: {
    id: "snare-backbeat",
    name: "Backbeat Snare",
    instrument: "snare",
    steps: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    note: "D2",
    velocity: 0.8,
  },
  hat: {
    id: "hihat-straight",
    name: "Straight Hi-Hat",
    instrument: "hat",
    steps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    note: "F#3",
    velocity: 0.6,
  },
};

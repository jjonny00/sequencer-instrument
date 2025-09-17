import type { Chunk } from "./chunks";

type TimingMode = Exclude<Chunk["timingMode"], undefined>;

export interface ArpPreset {
  id: string;
  name: string;
  description?: string;
  settings: Partial<
    Pick<
      Chunk,
      | "style"
      | "timingMode"
      | "arpRate"
      | "arpGate"
      | "arpOctaves"
      | "arpFreeRate"
      | "useExtensions"
      | "autopilot"
      | "reverb"
      | "distortion"
      | "bitcrusher"
    >
  >;
}

export const ARP_PRESETS: ArpPreset[] = [
  {
    id: "sync-sparkle",
    name: "Sync Sparkle",
    description: "Snappy up/down arp with shimmer",
    settings: {
      timingMode: "sync" as TimingMode,
      style: "up-down",
      arpRate: "8n",
      arpGate: 0.55,
      arpOctaves: 2,
      useExtensions: true,
      reverb: 0.35,
      distortion: 0.1,
      bitcrusher: 0.05,
    },
  },
  {
    id: "free-glide",
    name: "Free Glide",
    description: "Loose random flow with long tails",
    settings: {
      timingMode: "free" as TimingMode,
      style: "random",
      arpFreeRate: 420,
      arpGate: 0.8,
      arpOctaves: 3,
      useExtensions: true,
      reverb: 0.6,
      distortion: 0.05,
      bitcrusher: 0.12,
    },
  },
  {
    id: "mono-pulse",
    name: "Mono Pulse",
    description: "Tight single-octave driver",
    settings: {
      timingMode: "sync" as TimingMode,
      style: "up",
      arpRate: "16n",
      arpGate: 0.45,
      arpOctaves: 1,
      useExtensions: false,
      reverb: 0.2,
      distortion: 0.2,
      bitcrusher: 0.08,
    },
  },
];

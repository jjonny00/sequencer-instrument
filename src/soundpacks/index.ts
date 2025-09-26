import type { Pack } from "../packs";
import { packs as packList } from "../packs";

export type SoundpackRegistry = Record<string, Pack>;

export const packs: SoundpackRegistry = packList.reduce<SoundpackRegistry>(
  (registry, pack) => {
    registry[pack.id] = pack;
    return registry;
  },
  {}
);

export const packArray = packList;

export type { Pack };

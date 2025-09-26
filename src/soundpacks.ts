import type { Pack } from "./packs";
import { packs as packList } from "./packs";

export const packs: Record<string, Pack> = packList.reduce<Record<string, Pack>>(
  (acc, pack) => {
    acc[pack.id] = pack;
    return acc;
  },
  {}
);

export type { Pack };

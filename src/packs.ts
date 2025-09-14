import type { Chunk } from "./chunks";

export interface InstrumentSpec {
  type: string;
  note?: string;
}

export interface Pack {
  id: string;
  name: string;
  instruments: Record<string, InstrumentSpec>;
  chunks: Chunk[];
}

const packModules = import.meta.glob("./packs/*.json", {
  eager: true,
  import: "default",
}) as Record<string, Pack>;

export const packs: Pack[] = Object.values(packModules);

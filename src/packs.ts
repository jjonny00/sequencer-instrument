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

import phonk from "./packs/phonk.json" assert { type: "json" };
import edm from "./packs/early-2000s-edm.json" assert { type: "json" };
import kraftwerk from "./packs/kraftwerk.json" assert { type: "json" };

export const packs: Pack[] = [
  phonk as Pack,
  edm as Pack,
  kraftwerk as Pack,
];

import type { Chunk } from "./chunks";
export interface InstrumentSpec {
  type?: string;
  note?: string;
  options?: Record<string, unknown>;
  effects?: EffectSpec[];
}

export interface InstrumentCharacter extends InstrumentSpec {
  id: string;
  name: string;
  description?: string;
  defaults?: Record<string, unknown>;
}

export interface InstrumentDefinition {
  id?: string;
  name?: string;
  defaultCharacterId?: string;
  characters: InstrumentCharacter[];
  defaultPatternId?: string;
  patterns?: InstrumentPatternPreset[];
}

export interface InstrumentPatternPreset {
  id: string;
  name: string;
  description?: string;
  degrees?: number[];
  steps?: number[];
  velocities?: number[];
}

export interface EffectSpec {
  type: string;
  options?: Record<string, unknown>;
}

export interface Pack {
  id: string;
  name: string;
  instruments: Record<string, InstrumentDefinition>;
  chunks: Chunk[];
}

const packModules = import.meta.glob("./packs/*.json", {
  eager: true,
  import: "default",
}) as Record<string, Pack>;

export const packs: Pack[] = Object.values(packModules);

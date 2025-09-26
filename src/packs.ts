import type { Chunk } from "./chunks";
import type { KickDesignerState } from "./instruments/kickDesigner";

export interface InstrumentSpec {
  type?: string;
  note?: string;
  options?: Record<string, unknown>;
  effects?: EffectSpec[];
}

export interface KickLayerSpec extends InstrumentSpec {
  duration?: string | number;
  velocity?: number;
  volume?: number;
  transpose?: number;
  fadeIn?: number;
  fadeOut?: number;
  envelope?: {
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
  };
  startOffset?: number;
}

export interface InstrumentCharacter extends InstrumentSpec {
  id: string;
  name: string;
  description?: string;
  defaults?: Partial<KickDesignerState>;
  layers?: KickLayerSpec[];
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
  punch?: number;
  clean?: number;
  tight?: number;
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

import type { Chunk } from "./chunks";
import type {
  KickDesignerState,
  KickDesignerStyleConfig,
} from "./instruments/kickDesigner";

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
  defaults?: Partial<KickDesignerState>;
  kick?: KickDesignerStyleConfig;
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

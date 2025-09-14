import type { Pattern } from "./patterns";

export type TriggerMap = Record<string, (time: number) => void>;

export interface Track {
  id: number;
  name: string;
  instrument: keyof TriggerMap;
  pattern: Pattern | null;
}

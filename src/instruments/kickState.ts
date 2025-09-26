import type { Chunk } from "../chunks";

export interface KickDesignerState {
  punch: number;
  clean: number;
  tight: number;
}

export const DEFAULT_KICK_STATE: KickDesignerState = {
  punch: 0.5,
  clean: 0.5,
  tight: 0.5,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const normalizeKickDesignerState = (
  state?: Partial<KickDesignerState> | null
): KickDesignerState => ({
  punch: clamp(state?.punch ?? DEFAULT_KICK_STATE.punch, 0, 1),
  clean: clamp(state?.clean ?? DEFAULT_KICK_STATE.clean, 0, 1),
  tight: clamp(state?.tight ?? DEFAULT_KICK_STATE.tight, 0, 1),
});

export const mergeKickDesignerState = (
  defaults: Partial<KickDesignerState> | null | undefined,
  overrides: Partial<KickDesignerState> | null | undefined
): KickDesignerState =>
  normalizeKickDesignerState({
    punch: overrides?.punch ?? defaults?.punch,
    clean: overrides?.clean ?? defaults?.clean,
    tight: overrides?.tight ?? defaults?.tight,
  });

export const applyKickDefaultsToChunk = (
  chunk: Chunk,
  defaults: Partial<KickDesignerState> | null | undefined
): Chunk => {
  const state = mergeKickDesignerState(defaults, {
    punch: chunk.punch,
    clean: chunk.clean,
    tight: chunk.tight,
  });
  return {
    ...chunk,
    punch: state.punch,
    clean: state.clean,
    tight: state.tight,
  };
};


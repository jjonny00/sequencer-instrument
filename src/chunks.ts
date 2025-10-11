export type PulseShape = "sine" | "square" | "triangle";
export type PulseMode = "LFO" | "Pattern" | "Random";
export type PulseFilterType = "lowpass" | "bandpass" | "highpass";
export type PulseMotionTarget = "cutoff" | "resonance" | "amp";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export interface PulsePatternStep {
  active: boolean;
  velocity: number;
  probability: number;
}

export const DEFAULT_PULSE_MODE: PulseMode = "LFO";
export const DEFAULT_PULSE_RATE = "8n";
export const DEFAULT_PULSE_DEPTH = 0.9;
export const DEFAULT_PULSE_SHAPE: PulseShape = "square";
export const DEFAULT_PULSE_FILTER_ENABLED = false;
export const DEFAULT_PULSE_FILTER_TYPE: PulseFilterType = "lowpass";
export const DEFAULT_PULSE_RESONANCE = 0.35;
export const DEFAULT_PULSE_MOTION_RATE = "2n";
export const DEFAULT_PULSE_MOTION_DEPTH = 0.3;
export const DEFAULT_PULSE_MOTION_TARGET: PulseMotionTarget = "cutoff";
export const DEFAULT_PULSE_PATTERN_LENGTH = 8;
export const DEFAULT_PULSE_SWING = 0;
export const DEFAULT_PULSE_HUMANIZE = 0;

const createPulsePatternStep = (
  active: boolean,
  velocity = 1,
  probability = 1
): PulsePatternStep => ({
  active,
  velocity: clamp01(Number.isFinite(velocity) ? velocity : 1),
  probability: clamp01(Number.isFinite(probability) ? probability : 1),
});

export const createDefaultPulsePattern = (
  length: number
): PulsePatternStep[] =>
  Array.from({ length }, (_value, index) =>
    createPulsePatternStep(index % 2 === 0, 1, 1)
  );

export const DEFAULT_PULSE_PATTERN = createDefaultPulsePattern(
  DEFAULT_PULSE_PATTERN_LENGTH
);

export interface PulseChunkSettings {
  pulseMode?: PulseMode;
  pulseRate?: string;
  pulseDepth?: number;
  pulseShape?: PulseShape;
  pulseFilter?: boolean;
  pulseFilterEnabled?: boolean;
  pulseFilterType?: PulseFilterType;
  pulseResonance?: number;
  pulseMotionRate?: string;
  pulseMotionDepth?: number;
  pulseMotionTarget?: PulseMotionTarget;
  pulsePattern?: PulsePatternStep[];
  pulsePatternLength?: number;
  pulseSwing?: number;
  pulseHumanize?: number;
}

export interface NoteEvent {
  time: number;
  duration: number;
  note: string;
  velocity: number;
}

export interface Chunk {
  id: string;
  name: string;
  instrument: string;
  characterId?: string;
  steps: number[];
  velocities?: number[];
  pitches?: number[];
  stepDurations?: number[];
  note?: string;
  sustain?: number;
  plucky?: boolean;
  attack?: number;
  glide?: number;
  pan?: number;
  reverb?: number;
  delay?: number;
  distortion?: number;
  bitcrusher?: number;
  filter?: number;
  chorus?: number;
  timingMode?: "sync" | "free";
  tonalCenter?: string;
  scale?: string;
  degree?: number;
  velocityFactor?: number;
  pitchOffset?: number;
  swing?: number;
  humanize?: number;
  notes?: string[];
  degrees?: number[];
  pitchBend?: number;
  style?: string;
  mode?: string;
  arpRate?: string;
  arpGate?: number;
  arpLatch?: boolean;
  arpOctaves?: number;
  arpFreeRate?: number;
  useExtensions?: boolean;
  autopilot?: boolean;
  noteEvents?: NoteEvent[];
  noteLoopLength?: number;
  pulseMode?: PulseMode;
  pulseRate?: string;
  pulseDepth?: number;
  pulseShape?: PulseShape;
  pulseFilter?: boolean;
  pulseFilterEnabled?: boolean;
  pulseFilterType?: PulseFilterType;
  pulseResonance?: number;
  pulseMotionRate?: string;
  pulseMotionDepth?: number;
  pulseMotionTarget?: PulseMotionTarget;
  pulsePattern?: PulsePatternStep[];
  pulsePatternLength?: number;
  pulseSwing?: number;
  pulseHumanize?: number;
  harmoniaComplexity?: "simple" | "extended" | "lush";
  harmoniaTone?: number;
  harmoniaDynamics?: number;
  harmoniaBass?: boolean;
  harmoniaArp?: boolean;
  harmoniaPatternId?: string;
  harmoniaBorrowedLabel?: string;
  harmoniaStepDegrees?: (number | null)[];
}

const isPulseShape = (value: unknown): value is PulseShape =>
  value === "sine" || value === "square" || value === "triangle";

const isPulseMode = (value: unknown): value is PulseMode =>
  value === "LFO" || value === "Pattern" || value === "Random";

const isPulseFilterType = (value: unknown): value is PulseFilterType =>
  value === "lowpass" || value === "bandpass" || value === "highpass";

const isPulseMotionTarget = (value: unknown): value is PulseMotionTarget =>
  value === "cutoff" || value === "resonance" || value === "amp";

const sanitizePulsePatternStep = (value: unknown): PulsePatternStep => {
  if (typeof value === "number") {
    const active = value > 0;
    return createPulsePatternStep(active, 1, 1);
  }
  if (value && typeof value === "object") {
    const raw = value as Partial<PulsePatternStep>;
    const active = Boolean(raw.active);
    const velocity =
      typeof raw.velocity === "number" && Number.isFinite(raw.velocity)
        ? clamp01(raw.velocity)
        : 1;
    const probability =
      typeof raw.probability === "number" && Number.isFinite(raw.probability)
        ? clamp01(raw.probability)
        : 1;
    return createPulsePatternStep(active, velocity, probability);
  }
  return createPulsePatternStep(false, 1, 1);
};

export const normalizePulsePattern = (
  pattern: PulsePatternStep[] | number[] | undefined,
  length: number
): PulsePatternStep[] => {
  if (!Array.isArray(pattern) || pattern.length === 0) {
    return createDefaultPulsePattern(length);
  }
  if (pattern.length === length) {
    return pattern.map((step) => sanitizePulsePatternStep(step));
  }
  const normalized: PulsePatternStep[] = [];
  for (let i = 0; i < length; i += 1) {
    const ratio = pattern.length / length;
    const sourceIndex = Math.floor(i * ratio);
    normalized.push(sanitizePulsePatternStep(pattern[sourceIndex]));
  }
  return normalized;
};

export const ensurePulseDefaults = (chunk: Chunk): Chunk => {
  if (chunk.instrument !== "pulse") {
    return chunk;
  }

  let changed = false;
  const next: Partial<Chunk> = {};

  if (!isPulseMode(chunk.pulseMode)) {
    next.pulseMode = DEFAULT_PULSE_MODE;
    changed = true;
  }
  if (typeof chunk.pulseRate !== "string") {
    next.pulseRate = DEFAULT_PULSE_RATE;
    changed = true;
  }
  if (typeof chunk.pulseDepth !== "number" || Number.isNaN(chunk.pulseDepth)) {
    next.pulseDepth = DEFAULT_PULSE_DEPTH;
    changed = true;
  } else {
    const clamped = clamp01(chunk.pulseDepth);
    if (clamped !== chunk.pulseDepth) {
      next.pulseDepth = clamped;
      changed = true;
    }
  }
  if (!isPulseShape(chunk.pulseShape)) {
    next.pulseShape = DEFAULT_PULSE_SHAPE;
    changed = true;
  }
  if (typeof chunk.pulseFilterEnabled !== "boolean") {
    next.pulseFilterEnabled =
      typeof chunk.pulseFilter === "boolean"
        ? chunk.pulseFilter
        : DEFAULT_PULSE_FILTER_ENABLED;
    changed = true;
  }
  if (!isPulseFilterType(chunk.pulseFilterType)) {
    next.pulseFilterType = DEFAULT_PULSE_FILTER_TYPE;
    changed = true;
  }
  if (
    typeof chunk.pulseResonance !== "number" ||
    Number.isNaN(chunk.pulseResonance)
  ) {
    next.pulseResonance = DEFAULT_PULSE_RESONANCE;
    changed = true;
  } else {
    const clamped = clamp01(chunk.pulseResonance);
    if (clamped !== chunk.pulseResonance) {
      next.pulseResonance = clamped;
      changed = true;
    }
  }

  if (typeof chunk.pulseMotionRate !== "string") {
    next.pulseMotionRate = DEFAULT_PULSE_MOTION_RATE;
    changed = true;
  }
  if (
    typeof chunk.pulseMotionDepth !== "number" ||
    Number.isNaN(chunk.pulseMotionDepth)
  ) {
    next.pulseMotionDepth = DEFAULT_PULSE_MOTION_DEPTH;
    changed = true;
  } else {
    const clamped = clamp01(chunk.pulseMotionDepth);
    if (clamped !== chunk.pulseMotionDepth) {
      next.pulseMotionDepth = clamped;
      changed = true;
    }
  }
  if (!isPulseMotionTarget(chunk.pulseMotionTarget)) {
    next.pulseMotionTarget = DEFAULT_PULSE_MOTION_TARGET;
    changed = true;
  }

  const requestedLength =
    chunk.pulsePatternLength === 16
      ? 16
      : chunk.pulsePatternLength === 8
      ? 8
      : DEFAULT_PULSE_PATTERN_LENGTH;

  if (chunk.pulsePatternLength !== requestedLength) {
    next.pulsePatternLength = requestedLength;
    changed = true;
  }

  if (!Array.isArray(chunk.pulsePattern) || chunk.pulsePattern.length === 0) {
    next.pulsePattern = createDefaultPulsePattern(requestedLength);
    changed = true;
  } else if (chunk.pulsePattern.length !== requestedLength) {
    next.pulsePattern = normalizePulsePattern(chunk.pulsePattern, requestedLength);
    changed = true;
  }

  if (
    typeof chunk.pulseSwing !== "number" ||
    Number.isNaN(chunk.pulseSwing)
  ) {
    next.pulseSwing = DEFAULT_PULSE_SWING;
    changed = true;
  } else {
    const clamped = clamp01(chunk.pulseSwing);
    if (clamped !== chunk.pulseSwing) {
      next.pulseSwing = clamped;
      changed = true;
    }
  }

  if (
    typeof chunk.pulseHumanize !== "number" ||
    Number.isNaN(chunk.pulseHumanize)
  ) {
    next.pulseHumanize = DEFAULT_PULSE_HUMANIZE;
    changed = true;
  } else {
    const clamped = clamp01(chunk.pulseHumanize);
    if (clamped !== chunk.pulseHumanize) {
      next.pulseHumanize = clamped;
      changed = true;
    }
  }

  return changed ? { ...chunk, ...next } : chunk;
};

export const applyPulseCharacterDefaults = (
  chunk: Chunk,
  defaults?: PulseChunkSettings | Record<string, unknown> | null
): Chunk => {
  if (chunk.instrument !== "pulse" || !defaults) {
    return chunk;
  }

  const source = defaults as PulseChunkSettings;
  const next: Partial<Chunk> = {};

  if (isPulseMode(source.pulseMode)) {
    next.pulseMode = source.pulseMode;
  }
  if (typeof source.pulseRate === "string") {
    next.pulseRate = source.pulseRate;
  }
  if (typeof source.pulseDepth === "number" && Number.isFinite(source.pulseDepth)) {
    next.pulseDepth = clamp01(source.pulseDepth);
  }
  if (isPulseShape(source.pulseShape)) {
    next.pulseShape = source.pulseShape;
  }
  if (typeof source.pulseFilter === "boolean") {
    next.pulseFilterEnabled = source.pulseFilter;
  }
  if (typeof source.pulseFilterEnabled === "boolean") {
    next.pulseFilterEnabled = source.pulseFilterEnabled;
  }
  if (isPulseFilterType(source.pulseFilterType)) {
    next.pulseFilterType = source.pulseFilterType;
  }
  if (
    typeof source.pulseResonance === "number" &&
    Number.isFinite(source.pulseResonance)
  ) {
    next.pulseResonance = clamp01(source.pulseResonance);
  }
  if (typeof source.pulseMotionRate === "string") {
    next.pulseMotionRate = source.pulseMotionRate;
  }
  if (
    typeof source.pulseMotionDepth === "number" &&
    Number.isFinite(source.pulseMotionDepth)
  ) {
    next.pulseMotionDepth = clamp01(source.pulseMotionDepth);
  }
  if (isPulseMotionTarget(source.pulseMotionTarget)) {
    next.pulseMotionTarget = source.pulseMotionTarget;
  }
  if (Array.isArray(source.pulsePattern) && source.pulsePattern.length > 0) {
    const length = next.pulsePatternLength ??
      (source.pulsePatternLength === 16 ? 16 : source.pulsePatternLength === 8 ? 8 : source.pulsePattern.length);
    next.pulsePattern = normalizePulsePattern(source.pulsePattern, length);
    next.pulsePatternLength = length;
  }
  if (
    typeof source.pulsePatternLength === "number" &&
    (source.pulsePatternLength === 8 || source.pulsePatternLength === 16)
  ) {
    next.pulsePatternLength = source.pulsePatternLength;
    if (Array.isArray(source.pulsePattern) && source.pulsePattern.length > 0) {
      next.pulsePattern = normalizePulsePattern(
        source.pulsePattern,
        source.pulsePatternLength
      );
    }
  }
  if (typeof source.pulseSwing === "number" && Number.isFinite(source.pulseSwing)) {
    next.pulseSwing = clamp01(source.pulseSwing);
  }
  if (
    typeof source.pulseHumanize === "number" &&
    Number.isFinite(source.pulseHumanize)
  ) {
    next.pulseHumanize = clamp01(source.pulseHumanize);
  }

  return Object.keys(next).length > 0 ? { ...chunk, ...next } : chunk;
};

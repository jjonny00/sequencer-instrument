const BASE_INSTRUMENT_COLORS: Record<string, string> = {
  kick: "#e74c3c",
  snare: "#3498db",
  hihat: "#f1c40f",
  bass: "#1abc9c",
  keyboard: "#2ecc71",
  arp: "#9b59b6",
  pulse: "#ff6bd6",
};

export const FALLBACK_INSTRUMENT_COLOR = "#27E0B0";

const normalizeHex = (hex: string) => hex.trim().replace(/^#/, "");

const expandHex = (value: string) =>
  value.length === 3
    ? value
        .split("")
        .map((char) => char + char)
        .join("")
    : value;

const isValidHex = (value: string) => /^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(value);

const toRgbTuple = (value: string) => {
  const intValue = parseInt(value, 16);
  return {
    r: (intValue >> 16) & 0xff,
    g: (intValue >> 8) & 0xff,
    b: intValue & 0xff,
  };
};

export const lightenColor = (hex: string, amount: number) => {
  const normalized = normalizeHex(hex);
  if (!isValidHex(normalized)) {
    return hex;
  }
  const value = expandHex(normalized);
  const { r, g, b } = toRgbTuple(value);
  const delta = Math.round(255 * amount);
  const clamp = (component: number) => Math.max(0, Math.min(255, component + delta));
  const next = (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
  return `#${next.toString(16).padStart(6, "0")}`;
};

export const hexToRgba = (hex: string, alpha: number) => {
  const normalized = normalizeHex(hex);
  if (!isValidHex(normalized)) {
    return hex;
  }
  const value = expandHex(normalized);
  const { r, g, b } = toRgbTuple(value);
  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${boundedAlpha})`;
};

export const getInstrumentColor = (instrumentId: string | null | undefined) =>
  instrumentId && BASE_INSTRUMENT_COLORS[instrumentId]
    ? BASE_INSTRUMENT_COLORS[instrumentId]
    : FALLBACK_INSTRUMENT_COLOR;

export const withAlpha = (hex: string, alpha: number) => hexToRgba(hex, alpha);

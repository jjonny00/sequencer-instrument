const CUSTOM_LABELS: Record<string, string> = {
  keyboard: "Keyboard",
  arp: "Arp",
  hihat: "Hi-Hat",
};

export const formatInstrumentLabel = (value: string) => {
  const custom = CUSTOM_LABELS[value];
  if (custom) return custom;
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};


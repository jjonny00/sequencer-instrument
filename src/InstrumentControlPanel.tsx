import type { FC } from "react";
import { useMemo } from "react";

import type { Chunk } from "./chunks";
import type { Track } from "./tracks";
import { formatInstrumentLabel } from "./utils/instrument";
import { filterValueToFrequency } from "./utils/audio";

interface InstrumentControlPanelProps {
  track: Track;
  onUpdatePattern?: (updater: (pattern: Chunk) => Chunk) => void;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue?: (value: number) => string;
  onChange?: (value: number) => void;
}

const Slider: FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}) => {
  const display = formatValue
    ? formatValue(value)
    : value % 1 === 0
      ? value.toFixed(0)
      : value.toFixed(2);

  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
        color: onChange ? "#e6f2ff" : "#475569",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 600,
        }}
      >
        <span>{label}</span>
        <span style={{ color: "#94a3b8" }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange?.(Number(event.target.value))}
        disabled={!onChange}
        style={{
          width: "100%",
          accentColor: "#27E0B0",
          opacity: onChange ? 1 : 0.4,
          cursor: onChange ? "pointer" : "not-allowed",
        }}
      />
    </label>
  );
};

const Section: FC<{ title: string }> = ({ title, children }) => (
  <div
    style={{
      borderRadius: 12,
      border: "1px solid #2a3344",
      background: "#121827",
      padding: 16,
      display: "flex",
      flexDirection: "column",
      gap: 16,
    }}
  >
    <span style={{ fontWeight: 700, letterSpacing: 0.6 }}>{title}</span>
    {children}
  </div>
);

const isPercussiveInstrument = (instrument: string) =>
  ["kick", "snare", "hat", "cowbell"].includes(instrument);

export const InstrumentControlPanel: FC<InstrumentControlPanelProps> = ({
  track,
  onUpdatePattern,
}) => {
  const pattern = track.pattern;
  const instrumentLabel = formatInstrumentLabel(track.instrument ?? "");
  const isPercussive = isPercussiveInstrument(track.instrument ?? "");
  const isBass = track.instrument === "bass";
  const isArp = track.instrument === "arpeggiator";
  const isKeyboard = track.instrument === "chord";

  const filterFrequency = useMemo(() => {
    if (!pattern?.filter && pattern?.filter !== 0) return null;
    return filterValueToFrequency(pattern.filter ?? 0);
  }, [pattern?.filter]);

  if (!pattern) {
    return (
      <div
        style={{
          borderRadius: 12,
          border: "1px solid #2a3344",
          padding: 24,
          textAlign: "center",
          color: "#94a3b8",
          fontSize: 13,
        }}
      >
        This track doesn't have a pattern yet. Add some steps to unlock
        instrument controls.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Section title={`${instrumentLabel} Settings`}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 12,
            color: "#94a3b8",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Instrument</span>
            <span style={{ color: "#e6f2ff" }}>{instrumentLabel}</span>
          </div>
          {track.source?.characterId ? (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Character</span>
              <span style={{ color: "#e6f2ff" }}>
                {formatInstrumentLabel(track.source.characterId)}
              </span>
            </div>
          ) : null}
        </div>
      </Section>

      {isPercussive ? (
        <Section title="Parameters">
          <Slider
            label="Velocity"
            min={0}
            max={2}
            step={0.01}
            value={pattern.velocityFactor ?? 1}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={onUpdatePattern ? (value) => onUpdatePattern((chunk) => ({
                  ...chunk,
                  velocityFactor: value,
                })) : undefined}
          />
          <Slider
            label="Pitch"
            min={-12}
            max={12}
            step={1}
            value={pattern.pitchOffset ?? 0}
            formatValue={(value) => `${value > 0 ? "+" : ""}${value} st`}
            onChange={onUpdatePattern ? (value) => onUpdatePattern((chunk) => ({
                  ...chunk,
                  pitchOffset: value,
                })) : undefined}
          />
          <Slider
            label="Swing"
            min={0}
            max={1}
            step={0.01}
            value={pattern.swing ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={onUpdatePattern ? (value) => onUpdatePattern((chunk) => ({
                  ...chunk,
                  swing: value,
                })) : undefined}
          />
          <Slider
            label="Humanize"
            min={0}
            max={1}
            step={0.01}
            value={pattern.humanize ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={onUpdatePattern ? (value) => onUpdatePattern((chunk) => ({
                  ...chunk,
                  humanize: value,
                })) : undefined}
          />
        </Section>
      ) : null}

      {isBass ? (
        <Section title="Bass Shape">
          <Slider
            label="Attack"
            min={0}
            max={0.5}
            step={0.005}
            value={pattern.attack ?? 0.01}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={onUpdatePattern ? (value) => onUpdatePattern((chunk) => ({
                  ...chunk,
                  attack: value,
                })) : undefined}
          />
          <Slider
            label="Release"
            min={0}
            max={1}
            step={0.01}
            value={pattern.sustain ?? 0.2}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={onUpdatePattern ? (value) => onUpdatePattern((chunk) => ({
                  ...chunk,
                  sustain: value,
                })) : undefined}
          />
          <Slider
            label="Glide"
            min={0}
            max={0.5}
            step={0.01}
            value={pattern.glide ?? 0}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={onUpdatePattern ? (value) => onUpdatePattern((chunk) => ({
                  ...chunk,
                  glide: value,
                })) : undefined}
          />
          <Slider
            label="Filter"
            min={0}
            max={1}
            step={0.01}
            value={pattern.filter ?? 1}
            formatValue={(value) =>
              `${Math.round(filterValueToFrequency(value))} Hz`
            }
            onChange={onUpdatePattern ? (value) => onUpdatePattern((chunk) => ({
                  ...chunk,
                  filter: value,
                })) : undefined}
          />
        </Section>
      ) : null}

      {isArp ? (
        <Section title="Arp Overview">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Root</span>
              <span style={{ color: "#e6f2ff" }}>{pattern.note ?? "C4"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Style</span>
              <span style={{ color: "#e6f2ff" }}>{pattern.style ?? "up"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Mode</span>
              <span style={{ color: "#e6f2ff" }}>{pattern.mode ?? "manual"}</span>
            </div>
          </div>
        </Section>
      ) : null}

      {isKeyboard ? (
        <Section title="Keys Overview">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Sustain</span>
              <span style={{ color: "#e6f2ff" }}>
                {(pattern.sustain ?? 0.8).toFixed(2)} s
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Reverb</span>
              <span style={{ color: "#e6f2ff" }}>
                {Math.round((pattern.reverb ?? 0) * 100)}%
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Filter</span>
              <span style={{ color: "#e6f2ff" }}>
                {pattern.filter !== undefined && filterFrequency
                  ? `${Math.round(filterFrequency)} Hz`
                  : "Flat"}
              </span>
            </div>
          </div>
        </Section>
      ) : null}

      {!isPercussive && !isBass && !isArp && !isKeyboard ? (
        <Section title="Instrument">
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            This instrument does not have dedicated controls yet.
          </span>
        </Section>
      ) : null}
    </div>
  );
};

import type { FC, PropsWithChildren } from "react";
import { useMemo } from "react";
import * as Tone from "tone";

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

const Section: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
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

  const updatePattern =
    onUpdatePattern && pattern
      ? (partial: Partial<Chunk>) => {
          onUpdatePattern((chunk) => ({
            ...chunk,
            ...partial,
          }));
        }
      : undefined;

  const activeVelocity = pattern?.velocityFactor ?? 1;

  const arpRoot = pattern?.note ?? "C4";
  const arpRateOptions = ["1/32", "1/16", "1/8", "1/4"] as const;

  const availableNotes = useMemo(() => {
    const octaves = [2, 3, 4, 5];
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return octaves.flatMap((octave) =>
      noteNames.map((note) => `${note}${octave}`)
    );
  }, []);

  const arpPadPresets = useMemo(
    () => [
      { id: "triad", label: "Triad", degrees: [0, 4, 7] },
      { id: "minor", label: "Minor", degrees: [0, 3, 7] },
      { id: "sus2", label: "Sus2", degrees: [0, 2, 7] },
      { id: "sus4", label: "Sus4", degrees: [0, 5, 7] },
      { id: "seventh", label: "7th", degrees: [0, 4, 7, 10] },
      { id: "ninth", label: "9th", degrees: [0, 4, 7, 10, 14] },
      { id: "six", label: "6th", degrees: [0, 4, 7, 9] },
      { id: "dim", label: "Dim", degrees: [0, 3, 6] },
    ],
    []
  );

  const chordMatchesDegrees = (degrees: number[]) => {
    if (!pattern?.degrees || pattern.degrees.length !== degrees.length) return false;
    return pattern.degrees.every((value, index) => value === degrees[index]);
  };

  const createChordNotes = (rootNote: string, degrees: number[]) => {
    const rootMidi = Tone.Frequency(rootNote).toMidi();
    return degrees.map((degree) =>
      Tone.Frequency(rootMidi + degree, "midi").toNote()
    );
  };

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

      <Section title="Performance">
        <Slider
          label="Velocity"
          min={0}
          max={2}
          step={0.01}
          value={activeVelocity}
          formatValue={(value) => `${Math.round(value * 100)}%`}
          onChange={updatePattern ? (value) => updatePattern({ velocityFactor: value }) : undefined}
        />
      </Section>

      {isPercussive ? (
        <Section title="Parameters">
          <Slider
            label="Pitch"
            min={-12}
            max={12}
            step={1}
            value={pattern.pitchOffset ?? 0}
            formatValue={(value) => `${value > 0 ? "+" : ""}${value} st`}
            onChange={updatePattern ? (value) => updatePattern({ pitchOffset: value }) : undefined}
          />
          <Slider
            label="Swing"
            min={0}
            max={1}
            step={0.01}
            value={pattern.swing ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ swing: value }) : undefined}
          />
          <Slider
            label="Humanize"
            min={0}
            max={1}
            step={0.01}
            value={pattern.humanize ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ humanize: value }) : undefined}
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
            onChange={updatePattern ? (value) => updatePattern({ attack: value }) : undefined}
          />
          <Slider
            label="Release"
            min={0}
            max={1}
            step={0.01}
            value={pattern.sustain ?? 0.2}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ sustain: value }) : undefined}
          />
          <Slider
            label="Glide"
            min={0}
            max={0.5}
            step={0.01}
            value={pattern.glide ?? 0}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ glide: value }) : undefined}
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
            onChange={updatePattern ? (value) => updatePattern({ filter: value }) : undefined}
          />
        </Section>
      ) : null}

      {isArp ? (
        <Section title="Arp Controls">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 12,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Root</span>
              <select
                value={arpRoot}
                onChange={(event) => {
                  const nextNote = event.target.value;
                  if (!updatePattern) return;
                  const degrees = pattern.degrees ?? [];
                  const partial: Partial<Chunk> = { note: nextNote };
                  if (degrees.length) {
                    partial.notes = createChordNotes(nextNote, degrees);
                  }
                  updatePattern(partial);
                }}
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #2a3344",
                  background: "#121827",
                  color: "#e6f2ff",
                  fontSize: 12,
                }}
              >
                {availableNotes.map((note) => (
                  <option key={note} value={note}>
                    {note}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Style</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["up", "down", "up-down", "random"].map((style) => (
                  <button
                    key={style}
                    onClick={() => updatePattern?.({ style })}
                    style={{
                      flex: "1 1 48%",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #2a3344",
                      background:
                        pattern.style === style
                          ? "#27E0B0"
                          : "#1f2532",
                      color:
                        pattern.style === style ? "#1F2532" : "#e6f2ff",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {style.replace("-", " ")}
                  </button>
                ))}
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Mode</span>
              <div style={{ display: "flex", gap: 8 }}>
                {["manual", "continuous"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updatePattern?.({ mode })}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #2a3344",
                      background:
                        pattern.mode === mode ? "#27E0B0" : "#1f2532",
                      color:
                        pattern.mode === mode ? "#1F2532" : "#e6f2ff",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Rate</span>
              <select
                value={pattern.arpRate ?? "1/16"}
                onChange={(event) =>
                  updatePattern?.({ arpRate: event.target.value })
                }
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #2a3344",
                  background: "#121827",
                  color: "#e6f2ff",
                  fontSize: 12,
                }}
              >
                {arpRateOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 8,
              marginTop: 16,
            }}
          >
            {arpPadPresets.map((preset) => {
              const active = chordMatchesDegrees(preset.degrees);
              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    if (!updatePattern) return;
                    const notes = createChordNotes(arpRoot, preset.degrees);
                    updatePattern({ degrees: preset.degrees, notes });
                  }}
                  style={{
                    padding: "16px 12px",
                    borderRadius: 12,
                    border: "1px solid #2a3344",
                    background: active ? "#27E0B0" : "#1f2532",
                    color: active ? "#1F2532" : "#e6f2ff",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            <Slider
              label="Gate"
              min={0.1}
              max={1}
              step={0.01}
              value={pattern.arpGate ?? 0.6}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onChange={updatePattern ? (value) => updatePattern({ arpGate: value }) : undefined}
            />
            <Slider
              label="Octaves"
              min={1}
              max={4}
              step={1}
              value={pattern.arpOctaves ?? 1}
              formatValue={(value) => `${value}x`}
              onChange={updatePattern ? (value) => updatePattern({ arpOctaves: value }) : undefined}
            />
            <Slider
              label="Pitch Bend"
              min={-5}
              max={5}
              step={0.5}
              value={pattern.pitchBend ?? 0}
              formatValue={(value) => `${value > 0 ? "+" : ""}${value} st`}
              onChange={updatePattern ? (value) => updatePattern({ pitchBend: value }) : undefined}
            />
            <Slider
              label="Sustain"
              min={0}
              max={1.5}
              step={0.01}
              value={pattern.sustain ?? 0.2}
              formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
              onChange={updatePattern ? (value) => updatePattern({ sustain: value }) : undefined}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#e6f2ff",
              }}
            >
              <span style={{ fontWeight: 600 }}>Latch</span>
              <button
                onClick={() =>
                  updatePattern?.({ arpLatch: !(pattern.arpLatch ?? false) })
                }
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid #2a3344",
                  background: pattern.arpLatch ? "#27E0B0" : "#1f2532",
                  color: pattern.arpLatch ? "#1F2532" : "#e6f2ff",
                  cursor: "pointer",
                }}
              >
                {pattern.arpLatch ? "On" : "Off"}
              </button>
            </div>
          </div>
        </Section>
      ) : null}

      {isKeyboard ? (
        <Section title="Keyboard Controls">
          <Slider
            label="Attack"
            min={0}
            max={2}
            step={0.01}
            value={pattern.attack ?? 0.05}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ attack: value }) : undefined}
          />
          <Slider
            label="Sustain"
            min={0}
            max={3}
            step={0.01}
            value={pattern.sustain ?? 0.8}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ sustain: value }) : undefined}
          />
          <Slider
            label="Glide"
            min={0}
            max={1}
            step={0.01}
            value={pattern.glide ?? 0}
            formatValue={(value) => `${(value * 1000).toFixed(0)} ms`}
            onChange={updatePattern ? (value) => updatePattern({ glide: value }) : undefined}
          />
          <Slider
            label="Pan"
            min={-1}
            max={1}
            step={0.01}
            value={pattern.pan ?? 0}
            formatValue={(value) => `${(value * 100).toFixed(0)}%`}
            onChange={updatePattern ? (value) => updatePattern({ pan: value }) : undefined}
          />
          <Slider
            label="Reverb"
            min={0}
            max={1}
            step={0.01}
            value={pattern.reverb ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ reverb: value }) : undefined}
          />
          <Slider
            label="Delay"
            min={0}
            max={1}
            step={0.01}
            value={pattern.delay ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ delay: value }) : undefined}
          />
          <Slider
            label="Distortion"
            min={0}
            max={1}
            step={0.01}
            value={pattern.distortion ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ distortion: value }) : undefined}
          />
          <Slider
            label="Bitcrusher"
            min={0}
            max={1}
            step={0.01}
            value={pattern.bitcrusher ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ bitcrusher: value }) : undefined}
          />
          <Slider
            label="Chorus"
            min={0}
            max={1}
            step={0.01}
            value={pattern.chorus ?? 0}
            formatValue={(value) => `${Math.round(value * 100)}%`}
            onChange={updatePattern ? (value) => updatePattern({ chorus: value }) : undefined}
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
            onChange={updatePattern ? (value) => updatePattern({ filter: value }) : undefined}
          />
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

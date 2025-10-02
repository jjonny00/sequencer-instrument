import type { FC } from "react";

import { withAlpha } from "../utils/color";

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  color: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

const SliderControl: FC<SliderControlProps> = ({
  label,
  value,
  min,
  max,
  step,
  color,
  format,
  onChange,
}) => {
  const displayValue = format ? format(value) : value.toFixed(2);

  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 12,
        color: "#e2e8f0",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 600,
          color: "#cbd5f5",
        }}
      >
        <span>{label}</span>
        <span style={{ color: "#94a3b8" }}>{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          width: "100%",
          accentColor: color,
          cursor: "pointer",
        }}
      />
    </label>
  );
};

export interface InstrumentSettingsPanelProps {
  instrumentName: string;
  styleName?: string | null;
  color: string;
  velocity: number;
  pitch: number;
  swing: number;
  onVelocityChange: (value: number) => void;
  onPitchChange: (value: number) => void;
  onSwingChange: (value: number) => void;
}

export const InstrumentSettingsPanel: FC<InstrumentSettingsPanelProps> = ({
  instrumentName,
  styleName,
  color,
  velocity,
  pitch,
  swing,
  onVelocityChange,
  onPitchChange,
  onSwingChange,
}) => {
  const panelBackground = withAlpha(color, 0.08);
  const borderColor = withAlpha(color, 0.35);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: "14px 16px",
        borderRadius: 14,
        background: panelBackground,
        border: `1px solid ${borderColor}`,
        boxShadow: "inset 0 0 0 1px rgba(8, 12, 20, 0.4)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 0.4,
            color: "#f8fafc",
          }}
        >
          {instrumentName}
        </span>
        {styleName ? (
          <span
            style={{
              alignSelf: "flex-start",
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 11,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              background: withAlpha(color, 0.25),
              color: "#0b1220",
              fontWeight: 700,
            }}
          >
            {styleName}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <SliderControl
          label="Velocity"
          value={velocity}
          min={0}
          max={2}
          step={0.05}
          color={color}
          format={(value) => `${value.toFixed(2)}x`}
          onChange={onVelocityChange}
        />
        <SliderControl
          label="Pitch"
          value={pitch}
          min={-12}
          max={12}
          step={1}
          color={color}
          format={(value) => `${value >= 0 ? "+" : ""}${value}`}
          onChange={onPitchChange}
        />
        <SliderControl
          label="Swing"
          value={swing}
          min={0}
          max={1}
          step={0.05}
          color={color}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={onSwingChange}
        />
      </div>
    </div>
  );
};

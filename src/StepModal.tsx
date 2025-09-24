import type { FC, MouseEvent, TouchEvent } from "react";

export const StepModal: FC<{
  velocity: number;
  pitch: number;
  onChange: (p: { velocity?: number; pitch?: number }) => void;
  onClose: () => void;
}> = ({ velocity, pitch, onChange, onClose }) => {
  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) {
      onClose();
    }
  };

  const handleOverlayTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) {
      onClose();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onMouseDown={handleOverlayMouseDown}
      onTouchStart={handleOverlayTouchStart}
    >
      <div
        style={{
          background: "#1f2532",
          color: "white",
          padding: 16,
          borderRadius: 8,
          width: "80%",
          maxWidth: 320,
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4 }}>
            Velocity: {velocity.toFixed(2)}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={velocity}
            onChange={(e) => onChange({ velocity: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4 }}>
            Pitch: {pitch}
          </label>
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            value={pitch}
            onChange={(e) => onChange({ pitch: Number(e.target.value) })}
            style={{ width: "100%" }}
          />
        </div>
        <button
          onClick={onClose}
          style={{
            padding: "8px 12px",
            borderRadius: 4,
            border: "none",
            background: "#27E0B0",
            color: "#1F2532",
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};

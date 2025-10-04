import type { CSSProperties, ReactNode } from "react";

export interface ViewHeaderProps {
  viewMode: "track" | "song";
  onBack: () => void;
  onSelectTrack: () => void;
  onSelectSong: () => void;
  actions?: ReactNode;
  variant?: "stacked" | "inline";
}

export interface ViewHeaderSections {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode | null;
}

type ViewHeaderContentProps = Omit<ViewHeaderProps, "variant">;

const SECTION_CONTAINER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const STACKED_WRAPPER_STYLE: CSSProperties = {
  padding: "16px 16px 0",
  position: "sticky",
  top: 0,
  zIndex: 30,
  background: "linear-gradient(180deg, rgba(12,18,32,0.9), rgba(12,18,32,0.75))",
  backdropFilter: "blur(14px)",
  boxSizing: "border-box",
};

const STACKED_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
};

const INLINE_WRAPPER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const BACK_BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "0 16px",
  height: 40,
  borderRadius: 999,
  border: "1px solid #1f2937",
  background: "#0f172a",
  color: "#e2e8f0",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  cursor: "pointer",
  transition: "background 0.2s ease, border-color 0.2s ease",
};

const SEGMENTED_WRAPPER_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: 4,
  borderRadius: 999,
  border: "1px solid #1f2937",
  background: "#0b1220",
};

const SEGMENT_BUTTON_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 96,
  padding: "0 18px",
  height: 32,
  borderRadius: 999,
  border: "1px solid transparent",
  background: "transparent",
  color: "#94a3b8",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  cursor: "pointer",
  transition:
    "background 0.2s ease, color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
};

const ACTIONS_WRAPPER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const SECTION_LEFT_STYLE: CSSProperties = {
  ...SECTION_CONTAINER_STYLE,
  flexShrink: 0,
};

const SECTION_CENTER_STYLE: CSSProperties = {
  ...SECTION_CONTAINER_STYLE,
  flex: 1,
  justifyContent: "center",
  minWidth: 0,
};

const SECTION_RIGHT_STYLE: CSSProperties = {
  ...SECTION_CONTAINER_STYLE,
  justifyContent: "flex-end",
  flexShrink: 0,
};

const buildSegmentButtonStyle = (active: boolean): CSSProperties => ({
  ...SEGMENT_BUTTON_STYLE,
  background: active ? "#27E0B0" : "transparent",
  color: active ? "#0b1220" : "#94a3b8",
  borderColor: active ? "#27E0B0" : "transparent",
  boxShadow: active ? "0 8px 24px rgba(39,224,176,0.22)" : "none",
});

export const getViewHeaderSections = ({
  viewMode,
  onBack,
  onSelectTrack,
  onSelectSong,
  actions,
}: ViewHeaderContentProps): ViewHeaderSections => {
  const trackActive = viewMode === "track";
  const songActive = viewMode === "song";

  const left = (
    <button
      type="button"
      onClick={onBack}
      style={BACK_BUTTON_STYLE}
      aria-label="Back to song library"
    >
      <span style={{ fontWeight: 600, fontSize: 13 }}>{"< Back"}</span>
    </button>
  );

  const center = (
    <div style={SEGMENTED_WRAPPER_STYLE} role="tablist" aria-label="Select view">
      <button
        type="button"
        onClick={onSelectTrack}
        style={buildSegmentButtonStyle(trackActive)}
        aria-pressed={trackActive}
      >
        Loops
      </button>
      <button
        type="button"
        onClick={onSelectSong}
        style={buildSegmentButtonStyle(songActive)}
        aria-pressed={songActive}
      >
        Song
      </button>
    </div>
  );

  const right = actions ? <div style={ACTIONS_WRAPPER_STYLE}>{actions}</div> : null;

  return { left, center, right };
};

export function ViewHeader({ variant = "stacked", ...rest }: ViewHeaderProps) {
  const { left, center, right } = getViewHeaderSections(rest);

  if (variant === "inline") {
    return (
      <div style={INLINE_WRAPPER_STYLE}>
        <div style={SECTION_LEFT_STYLE}>{left}</div>
        <div style={SECTION_CENTER_STYLE}>{center}</div>
        <div style={SECTION_RIGHT_STYLE}>{right}</div>
      </div>
    );
  }

  return (
    <header style={STACKED_WRAPPER_STYLE}>
      <div style={STACKED_ROW_STYLE}>
        <div style={SECTION_LEFT_STYLE}>{left}</div>
        <div style={SECTION_CENTER_STYLE}>{center}</div>
        <div style={SECTION_RIGHT_STYLE}>{right}</div>
      </div>
    </header>
  );
}

export default ViewHeader;

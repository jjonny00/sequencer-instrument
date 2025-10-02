import type { CSSProperties, ReactNode } from "react";

interface ViewHeaderProps {
  viewMode: "track" | "song";
  onBack: () => void;
  onSelectTrack: () => void;
  onSelectSong: () => void;
  actions?: ReactNode;
}

const headerWrapperStyle: CSSProperties = {
  padding: "16px 16px 0",
  position: "sticky",
  top: 0,
  zIndex: 30,
  background: "linear-gradient(180deg, rgba(13,18,30,0.94), rgba(13,18,30,0.82))",
  backdropFilter: "blur(12px)",
};

const navRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
};

const tabGroupStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flex: 1,
  minWidth: 0,
};

const tabBaseStyle: CSSProperties = {
  flex: 1,
  padding: "8px 0",
  borderRadius: 999,
  border: "1px solid #333",
  background: "#1f2532",
  color: "#94a3b8",
  fontWeight: 600,
  letterSpacing: 0.3,
  cursor: "pointer",
  transition: "background 0.2s ease, color 0.2s ease, border-color 0.2s ease",
};

const backButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid #333",
  background: "#111827",
  color: "#e6f2ff",
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.3,
  flexShrink: 0,
  cursor: "pointer",
};

export function ViewHeader({
  viewMode,
  onBack,
  onSelectTrack,
  onSelectSong,
  actions,
}: ViewHeaderProps) {
  const trackActive = viewMode === "track";
  const songActive = viewMode === "song";

  return (
    <header style={headerWrapperStyle}>
      <div style={navRowStyle}>
        <button
          type="button"
          onClick={onBack}
          style={backButtonStyle}
          aria-label="Back to songs"
          title="Back to songs"
        >
          <span style={{ fontSize: 13, fontWeight: 600 }}>{"< Back"}</span>
        </button>
        <div style={tabGroupStyle}>
          <button
            type="button"
            onClick={onSelectTrack}
            style={{
              ...tabBaseStyle,
              background: trackActive ? "#27E0B0" : "#1f2532",
              color: trackActive ? "#0b1220" : "#94a3b8",
              borderColor: trackActive ? "#27E0B0" : "#333",
            }}
            aria-pressed={trackActive}
          >
            Tracks
          </button>
          <button
            type="button"
            onClick={onSelectSong}
            style={{
              ...tabBaseStyle,
              background: songActive ? "#27E0B0" : "#1f2532",
              color: songActive ? "#0b1220" : "#94a3b8",
              borderColor: songActive ? "#27E0B0" : "#333",
            }}
            aria-pressed={songActive}
          >
            Song
          </button>
        </div>
      </div>
      {actions ? (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export default ViewHeader;

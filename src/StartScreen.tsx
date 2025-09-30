import type { FC } from "react";

interface StartScreenProps {
  projectList: string[];
  onNewSong: () => void;
  onLoadSong: (name: string) => void;
  onLoadDemoSong: () => void;
}

export const StartScreen: FC<StartScreenProps> = ({
  projectList,
  onNewSong,
  onLoadSong,
  onLoadDemoSong,
}) => {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <button
          type="button"
          onClick={onNewSong}
          style={{
            padding: "18px 24px",
            fontSize: "1.25rem",
            borderRadius: 16,
            border: "1px solid #333",
            background: "#27E0B0",
            color: "#1F2532",
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          + New Song
        </button>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: "#e6f2ff" }}>
            Saved Songs
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              maxHeight: "60vh",
              overflowY: "auto",
            }}
          >
            {projectList.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                  padding: 20,
                  borderRadius: 16,
                  border: "1px dashed #1f2937",
                  background: "#0b1624",
                  textAlign: "center",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(39,224,176,0.12)",
                    color: "#27E0B0",
                    fontSize: 36,
                  }}
                >
                  🎶
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    color: "#cbd5f5",
                    fontSize: 14,
                  }}
                >
                  <strong style={{ fontSize: 16 }}>
                    Start your first jam!
                  </strong>
                  <span>
                    Save your creations to see them listed here, or dive in with
                    our ready-made groove.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onLoadDemoSong}
                  style={{
                    padding: "12px 20px",
                    borderRadius: 999,
                    border: "none",
                    background: "linear-gradient(135deg, #27E0B0, #6AE0FF)",
                    color: "#0b1220",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: "pointer",
                    boxShadow: "0 12px 24px rgba(39,224,176,0.25)",
                  }}
                >
                  Try Demo Song
                </button>
              </div>
            ) : (
              projectList.map((name) => (
                <button
                  key={name}
                  onClick={() => onLoadSong(name)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 14,
                    border: "1px solid #1f2937",
                    background: "#0f172a",
                    color: "#e6f2ff",
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    Tap to load song
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

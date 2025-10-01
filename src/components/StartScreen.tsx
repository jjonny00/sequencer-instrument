import { useMemo, type ReactNode } from "react";
import { unlockAudio } from "../utils/audioUnlock";

interface StartScreenProps {
  onNewSong: () => void;
  onLoadSong: () => void;
  onLoadDemoSong: () => void;
  children?: ReactNode;
}

export function StartScreen({
  onNewSong,
  onLoadSong,
  onLoadDemoSong,
  children,
}: StartScreenProps) {
  const runWithAudioUnlock = (action?: () => void) => {
    unlockAudio();
    action?.();
  };

  const handleNewSong = useMemo(
    () => () => runWithAudioUnlock(onNewSong),
    [onNewSong]
  );

  const handleLoadSong = useMemo(
    () => () => runWithAudioUnlock(onLoadSong),
    [onLoadSong]
  );

  const handleLoadDemoSong = useMemo(
    () => () => runWithAudioUnlock(onLoadDemoSong),
    [onLoadDemoSong]
  );

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 40,
        padding: "64px 24px 80px",
        minHeight: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 12,
          maxWidth: 540,
        }}
      >
        <span
          style={{
            fontSize: 12,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#38bdf8",
            fontWeight: 600,
          }}
        >
          Welcome back
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "2.5rem",
            color: "#e6f2ff",
            fontWeight: 700,
            letterSpacing: 0.4,
          }}
        >
          Craft your next groove
        </h1>
        <p
          style={{
            margin: 0,
            color: "#94a3b8",
            fontSize: 15,
            lineHeight: 1.6,
          }}
        >
          Jump straight into a fresh idea or pick up a saved session. Everything
          stays synced across your local library.
        </p>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 16,
        }}
      >
        <button
          type="button"
          onClick={handleNewSong}
          onTouchEnd={handleNewSong}
          style={{
            padding: "18px 36px",
            borderRadius: 999,
            border: "1px solid rgba(39,224,176,0.4)",
            background: "linear-gradient(135deg, #27E0B0, #6AE0FF)",
            color: "#0b1220",
            fontSize: 17,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            boxShadow: "0 24px 48px rgba(39,224,176,0.25)",
            letterSpacing: 0.2,
          }}
        >
          <span
            className="material-symbols-outlined"
            aria-hidden="true"
            style={{ fontSize: 22 }}
          >
            add
          </span>
          New Song
        </button>
        <button
          type="button"
          onClick={handleLoadSong}
          onTouchEnd={handleLoadSong}
          style={{
            padding: "16px 28px",
            borderRadius: 999,
            border: "1px solid rgba(148,163,184,0.4)",
            background: "rgba(15,23,42,0.65)",
            color: "#e2e8f0",
            fontSize: 16,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            backdropFilter: "blur(12px)",
          }}
        >
          <span
            className="material-symbols-outlined"
            aria-hidden="true"
            style={{ fontSize: 20 }}
          >
            library_music
          </span>
          Saved Songs
        </button>
        <button
          type="button"
          onClick={handleLoadDemoSong}
          onTouchEnd={handleLoadDemoSong}
          style={{
            padding: "16px 28px",
            borderRadius: 999,
            border: "1px solid rgba(56,189,248,0.35)",
            background: "rgba(8,47,73,0.6)",
            color: "#bae6fd",
            fontSize: 16,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            backdropFilter: "blur(12px)",
          }}
        >
          <span
            className="material-symbols-outlined"
            aria-hidden="true"
            style={{ fontSize: 20 }}
          >
            play_circle
          </span>
          Demo Song
        </button>
      </div>
      {children ? (
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

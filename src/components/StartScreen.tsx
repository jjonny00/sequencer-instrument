import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type TouchEvent,
} from "react";
import * as Tone from "tone";

interface StartScreenProps {
  onNewSong: () => void;
  onLoadSong: (name: string) => void;
  onLoadDemoSong: () => void;
  savedSongs: string[];
}

const isAudioRunning = () => Tone.context.state === "running";

function StartScreen({
  onNewSong,
  onLoadSong,
  onLoadDemoSong,
  savedSongs,
}: StartScreenProps) {
  const [showAudioOverlay, setShowAudioOverlay] = useState(false);

  const unlockAudio = useCallback(async (): Promise<boolean> => {
    try {
      if (!isAudioRunning()) {
        await Tone.start();
      }
    } catch (error) {
      console.error("Audio unlock failed:", error);
    }

    const running = isAudioRunning();
    setShowAudioOverlay(!running);
    return running;
  }, []);

  const handleUnlock = useCallback(
    async (action?: () => void) => {
      const unlocked = await unlockAudio();
      if (unlocked) {
        action?.();
      }
    },
    [unlockAudio]
  );

  const createUnlockHandler = useCallback(
    (action?: () => void) =>
      (event: MouseEvent<HTMLButtonElement> | TouchEvent<HTMLButtonElement>) => {
        if (event.type === "touchstart") {
          event.preventDefault();
        }
        void handleUnlock(action);
      },
    [handleUnlock]
  );

  useEffect(() => {
    if (!isAudioRunning()) {
      setShowAudioOverlay(true);
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        !isAudioRunning()
      ) {
        setShowAudioOverlay(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const savedSongsContent = useMemo(() => {
    if (savedSongs.length === 0) {
      return (
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
            <strong style={{ fontSize: 16 }}>Start your first jam!</strong>
            <span>
              Save your creations to see them listed here, or dive in with our
              ready-made groove.
            </span>
          </div>
          <button
            type="button"
            onClick={createUnlockHandler(onLoadDemoSong)}
            onTouchStart={createUnlockHandler(onLoadDemoSong)}
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
      );
    }

    return savedSongs.map((name) => (
      <button
        key={name}
        type="button"
        onClick={createUnlockHandler(() => onLoadSong(name))}
        onTouchStart={createUnlockHandler(() => onLoadSong(name))}
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
        <span style={{ fontSize: 11, color: "#94a3b8" }}>Tap to load song</span>
      </button>
    ));
  }, [createUnlockHandler, onLoadDemoSong, onLoadSong, savedSongs]);

  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        justifyContent: "center",
        padding: 24,
        position: "relative",
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
          onClick={createUnlockHandler(onNewSong)}
          onTouchStart={createUnlockHandler(onNewSong)}
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
            {savedSongsContent}
          </div>
        </div>
      </div>
      {showAudioOverlay && (
        <div
          className="audio-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 999,
            pointerEvents: showAudioOverlay ? "auto" : "none",
          }}
        >
          <div
            className="overlay-content"
            style={{
              background: "#ffffff",
              padding: "20px 30px",
              borderRadius: 8,
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minWidth: 200,
            }}
          >
            <p style={{ margin: 0, fontSize: 16, color: "#0b1220" }}>
              Audio is paused
            </p>
            <button
              type="button"
              onClick={createUnlockHandler()}
              onTouchStart={createUnlockHandler()}
              style={{
                padding: "10px 18px",
                borderRadius: 999,
                border: "none",
                background: "linear-gradient(135deg, #27E0B0, #6AE0FF)",
                color: "#0b1220",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Enable Audio
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default StartScreen;

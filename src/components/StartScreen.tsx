// src/components/StartScreen.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  type MouseEvent,
  type TouchEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as Tone from "tone";

interface StartScreenProps {
  onNewSong: () => void;
  onLoadSong: (name: string) => void;
  onLoadDemoSong: () => void;
  savedSongs: string[];
}

const isAudioRunning = () => Tone.context.state === "running";

const StartScreen = ({
  onNewSong,
  onLoadSong,
  onLoadDemoSong,
  savedSongs,
}: StartScreenProps) => {
  /**
   * HARD RULES FOR iOS PWA:
   *  - Never await Tone.start() in a lifecycle hook.
   *  - Call Tone.start() directly inside a *real* user gesture (pointer/click).
   *  - Provide a global, capture-phase pointer trap as a safety net,
   *    so the very first touch anywhere unlocks audio even if React
   *    handlers don’t fire for some reason.
   */

  // 1) One-time, capture-phase global unlock (safety net)
  useEffect(() => {
    if (isAudioRunning()) return;

    const unlockOnce = () => {
      // Synchronous call—no await/then.
      try {
        Tone.start();
      } catch {
        // ignore
      }
      // We don’t remove this manually because we register with { once: true }.
    };

    // Capture phase to run even if something stops propagation,
    // and once:true so it only tries on the very first pointer interaction.
    window.addEventListener("pointerdown", unlockOnce, { capture: true, once: true });

    // Cleanup in case component unmounts before the first interaction.
    return () => {
      window.removeEventListener("pointerdown", unlockOnce, true);
    };
  }, []);

  // 2) Button-level unlock + action (no overlay on start screen)
  const handleUnlockAnd = useCallback((action?: () => void) => {
    // Synchronous—don’t await or chain .then()
    try {
      Tone.start();
    } catch {
      // ignore
    }
    if (isAudioRunning()) {
      action?.();
    } else {
      // If still suspended, we *still* run action to keep UI responsive;
      // other views may show their audio overlay if needed.
      action?.();
    }
  }, []);

  // Pointer-first handlers (works for mouse/touch/pen)
  const createPointerHandler = useCallback(
    (action?: () => void) =>
      (
        _e:
          | ReactPointerEvent<HTMLButtonElement>
          | MouseEvent<HTMLButtonElement>
          | TouchEvent<HTMLButtonElement>
      ) => {
        handleUnlockAnd(action);
      },
    [handleUnlockAnd]
  );

  const newSongHandler = useMemo(
    () => createPointerHandler(onNewSong),
    [createPointerHandler, onNewSong]
  );
  const demoSongHandler = useMemo(
    () => createPointerHandler(onLoadDemoSong),
    [createPointerHandler, onLoadDemoSong]
  );

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
            onPointerUp={demoSongHandler}
            onClick={demoSongHandler}
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
              touchAction: "manipulation",
            }}
          >
            Try Demo Song
          </button>
        </div>
      );
    }

    return savedSongs.map((name) => {
      const loadSavedSongHandler = createPointerHandler(() => onLoadSong(name));
      return (
        <button
          key={name}
          type="button"
          onPointerUp={loadSavedSongHandler}
          onClick={loadSavedSongHandler}
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
            touchAction: "manipulation",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            Tap to load song
          </span>
        </button>
      );
    });
  }, [createPointerHandler, demoSongHandler, onLoadSong, savedSongs]);

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
          onPointerUp={newSongHandler}
          onClick={newSongHandler}
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
            touchAction: "manipulation",
          }}
        >
          + New Song
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
    </div>
  );
};

export default StartScreen;

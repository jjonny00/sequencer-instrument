import React, { useCallback, useRef } from "react";
import {
  unlockAudio,
  unlockAudioSyncHard,
  isAudioRunning,
} from "../utils/audioUnlock";

type Props = { show: boolean; onUnlocked: () => void };

export const AudioGateOverlay: React.FC<Props> = ({ show, onUnlocked }) => {
  const unlockingRef = useRef(false);

  const handleTap = useCallback(
    (event: React.SyntheticEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (unlockingRef.current) {
        return;
      }
      unlockingRef.current = true;

      const runUnlock = async () => {
        try {
          // First, attempt the synchronous hard unlock while we are still inside
          // the trusted gesture turn.
          unlockAudioSyncHard();

          if (isAudioRunning()) {
            onUnlocked();
            return;
          }

          // Fall back to the async unlock path (handles "interrupted" resume).
          await unlockAudio();

          if (isAudioRunning()) {
            onUnlocked();
          }
        } finally {
          unlockingRef.current = false;
        }
      };

      void runUnlock();
    },
    [onUnlocked]
  );

  if (!show) return null;

  return (
    <div
      role="button"
      aria-label="Tap to enable audio"
      onPointerDown={handleTap}
      onClick={handleTap}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        WebkitUserSelect: "none",
        userSelect: "none",
        backdropFilter: "blur(4px)",
      }}
    >
      Tap to enable audio
    </div>
  );
};

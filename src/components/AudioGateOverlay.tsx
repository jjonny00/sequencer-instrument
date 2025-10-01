import React from "react";
import { unlockAudio, isAudioRunning } from "../utils/audioUnlock";

type Props = { show: boolean; onUnlocked: () => void };

export const AudioGateOverlay: React.FC<Props> = ({ show, onUnlocked }) => {
  if (!show) return null;

  const handleTap = async () => {
    await unlockAudio();
    if (isAudioRunning()) onUnlocked();
  };

  return (
    <div
      role="button"
      aria-label="Tap to enable audio"
      onClick={handleTap}
      onTouchStart={handleTap}
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

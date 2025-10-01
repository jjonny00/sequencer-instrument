import React, { useEffect, useState } from "react";
import { getAudioState, unlockAudio } from "../utils/audioUnlock";

const box: React.CSSProperties = {
  position: "fixed",
  right: 8,
  bottom: 8,
  zIndex: 99999,
  fontSize: 12,
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(0,0,0,0.6)",
  color: "#fff",
  userSelect: "none",
  WebkitUserSelect: "none",
  backdropFilter: "blur(6px)",
};

export const AudioDebugHUD: React.FC = () => {
  const [state, setState] = useState(getAudioState());

  useEffect(() => {
    const id = setInterval(() => setState(getAudioState()), 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={box}>
      <div>
        Audio: <strong>{state}</strong>
      </div>
      <button
        type="button"
        onClick={() => unlockAudio()}
        style={{ marginTop: 6, padding: "4px 8px", borderRadius: 6 }}
      >
        Try Unlock
      </button>
    </div>
  );
};

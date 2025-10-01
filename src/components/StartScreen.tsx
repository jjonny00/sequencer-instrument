import { useMemo } from "react";
import { unlockAudio } from "../utils/audioUnlock";

interface StartScreenProps {
  onNewSong: () => void;
  onLoadSong: (name: string) => void;
  onLoadDemoSong: () => void;
  savedSongs: string[];
}

const StartScreen = ({
  onNewSong,
  onLoadSong,
  onLoadDemoSong,
  savedSongs,
}: StartScreenProps) => {
  const handleUnlockAnd = (action?: () => void) => {
    unlockAudio();
    action?.();
  };

  const newSongHandler = useMemo(
    () => () => handleUnlockAnd(onNewSong),
    [onNewSong]
  );
  const demoSongHandler = useMemo(
    () => () => handleUnlockAnd(onLoadDemoSong),
    [onLoadDemoSong]
  );

  const savedSongsContent = useMemo(() => {
    if (savedSongs.length === 0) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <button type="button" onClick={demoSongHandler} onTouchEnd={demoSongHandler}>
            Try Demo Song
          </button>
        </div>
      );
    }

    return savedSongs.map((name) => {
      const loadSavedSongHandler = () => handleUnlockAnd(() => onLoadSong(name));
      return (
        <button
          key={name}
          type="button"
          onClick={loadSavedSongHandler}
          onTouchEnd={loadSavedSongHandler}
        >
          {name}
        </button>
      );
    });
  }, [savedSongs, onLoadSong, demoSongHandler]);

  return (
    <div style={{ padding: 24 }}>
      <button type="button" onClick={newSongHandler} onTouchEnd={newSongHandler}>
        + New Song
      </button>
      <div>{savedSongsContent}</div>
    </div>
  );
};

export default StartScreen;

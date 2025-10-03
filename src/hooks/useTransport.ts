import { useCallback, useMemo } from "react";

type UseTransportOptions = {
  bpm: number;
  setBpm: (updater: number | ((prev: number) => number)) => void;
  isPlaying: boolean;
  onToggleTransport: () => void;
};

export function useTransport({
  bpm,
  setBpm,
  isPlaying,
  onToggleTransport,
}: UseTransportOptions) {
  const transportIcon = useMemo(
    () => (isPlaying ? "stop" : "play_arrow"),
    [isPlaying]
  );
  const transportLabel = useMemo(
    () => (isPlaying ? "Stop" : "Play"),
    [isPlaying]
  );

  const handleToggleTransport = useCallback(() => {
    onToggleTransport();
  }, [onToggleTransport]);

  const handleBpmChange = useCallback(
    (value: number) => {
      setBpm(value);
    },
    [setBpm]
  );

  return {
    bpm,
    isPlaying,
    transportIcon,
    transportLabel,
    handleToggleTransport,
    handleBpmChange,
  };
}

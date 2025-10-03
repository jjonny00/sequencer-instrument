import { useEffect, useMemo } from "react";
import type { Dispatch, SetStateAction, CSSProperties } from "react";

import type { PatternGroup, PerformanceTrack, SongRow } from "./song";
import { createSongRow } from "./song";
import type { TrackInstrument, TriggerMap } from "./tracks";
import { IconButton } from "./components/IconButton";

interface SongViewProps {
  patternGroups: PatternGroup[];
  songRows: SongRow[];
  setSongRows: Dispatch<SetStateAction<SongRow[]>>;
  currentSectionIndex: number;
  isPlaying: boolean;
  bpm: number;
  setBpm: Dispatch<SetStateAction<number>>;
  onToggleTransport: () => void;
  selectedGroupId: string | null;
  onSelectLoop: (groupId: string) => void;
  performanceTracks: PerformanceTrack[];
  triggers: TriggerMap;
  onEnsurePerformanceRow: (
    instrument: TrackInstrument,
    existingId?: string | null
  ) => string | null;
  activePerformanceTrackId: string | null;
  onAddPerformanceTrack?: () => void;
  onSelectPerformanceTrack?: (trackId: string | null) => void;
  onPlayInstrumentOpenChange?: (open: boolean) => void;
  onUpdatePerformanceTrack?: (
    trackId: string,
    updater: (track: PerformanceTrack) => PerformanceTrack
  ) => void;
  onRemovePerformanceTrack?: (trackId: string) => void;
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  gap: 12,
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 16px",
  borderRadius: 16,
  border: "1px solid #2f384a",
  background: "#111827",
};

const toolbarLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: "#e6f2ff",
};

const toolbarActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const circularButtonStyle: CSSProperties = {
  minWidth: 40,
  minHeight: 40,
  borderRadius: 999,
  border: "1px solid #2f384a",
  background: "#1f2532",
  color: "#e6f2ff",
};

const accentCircularButtonStyle: CSSProperties = {
  ...circularButtonStyle,
  background: "#27E0B0",
  border: "1px solid #27E0B0",
  color: "#0b1624",
};

const timelineContainerStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  borderRadius: 16,
  border: "1px solid #2a3344",
  background: "#0f172a",
  padding: 16,
};

const bottomToolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 16px",
  borderRadius: 16,
  border: "1px solid #2f384a",
  background: "#111827",
};

const bpmSelectStyle: CSSProperties = {
  height: 44,
  borderRadius: 999,
  border: "1px solid #2f384a",
  background: "#1f2532",
  color: "#e6f2ff",
  padding: "0 16px",
  minWidth: 120,
  fontSize: 14,
  fontWeight: 600,
  appearance: "none",
};

const instrumentPlaceholderStyle: CSSProperties = {
  borderRadius: 12,
  border: "1px solid #1f2937",
  background: "#10192c",
  padding: 24,
  textAlign: "center",
  color: "#94a3b8",
  fontSize: 14,
};

const bpmOptions = [90, 100, 110, 120, 130, 140];

export function SongView({
  songRows: _songRows,
  setSongRows,
  isPlaying,
  bpm,
  setBpm,
  onToggleTransport,
  onAddPerformanceTrack,
  patternGroups,
  currentSectionIndex,
  selectedGroupId,
  onSelectLoop,
  performanceTracks,
  triggers,
  onEnsurePerformanceRow,
  activePerformanceTrackId,
  onSelectPerformanceTrack,
  onPlayInstrumentOpenChange,
  onUpdatePerformanceTrack,
  onRemovePerformanceTrack,
}: SongViewProps) {
  useEffect(() => {
    onPlayInstrumentOpenChange?.(false);
  }, [onPlayInstrumentOpenChange]);

  const handleAddLoop = () => {
    setSongRows((rows) => {
      if (rows.length === 0) {
        return [createSongRow(1)];
      }
      return rows.map((row) => ({
        ...row,
        slots: [...row.slots, null],
      }));
    });
  };

  const handleAddRow = () => {
    setSongRows((rows) => {
      const maxColumns = rows.reduce(
        (max, row) => Math.max(max, row.slots.length),
        0
      );
      const newRow = createSongRow(maxColumns || 1);
      if (rows.length === 0) {
        return [newRow];
      }
      return [...rows, newRow];
    });
  };

  const handleAddTrack = () => {
    onAddPerformanceTrack?.();
  };

  const bpmChoices = useMemo(() => {
    const values = new Set(bpmOptions);
    values.add(bpm);
    return Array.from(values).sort((a, b) => a - b);
  }, [bpm]);

  void patternGroups;
  void currentSectionIndex;
  void selectedGroupId;
  void onSelectLoop;
  void performanceTracks;
  void triggers;
  void onEnsurePerformanceRow;
  void activePerformanceTrackId;
  void onSelectPerformanceTrack;
  void onUpdatePerformanceTrack;
  void onRemovePerformanceTrack;
  void _songRows;

  return (
    <div style={containerStyle}>
      <div style={toolbarStyle}>
        <span style={toolbarLabelStyle}>Timeline</span>
        <div style={toolbarActionsStyle}>
          <IconButton
            icon="save"
            label="Save song"
            style={accentCircularButtonStyle}
          />
          <IconButton
            icon="more_horiz"
            label="More options"
            style={circularButtonStyle}
          />
        </div>
      </div>
      <div style={timelineContainerStyle} />
      <div style={bottomToolbarStyle}>
        <button
          type="button"
          onClick={onToggleTransport}
          aria-label={isPlaying ? "Stop playback" : "Start playback"}
          style={{
            ...circularButtonStyle,
            width: 44,
            height: 44,
            background: isPlaying ? "#E02749" : "#27E0B0",
            border: isPlaying ? "1px solid #E02749" : "1px solid #27E0B0",
            color: isPlaying ? "#ffe4e6" : "#0b1624",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
            {isPlaying ? "stop" : "play_arrow"}
          </span>
        </button>
        <select
          value={bpm}
          onChange={(event) => setBpm(parseInt(event.target.value, 10))}
          aria-label="Song tempo"
          style={bpmSelectStyle}
        >
          {bpmChoices.map((value) => (
            <option key={value} value={value}>
              {value} BPM
            </option>
          ))}
        </select>
        <IconButton
          icon="add"
          label="Add loop"
          onClick={handleAddLoop}
          style={circularButtonStyle}
        />
        <IconButton
          icon="add"
          label="Add row"
          onClick={handleAddRow}
          style={circularButtonStyle}
        />
        <IconButton
          icon="add"
          label="Add track"
          onClick={handleAddTrack}
          style={circularButtonStyle}
          disabled={!onAddPerformanceTrack}
        />
      </div>
      <div style={instrumentPlaceholderStyle}>Instrument Controls Area</div>
    </div>
  );
}

export default SongView;

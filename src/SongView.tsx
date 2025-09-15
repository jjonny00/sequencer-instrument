import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { Track } from "./tracks";

interface SongViewProps {
  tracks: Track[];
  songSequence: number[];
  setSongSequence: Dispatch<SetStateAction<number[]>>;
  currentSequenceIndex: number;
  isPlaying: boolean;
  bpm: number;
  setBpm: Dispatch<SetStateAction<number>>;
  onPlayPause: () => void;
  onStop: () => void;
}

export function SongView({
  tracks,
  songSequence,
  setSongSequence,
  currentSequenceIndex,
  isPlaying,
  bpm,
  setBpm,
  onPlayPause,
  onStop,
}: SongViewProps) {
  const trackMap = useMemo(
    () => new Map(tracks.map((track) => [track.id, track])),
    [tracks]
  );

  const addTrackToSequence = (trackId: number) => {
    setSongSequence((prev) => [...prev, trackId]);
  };

  const removeStepAt = (index: number) => {
    setSongSequence((prev) => prev.filter((_, i) => i !== index));
  };

  const clearSequence = () => setSongSequence([]);

  const hasSequence = songSequence.length > 0;
  const playableTracks = tracks.filter((track) => track.pattern);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        gap: 16,
        minHeight: 0,
      }}
    >
      <div
        style={{
          border: "1px solid #333",
          borderRadius: 12,
          background: "#1b2130",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "#e6f2ff",
            }}
          >
            Song Sequence
          </h2>
          {hasSequence && (
            <button
              onClick={clearSequence}
              style={{
                marginLeft: "auto",
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid #333",
                background: "#273041",
                color: "#e6f2ff",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            minHeight: 64,
          }}
        >
          {!hasSequence ? (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px dashed #475569",
                color: "#94a3b8",
                fontSize: 13,
              }}
            >
              Add tracks below to build your arrangement.
            </div>
          ) : (
            songSequence.map((trackId, index) => {
              const track = trackMap.get(trackId);
              const highlight = isPlaying && index === currentSequenceIndex;
              return (
                <button
                  key={`${trackId}-${index}`}
                  onClick={() => removeStepAt(index)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: `1px solid ${highlight ? "#27E0B0" : "#333"}`,
                    background: highlight ? "#273041" : "#1f2532",
                    color: highlight ? "#27E0B0" : "#e6f2ff",
                    fontSize: 13,
                    cursor: "pointer",
                    minWidth: 160,
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: highlight ? "#27E0B0" : "#273041",
                      color: highlight ? "#1F2532" : "#94a3b8",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    {index + 1}
                  </span>
                  <span style={{ fontWeight: 500 }}>
                    {track?.name ?? `Track ${trackId}`}
                  </span>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16, marginLeft: 4 }}
                  >
                    close
                  </span>
                </button>
              );
            })
          )}
        </div>
        {hasSequence && (
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Tap a section to remove it from the sequence.
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <label>BPM</label>
          <select
            value={bpm}
            onChange={(e) => setBpm(parseInt(e.target.value, 10))}
            style={{
              padding: 8,
              borderRadius: 8,
              background: "#121827",
              color: "white",
            }}
          >
            {[90, 100, 110, 120, 130].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 12 }}>
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            onPointerDown={onPlayPause}
            onPointerUp={(e) => e.currentTarget.blur()}
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              border: "1px solid #333",
              background: "#27E0B0",
              color: "#1F2532",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            <span className="material-symbols-outlined">
              {isPlaying ? "pause" : "play_arrow"}
            </span>
          </button>
          <button
            aria-label="Stop"
            onPointerDown={onStop}
            onPointerUp={(e) => e.currentTarget.blur()}
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              border: "1px solid #333",
              background: "#E02749",
              color: "#e6f2ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              padding: 0,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ lineHeight: 1, width: "100%", height: "100%" }}
            >
              stop
            </span>
          </button>
        </div>
      </div>

      <div
        className="scrollable"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingRight: 4,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>
          <h3
            style={{
              margin: "0 0 8px",
              fontSize: 14,
              fontWeight: 600,
              color: "#e6f2ff",
            }}
          >
            Tracks
          </h3>
          {tracks.length === 0 ? (
            <div
              style={{
                padding: 16,
                borderRadius: 8,
                border: "1px dashed #475569",
                color: "#94a3b8",
                fontSize: 13,
              }}
            >
              No tracks available. Create patterns in Track view to add them here.
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {tracks.map((track) => {
                const hasPattern = Boolean(track.pattern);
                return (
                  <button
                    key={track.id}
                    onClick={() => hasPattern && addTrackToSequence(track.id)}
                    disabled={!hasPattern}
                    style={{
                      flex: "1 1 140px",
                      minWidth: 120,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid #333",
                      background: hasPattern ? "#27E0B0" : "#1f2532",
                      color: hasPattern ? "#1F2532" : "#64748b",
                      opacity: hasPattern ? 1 : 0.5,
                      cursor: hasPattern ? "pointer" : "default",
                      textAlign: "left",
                      fontWeight: 600,
                    }}
                  >
                    {track.name}
                    {!hasPattern && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          marginTop: 4,
                        }}
                      >
                        Needs a pattern
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {tracks.length > 0 && playableTracks.length === 0 && (
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px dashed #475569",
              color: "#94a3b8",
              fontSize: 12,
            }}
          >
            Add steps to a track in Track view to enable it here.
          </div>
        )}
      </div>
    </div>
  );
}

import { Fragment } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { Track } from "./tracks";

interface SongViewProps {
  tracks: Track[];
  songSections: boolean[][];
  setSongSections: Dispatch<SetStateAction<boolean[][]>>;
  currentSection: number;
  isPlaying: boolean;
}

export function SongView({
  tracks,
  songSections,
  setSongSections,
  currentSection,
  isPlaying,
}: SongViewProps) {
  const handleToggle = (sectionIndex: number, trackIndex: number) => {
    setSongSections((prev) => {
      if (sectionIndex >= prev.length) return prev;
      return prev.map((section, idx) => {
        if (idx !== sectionIndex) return section;
        const next = section.slice();
        if (trackIndex >= next.length) {
          return next;
        }
        next[trackIndex] = !next[trackIndex];
        return next;
      });
    });
  };

  const handleAddSection = () => {
    setSongSections((prev) => {
      const trackCount = tracks.length;
      const newSection = Array(trackCount).fill(true);
      if (prev.length === 0) {
        return [newSection];
      }
      return [...prev, newSection];
    });
  };

  const renderGrid = () => {
    if (tracks.length === 0) {
      return (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 14,
          }}
        >
          No tracks available. Load a pack to start arranging your song.
        </div>
      );
    }

    if (songSections.length === 0) {
      return (
        <div
          style={{
            padding: 24,
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 14,
          }}
        >
          Add a section to begin arranging which tracks play together.
        </div>
      );
    }

    const labelWidth = 140;
    const sectionCount = songSections.length;

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(${labelWidth}px, ${labelWidth}px) repeat(${sectionCount}, minmax(80px, 1fr))`,
          gap: 8,
          alignItems: "center",
        }}
      >
        <div
          style={{
            padding: "12px 8px",
            background: "#121827",
            borderRadius: 8,
            border: "1px solid #333",
            fontWeight: 600,
            fontSize: 13,
            textAlign: "left",
            color: "#e6f2ff",
          }}
        >
          Track
        </div>
        {songSections.map((_, sectionIndex) => {
          const isCurrent = currentSection === sectionIndex;
          const highlight = isPlaying && isCurrent;
          return (
            <div
              key={`section-header-${sectionIndex}`}
              style={{
                padding: "12px 0",
                borderRadius: 8,
                border: `1px solid ${highlight ? "#27E0B0" : "#333"}`,
                background: highlight ? "#273041" : "#1f2532",
                color: highlight ? "#27E0B0" : "#e6f2ff",
                fontWeight: 600,
                fontSize: 13,
                textAlign: "center",
                boxShadow: highlight
                  ? "0 0 10px rgba(39, 224, 176, 0.35)"
                  : "none",
              }}
            >
              Section {sectionIndex + 1}
            </div>
          );
        })}
        {tracks.map((track, trackIndex) => (
          <Fragment key={track.id}>
            <div
              style={{
                padding: "12px 8px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "#1b2130",
                color: "#e6f2ff",
                fontSize: 13,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {track.name}
            </div>
            {songSections.map((section, sectionIndex) => {
              const active = section[trackIndex];
              const isCurrent = currentSection === sectionIndex;
              const highlight = isPlaying && isCurrent;
              const background = active
                ? highlight
                  ? "#36f1c5"
                  : "#27E0B0"
                : highlight
                ? "#273041"
                  : "#1f2532";
              return (
                <button
                  key={`cell-${sectionIndex}-${trackIndex}`}
                  onClick={() => handleToggle(sectionIndex, trackIndex)}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${highlight ? "#27E0B0" : "#333"}`,
                    background,
                    color: active ? "#1F2532" : "#e6f2ff",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "10px 0",
                    cursor: "pointer",
                    boxShadow: highlight
                      ? "0 0 10px rgba(39, 224, 176, 0.35)"
                      : "none",
                    transition: "background 0.2s, box-shadow 0.2s, border 0.2s",
                  }}
                  aria-pressed={active}
                >
                  {active ? "On" : "Off"}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleAddSection}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "#27E0B0",
            color: "#1F2532",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Section
        </button>
      </div>
      <div
        className="scrollable"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          paddingRight: 4,
        }}
      >
        {renderGrid()}
      </div>
    </div>
  );
}

import { Fragment, useMemo, useState } from "react";

import type { ProjectSortOrder, StoredProjectSummary } from "../storage";

interface SavedSongsListProps {
  projects: StoredProjectSummary[];
  sortOrder: ProjectSortOrder;
  onChangeSortOrder: (order: ProjectSortOrder) => void;
  onSelectProject: (name: string) => void;
  onRenameProject: (name: string) => void;
  onDeleteProject: (name: string) => void;
  onTryDemoSong: () => void;
}

type ProjectGroup = {
  label: string;
  items: StoredProjectSummary[];
};

const dayInMs = 24 * 60 * 60 * 1000;

const getRecentGroupLabel = (timestamp: number, now: number): string => {
  if (!timestamp) {
    return "Older";
  }

  const safeTimestamp = Math.min(timestamp, now);
  const diff = now - safeTimestamp;

  if (diff < dayInMs) {
    return "Today";
  }
  if (diff < 7 * dayInMs) {
    return "This Week";
  }
  if (diff < 30 * dayInMs) {
    return "Last 30 Days";
  }

  return new Date(safeTimestamp).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const createGroups = (
  projects: StoredProjectSummary[],
  sortOrder: ProjectSortOrder
): ProjectGroup[] => {
  if (projects.length === 0) {
    return [];
  }

  if (sortOrder === "alphabetical") {
    const buckets = new Map<string, StoredProjectSummary[]>();
    for (const project of projects) {
      const firstCharacter = project.name.trim().charAt(0);
      const label = /[A-Za-z]/.test(firstCharacter)
        ? firstCharacter.toUpperCase()
        : "#";
      const bucket = buckets.get(label);
      if (bucket) {
        bucket.push(project);
      } else {
        buckets.set(label, [project]);
      }
    }

    return Array.from(buckets.entries())
      .sort(([labelA], [labelB]) => labelA.localeCompare(labelB))
      .map(([label, items]) => ({
        label,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }

  const now = Date.now();
  const buckets = new Map<string, StoredProjectSummary[]>();
  for (const project of projects) {
    const label = getRecentGroupLabel(project.updatedAt, now);
    const bucket = buckets.get(label);
    if (bucket) {
      bucket.push(project);
    } else {
      buckets.set(label, [project]);
    }
  }

  const ordering = new Map<string, number>();
  const orderedLabels = ["Today", "This Week", "Last 30 Days"];
  orderedLabels.forEach((label, index) => ordering.set(label, index));

  return Array.from(buckets.entries())
    .sort(([labelA], [labelB]) => {
      const indexA = ordering.get(labelA);
      const indexB = ordering.get(labelB);

      if (indexA !== undefined || indexB !== undefined) {
        return (indexA ?? orderedLabels.length) - (indexB ?? orderedLabels.length);
      }

      return buckets.get(labelB)![0].updatedAt - buckets.get(labelA)![0].updatedAt;
    })
    .map(([label, items]) => ({
      label,
      items: items.sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      ),
    }));
};

export const SavedSongsList = ({
  projects,
  sortOrder,
  onChangeSortOrder,
  onSelectProject,
  onRenameProject,
  onDeleteProject,
  onTryDemoSong,
}: SavedSongsListProps) => {
  const [activeRow, setActiveRow] = useState<string | null>(null);

  const orderedProjects = useMemo(() => {
    if (sortOrder === "recent") {
      return [...projects].sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      );
    }
    return [...projects].sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, sortOrder]);

  const groups = useMemo(
    () => createGroups(orderedProjects, sortOrder),
    [orderedProjects, sortOrder]
  );

  const renderEmptyState = () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        padding: "32px 24px",
        borderRadius: 20,
        border: "1px dashed #1f2937",
        background: "#0b1624",
        textAlign: "center",
        color: "#cbd5f5",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(39,224,176,0.12)",
          color: "#27E0B0",
          fontSize: 40,
        }}
      >
        🎶
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 18, color: "#e6f2ff" }}>
          No saved songs yet
        </strong>
        <span style={{ fontSize: 14 }}>
          Your creations will appear here. Start a fresh track or explore our
          demo groove.
        </span>
      </div>
      <button
        type="button"
        onClick={onTryDemoSong}
        style={{
          padding: "12px 24px",
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

  return (
    <div
      style={{
        width: "min(720px, 100%)",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        background: "rgba(9,14,24,0.6)",
        borderRadius: 24,
        padding: "24px 24px 28px",
        border: "1px solid rgba(31,41,55,0.8)",
        boxShadow: "0 24px 60px rgba(9, 14, 24, 0.6)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: "#e6f2ff" }}>
            Saved Songs
          </span>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>
            {projects.length === 0
              ? "Nothing saved yet"
              : `${projects.length} saved ${projects.length === 1 ? "song" : "songs"}`}
          </span>
        </div>
        <div
          role="tablist"
          aria-label="Sort saved songs"
          style={{
            display: "inline-flex",
            background: "#0b1624",
            borderRadius: 999,
            padding: 4,
            border: "1px solid #1f2937",
            gap: 4,
          }}
        >
          {(
            [
              { label: "Recent", value: "recent" as ProjectSortOrder },
              { label: "A-Z", value: "alphabetical" as ProjectSortOrder },
            ]
          ).map((option) => {
            const isActive = sortOrder === option.value;
            return (
              <button
                key={option.value}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => onChangeSortOrder(option.value)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: isActive ? "#0b1220" : "#cbd5f5",
                  background: isActive
                    ? "linear-gradient(135deg, #27E0B0, #6AE0FF)"
                    : "transparent",
                  transition: "background 120ms ease, color 120ms ease",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      {projects.length === 0 ? (
        renderEmptyState()
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxHeight: "50vh",
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          {groups.map((group) => (
            <Fragment key={group.label}>
              <div
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  fontWeight: 600,
                  color: "#64748b",
                }}
              >
                {group.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {group.items.map((project) => {
                  const isActive = activeRow === project.name;
                  return (
                    <div
                      key={project.name}
                      onMouseEnter={() => setActiveRow(project.name)}
                      onMouseLeave={() => setActiveRow((current) =>
                        current === project.name ? null : current
                      )}
                      onFocusCapture={() => setActiveRow(project.name)}
                      onBlurCapture={(event) => {
                        const nextTarget = event.relatedTarget as Node | null;
                        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                          setActiveRow((current) =>
                            current === project.name ? null : current
                          );
                        }
                      }}
                      onTouchStart={() => setActiveRow(project.name)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 16px",
                        borderRadius: 16,
                        border: "1px solid #1f2937",
                        background: isActive ? "#111d30" : "#0f172a",
                        transition: "background 120ms ease, border 120ms ease",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectProject(project.name)}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          alignItems: "flex-start",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          margin: 0,
                          cursor: "pointer",
                          color: "inherit",
                          textAlign: "left",
                          flex: 1,
                        }}
                      >
                        <span style={{ fontSize: 15, fontWeight: 600 }}>
                          {project.name}
                        </span>
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>
                          Tap to load song
                        </span>
                      </button>
                      <div
                        style={{
                          display: "inline-flex",
                          gap: 6,
                          opacity: isActive ? 1 : 0,
                          pointerEvents: isActive ? "auto" : "none",
                          transition: "opacity 120ms ease",
                        }}
                      >
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRenameProject(project.name);
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 10,
                            border: "1px solid #1f2937",
                            background: "#162033",
                            color: "#cbd5f5",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                          aria-label={`Rename ${project.name}`}
                        >
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                            style={{ fontSize: 18 }}
                          >
                            edit
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteProject(project.name);
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 10,
                            border: "1px solid rgba(239, 68, 68, 0.4)",
                            background: "rgba(239, 68, 68, 0.12)",
                            color: "#fca5a5",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                          aria-label={`Delete ${project.name}`}
                        >
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                            style={{ fontSize: 18 }}
                          >
                            delete
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

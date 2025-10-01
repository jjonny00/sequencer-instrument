import type { ReactNode } from "react";

interface ViewHeaderProps {
  activeTab: "track" | "song";
  onSelectTab: (tab: "track" | "song") => void;
  onBack: () => void;
  actions?: ReactNode;
}

export const ViewHeader = ({
  activeTab,
  onSelectTab,
  onBack,
  actions,
}: ViewHeaderProps) => {
  return (
    <header
      style={{
        padding: "16px 16px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderBottom: "1px solid #1f2937",
        background: "#0b1220",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: "1px solid #2a3344",
            background: "#111827",
            color: "#e6f2ff",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.3,
            flexShrink: 0,
          }}
        >
          <span
            className="material-symbols-outlined"
            aria-hidden="true"
            style={{ fontSize: 18 }}
          >
            arrow_back
          </span>
          Back
        </button>
        <nav
          aria-label="View navigation"
          style={{
            display: "flex",
            gap: 8,
            flex: 1,
            minWidth: 0,
          }}
        >
          {([
            { id: "track", label: "Tracks" },
            { id: "song", label: "Song" },
          ] as const).map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 999,
                  border: "1px solid #2a3344",
                  background: isActive ? "#27E0B0" : "#111827",
                  color: isActive ? "#0b1220" : "#e6f2ff",
                  fontWeight: 600,
                  letterSpacing: 0.3,
                  transition: "background 0.2s ease, color 0.2s ease",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
      {actions ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
};

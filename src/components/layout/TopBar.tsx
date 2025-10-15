import type { ReactNode } from "react";

type TopBarProps = {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
};

const SECTION_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 12,
} as const;

export function TopBar({ left, center, right }: TopBarProps) {
  const hasRightSection = right !== undefined && right !== null && right !== false;

  return (
    <div
      className="safe-top"
      style={{
        height: "calc(var(--topbar-h) + env(safe-area-inset-top))",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "var(--topbar-h)",
          paddingLeft: "calc(var(--hpad) + env(safe-area-inset-left))",
          paddingRight: "calc(var(--hpad) + env(safe-area-inset-right))",
          gap: 16,
          boxSizing: "border-box",
        }}
      >
        <div style={{ ...SECTION_STYLE, minWidth: 0 }}>{left}</div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          {center}
        </div>
        {hasRightSection ? (
          <div
            style={{
              ...SECTION_STYLE,
              justifyContent: "flex-end",
              minWidth: 0,
            }}
          >
            {right}
          </div>
        ) : null}
      </div>
    </div>
  );
}

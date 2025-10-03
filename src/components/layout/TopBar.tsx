import type { ReactNode } from "react";

type TopBarProps = {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
};
export function TopBar({ left, center, right }: TopBarProps) {
  return (
    <div
      className="safe-top flex items-center justify-between px-3"
      style={{ height: "var(--topbar-h)" }}
    >
      <div className="flex items-center gap-2">{left}</div>
      <div className="flex-1 flex justify-center">{center}</div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

import type { ReactNode, CSSProperties } from "react";

type BottomDockProps = {
  children: ReactNode;
  show?: boolean;
  heightVar?: string;
  inertWhenHidden?: boolean;
  style?: CSSProperties;
};
export function BottomDock({
  children,
  show = true,
  heightVar = "var(--transport-h)",
  inertWhenHidden = false,
  style,
}: BottomDockProps) {
  return (
    <div
      className="safe-bottom"
      style={{
        height: show ? `calc(${heightVar} + env(safe-area-inset-bottom))` : 0,
        transition: "height 180ms ease",
        overflow: "hidden",
        ...style,
      }}
      aria-hidden={!show}
      {...(inertWhenHidden && !show ? { inert: "true" as any } : {})}
    >
      {children}
    </div>
  );
}

import type { ReactNode } from "react";

import { TopBar } from "../components/layout/TopBar";
import { BottomDock } from "../components/layout/BottomDock";
import { flagEnabled } from "../lib/featureFlags";

type StartScreenProps = {
  legacy: ReactNode;
  topBarLeft?: ReactNode;
  topBarCenter?: ReactNode;
  topBarRight?: ReactNode;
  children: ReactNode;
  bottomDock?: ReactNode;
};

export function StartScreen({
  legacy,
  topBarLeft,
  topBarCenter,
  topBarRight,
  children,
  bottomDock,
}: StartScreenProps) {
  const layoutV2 = flagEnabled("layout_v2");

  if (!layoutV2) {
    return <>{legacy}</>;
  }

  return (
    <div
      className="vh flex flex-col"
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
      <TopBar left={topBarLeft} center={topBarCenter} right={topBarRight} />
      <div
        className="flex-1 min-h-0 overflow-y-auto"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          paddingTop: 24,
          paddingBottom: 32,
          paddingLeft: "calc(var(--hpad) + env(safe-area-inset-left))",
          paddingRight: "calc(var(--hpad) + env(safe-area-inset-right))",
          boxSizing: "border-box",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 720,
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {children}
        </div>
      </div>
      {bottomDock ? (
        <BottomDock>
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              paddingLeft: "calc(var(--hpad) + env(safe-area-inset-left))",
              paddingRight: "calc(var(--hpad) + env(safe-area-inset-right))",
              boxSizing: "border-box",
              width: "100%",
            }}
          >
            <div style={{ width: "100%", maxWidth: 720 }}>{bottomDock}</div>
          </div>
        </BottomDock>
      ) : null}
    </div>
  );
}

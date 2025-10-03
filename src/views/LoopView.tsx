import type { ReactNode } from "react";

import { TopBar } from "../components/layout/TopBar";
import { BottomDock } from "../components/layout/BottomDock";
import { flagEnabled } from "../lib/featureFlags";

type LoopViewProps = {
  legacy: ReactNode;
  topBarLeft?: ReactNode;
  topBarCenter?: ReactNode;
  topBarRight?: ReactNode;
  children: ReactNode;
  transport?: ReactNode;
  controls?: ReactNode;
  controlsVisible?: boolean;
  controlsHeightVar?: string;
};

export function LoopView({
  legacy,
  topBarLeft,
  topBarCenter,
  topBarRight,
  children,
  transport,
  controls,
  controlsVisible = true,
  controlsHeightVar,
}: LoopViewProps) {
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
        className="flex-1 min-h-0 overflow-hidden"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          padding: "16px 16px 0",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {children}
      </div>
      {transport ? (
        <BottomDock>
          <div
            style={{
              height: "100%",
              width: "100%",
              maxWidth: 960,
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 16px",
              boxSizing: "border-box",
            }}
          >
            {transport}
          </div>
        </BottomDock>
      ) : null}
      {controls ? (
        <BottomDock
          heightVar={controlsHeightVar ?? "var(--controls-h)"}
          show={controlsVisible}
          inertWhenHidden
        >
          <div
            className="scrollable"
            style={{
              height: "100%",
              overflowY: "auto",
              padding: "12px 16px 16px",
              boxSizing: "border-box",
              width: "100%",
              maxWidth: 960,
              margin: "0 auto",
            }}
          >
            {controls}
          </div>
        </BottomDock>
      ) : null}
    </div>
  );
}

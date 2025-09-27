import React, { useEffect, useState } from "react";

let logBuffer: string[] = [];
let listeners: ((logs: string[]) => void)[] = [];

function pushLog(msg: string) {
  logBuffer = [...logBuffer.slice(-50), msg];
  listeners.forEach((fn) => fn([...logBuffer]));
}

if (import.meta.env.DEV) {
  ["log", "info", "warn", "error"].forEach((method) => {
    const original = console[method as keyof Console] as any;
    console[method as keyof Console] = (...args: any[]) => {
      pushLog(
        `[${method.toUpperCase()}] ${args
          .map((a) => JSON.stringify(a))
          .join(" ")}`
      );
      original.apply(console, args);
    };
  });
}

export const DebugPanel: React.FC = () => {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const listener = (l: string[]) => setLogs(l);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((fn) => fn !== listener);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: "40%",
        overflowY: "auto",
        background: "rgba(0,0,0,0.8)",
        color: "#0f0",
        fontSize: "12px",
        fontFamily: "monospace",
        padding: "4px",
        zIndex: 9999,
      }}
    >
      {logs.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
};

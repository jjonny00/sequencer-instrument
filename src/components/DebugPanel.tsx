import React, { useEffect, useState } from "react";

const DEBUG_PANEL_STORAGE_KEY = "debug-panel";

let logBuffer: string[] = [];
let listeners: ((logs: string[]) => void)[] = [];

const stringifyArg = (arg: unknown) => {
  try {
    if (typeof arg === "string") {
      return arg;
    }
    return JSON.stringify(arg);
  } catch (error) {
    return `[unserializable:${(error as Error)?.message ?? "unknown"}]`;
  }
};

const normalizeBoolean = (value: string | null): boolean | null => {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return null;
};

const computeDebugPanelEnabled = (): boolean => {
  if (import.meta.env.DEV) {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const queryValue = normalizeBoolean(params.get("debugPanel"));

    if (queryValue !== null) {
      if (queryValue) {
        window.localStorage.setItem(DEBUG_PANEL_STORAGE_KEY, "1");
      } else {
        window.localStorage.removeItem(DEBUG_PANEL_STORAGE_KEY);
      }
    }

    const stored = window.localStorage.getItem(DEBUG_PANEL_STORAGE_KEY);
    if (stored !== null) {
      return normalizeBoolean(stored) ?? stored === "1";
    }
  } catch {
    // ignore storage/search param errors and fall through to disabled
  }

  return false;
};

const debugPanelEnabled = computeDebugPanelEnabled();

let hasPatchedConsole = false;

function pushLog(msg: string) {
  logBuffer = [...logBuffer.slice(-50), msg];
  listeners.forEach((fn) => fn([...logBuffer]));
}

if (debugPanelEnabled && !hasPatchedConsole) {
  hasPatchedConsole = true;
  const methods = ["log", "info", "warn", "error"] as const;
  methods.forEach((method) => {
    const original = console[method].bind(console);
    console[method] = ((...args: unknown[]) => {
      pushLog(
        `[${method.toUpperCase()}] ${args
          .map((a) => stringifyArg(a))
          .join(" ")}`
      );
      original(...args);
    }) as typeof console[typeof method];
  });
}

export const isDebugPanelEnabled = () => debugPanelEnabled;

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
